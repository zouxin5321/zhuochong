/**
 * 真实鼠标输入校验：用 CDP 的 Input 域注入真实鼠标事件，
 * 完整走 pointerdown → pointerup → click 链路（domcheck 是直接 dispatch
 * click 事件、绕过了 pointerdown，抓不到「按下就抢走鼠标」这类问题）。
 *
 * 前置：宿主带 --remote-debugging-port=9222 启动。
 * 用法：node scripts/inputcheck.mjs
 *
 * 覆盖：
 *   1. 真实单击 → 点击池动作
 *   2. 真实双击 → 跳跃大招劈砍 + 窗口放大
 *   3. 真实拖拽（阈值内不动 = 不算拖；超过阈值 = 拎起）
 */
const BASE = process.env.CDP_BASE || 'http://127.0.0.1:9222'

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
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})

const send = (method, params = {}, timeout = 4000) =>
  new Promise((resolve) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ __timeout: true })
    }, timeout)
    pending.set(id, (m) => {
      clearTimeout(timer)
      resolve(m)
    })
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

const view = await evalJs('({ w: innerWidth, h: innerHeight })')
const cx = Math.round(view.w / 2)
const cy = Math.round(view.h / 2)

const mouse = (type, clickCount = 1, x = cx, y = cy) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount,
    pointerType: 'mouse'
  })

/** 真实单击：按下 → 抬起（浏览器会自动派发 click） */
const realClick = async () => {
  await mouse('mousePressed', 1)
  await sleep(30)
  await mouse('mouseReleased', 1)
}

const action = () => evalJs('window.__zhuochong ? window.__zhuochong.action : null')
const winBox = () => evalJs('({ w: innerWidth, h: innerHeight })')
const resetDrag = () =>
  evalJs(`(() => {
    const c = document.querySelector('#pet');
    c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return true;
  })()`)

const CLICK_POOL = ['jump', 'slash', 'power', 'roll', 'spin', 'wave', 'wiggle', 'run']

console.log(`真实输入校验：${page.title}  视口 ${view.w}x${view.h}`)
await resetDrag()
await sleep(600)

// ---------- 1. 真实单击 ----------
const baseWin = await winBox()
let single = ''
for (let i = 0; i < 3; i++) {
  await realClick()
  await sleep(320)
  single = await action()
  if (CLICK_POOL.includes(single)) break
  await sleep(1700) // 清空连点窗口再试
}
check('真实单击 → 点击池动作', CLICK_POOL.includes(single), `action=${single}`)

// ---------- 2. 真实双击 ----------
await sleep(1800)
await realClick()
await sleep(90)
await mouse('mousePressed', 2)
await sleep(30)
await mouse('mouseReleased', 2)
await sleep(200)
const dbl = await action()
check('真实双击 → 跳跃大招劈砍', dbl === 'ultimate', `action=${dbl}`)

await sleep(320)
const ultWin = await winBox()
check('大招期间窗口真实放大', ultWin.w > baseWin.w * 1.2, `base=${baseWin.w} ult=${ultWin.w}`)
await sleep(2000)
const restored = await winBox()
check('大招结束后窗口恢复', Math.abs(restored.w - baseWin.w) <= 4, `base=${baseWin.w} now=${restored.w}`)

// ---------- 3. 真实拖拽 ----------
await sleep(1800)
await mouse('mousePressed', 1)
await sleep(60)
await mouse('mouseMoved', 1, cx + 2, cy + 2) // 阈值内抖动：不应进入拖拽
await sleep(120)
const microMove = await action()
check('轻微抖动不算拖拽', microMove !== 'drag', `action=${microMove}`)

await mouse('mouseMoved', 1, cx + 40, cy + 30) // 超过阈值：被拎起
await sleep(220)
const dragging = await action()
check('真实拖拽 → 拎起动作', dragging === 'drag', `action=${dragging}`)

await mouse('mouseReleased', 1)
await sleep(700)
const afterDrop = await action()
check('松手 → 落地唤醒动作', afterDrop === 'power' || afterDrop === 'jump', `action=${afterDrop}`)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
