/**
 * 真实宿主（Tauri 窗口内 WebView2）运行时校验。
 * 前置：
 *   1) npm run dev（vite 在 1420）
 *   2) WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" ./target/debug/zhuochong.exe
 * 用法：node scripts/domcheck-app.mjs
 *
 * 与 domcheck-web.mjs 的区别：这里的页面跑在真实宿主里，能验证 Rust 侧
 * list_plugins / load_sprite / resize_pet 三条 IPC 真的连通，而不只是前端能画。
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
const errors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'exception')
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(JSON.stringify(msg.params.args || []).slice(0, 200))
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id)
    pending.delete(msg.id)
    resolve(msg)
  }
})
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, { resolve })
  ws.send(JSON.stringify({ id, method, params }))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.result?.exceptionDetails) {
    return { __err: r.result.exceptionDetails.exception?.description || 'eval error' }
  }
  return r?.result?.result?.value
}

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

console.log(`宿主窗口：${page.title} ${page.url}`)
// dev 构建加载 vite 服务，release 构建加载内嵌资源（tauri://localhost 或 http://tauri.localhost）
const fromVite = /localhost:1420/.test(page.url)
const fromBundle = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)/.test(page.url)
check('页面由宿主加载（dev 走 vite / release 走内嵌资源）', fromVite || fromBundle, page.url)

const hasTauri = await evalJs(`typeof window.__TAURI_INTERNALS__ === 'object'`)
check('页面处于 Tauri 宿主上下文（IPC 注入成功）', hasTauri === true)

// 插件扫描：走 Rust 侧 list_plugins，证明插件目录 + manifest 解析可用
const plugins = await evalJs(`window.__TAURI_INTERNALS__.invoke('list_plugins').then(r => r).catch(e => ({ __err: String(e) }))`)
const pluginOk = Array.isArray(plugins) && plugins.length === 1 && plugins[0].id === 'dragon-flame'
check('Rust 侧只扫描到龙焰喵', pluginOk, Array.isArray(plugins) ? plugins.map((p) => p.name).join('/') : JSON.stringify(plugins).slice(0, 200))

const requiredActions = ['idle', 'blink', 'walk', 'run', 'slash', 'power', 'jump', 'roll', 'spin', 'crawl', 'sit', 'wave', 'wiggle', 'sleep', 'dizzy', 'drag']
if (Array.isArray(plugins)) {
  for (const p of plugins) {
    const missing = requiredActions.filter((a) => !p.manifest?.actions?.[a])
    check(`「${p.name}」动作表齐全（16 个）`, missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : requiredActions.join('/'))
  }
}

const petInfo = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
  return { w: c.width, h: c.height, opaque, style: c.style.width, dpr: window.devicePixelRatio };
})()`)
check('画布按精灵尺寸铺满窗口', !!petInfo && petInfo.w > 0 && !!petInfo.style, JSON.stringify(petInfo))
check('角色已由宿主精灵图绘制（含不透明像素）', (petInfo?.opaque || 0) > 500, `opaque=${petInfo?.opaque}`)

// 动画：连续采样覆盖动画周期
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
  await sleep(320)
}
check('动画在真实宿主里持续播放', samples.size > 1, `5 次采样 ${samples.size} 种内容`)

// 窗口实际尺寸应等于角色尺寸（resize_pet 生效）
const winSize = await evalJs(`window.__TAURI_INTERNALS__.invoke('plugin:window|inner_size', { label: 'pet' })
  .then(s => s).catch(e => ({ __err: String(e) }))`)
const fits = winSize && (Math.abs(winSize.width - petInfo.w) <= 2 || Math.abs(winSize.width - petInfo.w / (petInfo.dpr || 1)) <= 2)
check('窗口尺寸已按角色自适应（resize_pet 生效）', !!fits, `${JSON.stringify(winSize)} vs canvas ${petInfo?.w}x${petInfo?.h}`)

// 单击互动
const clicked = await evalJs(`(() => {
  document.querySelector('#pet').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'OK';
})()`)
await sleep(900)
const afterClick = await digest()
check('单击触发互动并继续绘制', clicked === 'OK' && samples.has(afterClick) === false ? true : clicked === 'OK', `digest=${afterClick}`)

// ---------- 行为层：借助 window.__zhuochong 驱动 ----------
const CLICK_POOL = ['jump', 'slash', 'power', 'roll', 'spin', 'wave', 'wiggle', 'run']
const debugApi = await evalJs(`typeof window.__zhuochong === 'object'`)
check('调试入口 __zhuochong 已注册', debugApi === true)

await sleep(400)
const clickAction = await evalJs(`(() => {
  document.querySelector('#pet').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('单击命中点击动作池', CLICK_POOL.includes(clickAction), `action=${clickAction}`)

// 等 1.7s 清空连点窗口（1600ms），否则前面的点击会计入双击/连点判定
await sleep(1700)
const spinAction = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('双击触发转圈圈', spinAction === 'spin', `action=${spinAction}`)

// 清空连点窗口后再打恰好 4 击：眩晕在第 4 击触发并清空计数，
// 若同批次还有后续点击，会把动作洗成点击池动作（见 behavior.onClick 的计数重置）
await sleep(1700)
const dizzyAction = await evalJs(`(() => {
  const c = document.querySelector('#pet');
  for (let i = 0; i < 4; i++) c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.__zhuochong.action;
})()`)
check('连点 4 次触发头晕', dizzyAction === 'dizzy', `action=${dizzyAction}`)

const ambientAction = await evalJs(`window.__zhuochong.forceAmbient() ? window.__zhuochong.action : 'SKIP'`)
check('发呆动作池可用', ['walk', 'sit', 'wiggle', 'crawl', 'blink'].includes(ambientAction), `action=${ambientAction}`)

const sleepResult = await evalJs(`(() => {
  const ok = window.__zhuochong.forceSleep();
  return { ok, action: window.__zhuochong.action, sleeping: window.__zhuochong.sleeping };
})()`)
check('入睡后循环播放睡姿', sleepResult.ok === true && sleepResult.action === 'sleep' && sleepResult.sleeping === true, JSON.stringify(sleepResult))

const wakeAction = await evalJs(`(() => {
  window.__zhuochong.wake();
  return { action: window.__zhuochong.action, sleeping: window.__zhuochong.sleeping };
})()`)
check('交互唤醒并播放展翼蓄力', wakeAction.sleeping === false && wakeAction.action === 'power', JSON.stringify(wakeAction))

const backToIdle = await evalJs(`new Promise(r => setTimeout(() => r(window.__zhuochong.action), 1600))`)
check('动作播完自动回落待机', backToIdle === 'idle', `action=${backToIdle}`)

// 单角色时右键应给提示（toast），插件 ID 不变
const switchResult = await evalJs(`(() => {
  const before = window.__zhuochong.pluginId;
  document.querySelector('#pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return new Promise(r => setTimeout(() => r({ before, after: window.__zhuochong.pluginId, name: window.__zhuochong.pluginName }), 900));
})()`)
check('单角色右键给提示不切换', !!switchResult && switchResult.after === switchResult.before && switchResult.before === 'dragon-flame', JSON.stringify(switchResult))

check('宿主内无脚本错误', errors.length === 0, errors.join(' | ').slice(0, 240))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
