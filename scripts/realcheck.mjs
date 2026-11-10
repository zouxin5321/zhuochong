/**
 * 真实鼠标端到端校验（系统级注入，非 CDP）。
 *
 * 覆盖用户实际会遇到的三种双击节奏 + 单击，验证「双击放大招」在真实
 * 输入链路上稳定生效（CDP 注入会绕过窗口激活/鼠标捕获，掩盖问题）。
 *
 * 前置：宿主带 --remote-debugging-port=9222 启动。
 * 用法：node scripts/realcheck.mjs
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CDP_BASE || 'http://127.0.0.1:9222'
const here = dirname(fileURLToPath(import.meta.url))

const list = await fetch(`${BASE}/json/list`).then((r) => r.json()).catch(() => [])
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有找到宿主窗口的调试目标：确认已带 --remote-debugging-port=9222 启动 exe')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value
}

await send('Runtime.enable')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const realClick = (mode, gap) => {
  const args = [join(here, 'realinput.py'), mode]
  if (gap) args.push('--gap', String(gap))
  return execFileSync('python', args, { encoding: 'utf8' }).trim()
}

const action = () => evalJs('window.__zhuochong.action')
const winBox = () => evalJs('({ w: innerWidth, h: innerHeight })')
const CLICK_POOL = ['jump', 'slash', 'power', 'roll', 'spin', 'wave', 'wiggle', 'run']

console.log('真实鼠标校验（系统级注入）')
// 清掉可能残留的拖拽/睡眠状态
await evalJs(`(() => {
  const c = document.querySelector('#pet');
  c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return true;
})()`)
await sleep(400)

const baseWin = await winBox()

// ---------- 1. 单击 ----------
let single = ''
for (let i = 0; i < 3; i++) {
  realClick('click')
  await sleep(400)
  single = await action()
  if (CLICK_POOL.includes(single)) break
  await sleep(1800)
}
check('单击 → 点击池动作', CLICK_POOL.includes(single), `action=${single}`)

// ---------- 2. 快速双击（120ms） ----------
await sleep(6500) // 清空连点窗口(1.6s) + 大招连击窗口(6s)
realClick('double', 120)
await sleep(260)
const fast = await action()
check('双击（间隔 120ms）→ 大招', fast === 'ultimate', `action=${fast}`)
await sleep(360)
const fastWin = await winBox()
check('大招窗口放大', fastWin.w > baseWin.w * 1.2, `base=${baseWin.w} ult=${fastWin.w}`)
await sleep(1600)

// ---------- 3. 常速双击（260ms） ----------
await sleep(6500)
realClick('double', 260)
await sleep(260)
const normal = await action()
check('双击（间隔 260ms）→ 大招', normal === 'ultimate', `action=${normal}`)
await sleep(1800)

// ---------- 4. 慢速双击（450ms，接近系统双击上限） ----------
await sleep(6500)
realClick('double', 450)
await sleep(260)
const slow = await action()
check('双击（间隔 450ms）→ 大招', slow === 'ultimate', `action=${slow}`)
await sleep(2000)

// ---------- 5. 恢复 ----------
const restored = await winBox()
check('大招结束后窗口恢复', Math.abs(restored.w - baseWin.w) <= 4, `base=${baseWin.w} now=${restored.w}`)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
