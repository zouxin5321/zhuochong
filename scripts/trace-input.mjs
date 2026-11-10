/**
 * 输入链路探针：在真实宿主里挂钩 window 捕获阶段，记录每一个指针/点击事件。
 * 用于定位「真实鼠标双击无效」这类只在物理输入下复现的问题
 * （CDP 注入事件不经过 OS 的窗口激活/鼠标捕获逻辑，会掩盖问题）。
 *
 * 用法：
 *   node scripts/trace-input.mjs --install     # 挂探针
 *   node scripts/trace-input.mjs --dump        # 读事件日志
 *   node scripts/trace-input.mjs --clear       # 清空
 */
const BASE = process.env.CDP_BASE || 'http://127.0.0.1:9222'
const mode = process.argv[2] || '--dump'

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
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value
}

await send('Runtime.enable')

if (mode === '--install') {
  const ok = await evalJs(`(() => {
    if (window.__trace) return 'already';
    const log = [];
    window.__trace = log;
    const push = (type) => (e) => {
      const st = window.__zhuochong;
      log.push({
        t: Date.now() % 100000,
        type,
        trusted: e.isTrusted,
        x: e.screenX ?? Math.round(e.clientX),
        y: e.screenY ?? Math.round(e.clientY),
        clickCount: e.detail,
        action: st ? st.action : '?',
        dragging: !!(st && st.behavior && st.behavior.__dragging)
      });
      if (log.length > 120) log.shift();
    };
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'dblclick']) {
      window.addEventListener(t, push(t), true);
    }
    return 'installed';
  })()`)
  console.log('探针：', ok)
} else if (mode === '--clear') {
  await evalJs('window.__trace && (window.__trace.length = 0); true')
  console.log('已清空')
} else {
  const rows = await evalJs('window.__trace || []')
  if (!rows || !rows.length) {
    console.log('（没有事件）')
  } else {
    const t0 = rows[0].t
    for (const r of rows) {
      console.log(
        `${String(r.t - t0).padStart(5)}ms  ${r.type.padEnd(12)} trusted=${r.trusted ? 'Y' : 'n'} detail=${r.clickCount} (${r.x},${r.y}) action=${r.action}`
      )
    }
    // 摘要：相邻 click 间隔
    const clicks = rows.filter((r) => r.type === 'click')
    const gaps = clicks.slice(1).map((c, i) => c.t - clicks[i].t)
    console.log(`\n摘要：click ${clicks.length} 次；相邻间隔 ${gaps.join(', ') || '—'} ms`)
  }
}

ws.close()
process.exit(0)
