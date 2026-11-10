/**
 * 浏览器预览模式冒烟：npm run dev 后无 Tauri 宿主也应正常渲染内置角色。
 * 断言：canvas 有绘制内容、动画帧随时间变化、无控制台错误。
 * 用法：先 `npm run dev`，再 `node scripts/domcheck-web.mjs`
 */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = join(tmpdir(), 'zhuochong-web-' + Date.now())
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=420,360', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] })

const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  const timer = setTimeout(() => reject(new Error('devtools timeout')), 20000)
  chrome.stderr.on('data', (d) => {
    buf += d.toString()
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) { clearTimeout(timer); resolve(m[1]) }
  })
})

const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(JSON.stringify(msg.params.args || []).slice(0, 200))
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id)
    pending.delete(msg.id)
    resolve(msg)
  }
})
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, { resolve })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)
await S('Page.enable')
await S('Runtime.enable')
await S('Page.navigate', { url: 'http://localhost:1420/' })
await sleep(2500)

const evalJs = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value
}

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const info = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
  return { w: c.width, h: c.height, opaque, style: c.style.width };
})()`)
check('画布已按精灵尺寸渲染', !!info && info.w > 0 && info.style.endsWith('px'), JSON.stringify(info))
check('画布上有不透明像素（角色可见）', (info?.opaque || 0) > 500, `opaque=${info?.opaque}`)

// 全画布内容摘要：待机动画有 1px 呼吸位移，局部采样可能无差异，用全像素哈希判断。
// 连续采样 5 次（覆盖动画周期），任意两次不同即认为在播。
const digest = () => evalJs(`(() => {
  const c = document.querySelector('#pet');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i++) s = (s + d[i] * (i + 7)) % 4294967296;
  return s;
})()`)
const samples = new Set()
for (let i = 0; i < 5; i++) {
  samples.add(await digest())
  await sleep(350)
}
check('动画在播放（帧内容随时间变化）', samples.size > 1, `5 次采样得到 ${samples.size} 种帧内容`)

const clicked = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'OK';
})()`)
check('单击触发互动不报错', clicked === 'OK')
await sleep(700)

// ---------- 行为层（浏览器预览同样注册了 __zhuochong） ----------
const actions = await evalJs(`window.__zhuochong ? window.__zhuochong.actions() : null`)
check('内置角色动作表齐全（>=10 个）', Array.isArray(actions) && actions.length >= 10,
  Array.isArray(actions) ? actions.join('/') : String(actions))

const clickAction = await evalJs(`(() => {
  document.querySelector('#pet').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('单击命中点击动作池', ['jump', 'slash', 'power', 'roll', 'spin', 'wave', 'wiggle', 'run'].includes(clickAction), `action=${clickAction}`)

// 等 1.7s 清空连点窗口（1600ms），否则前面的点击会计入双击判定
await sleep(1700)
const ultAction = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('双击触发跳跃大招劈砍', ultAction === 'ultimate', `action=${ultAction}`)

// 大招连击窗口（6s）内再双击：二级剑气（霜雷斩）
await sleep(1800)
const ult2Action = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('连击升级触发二级大招', ult2Action === 'ultimate2', `action=${ult2Action}`)

check('无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 200))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
ws.close()
chrome.kill()
process.exit(fail > 0 ? 1 : 0)
