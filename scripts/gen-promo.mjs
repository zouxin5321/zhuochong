/**
 * 宣传素材生成：真实鼠标驱动 + CDP 抓帧 + 合成演示 GIF。
 *
 * 流程（全部走真实输入链路，与用户手动操作一致）：
 *   待机呼吸 → 单击触发挥剑 → 双击 Lv1 跃焰斩 → Lv2 霜雷斩 → Lv3 烈阳斩(十字剑气)
 *
 * 前置：宿主带 --remote-debugging-port=9222 启动。
 * 用法：node scripts/gen-promo.mjs   （产出 docs/demo.gif）
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc

const BASE = process.env.CDP_BASE || 'http://127.0.0.1:9222'
const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'docs', 'demo.gif')
const SIZE = 320 // 输出画布
const FPS = 12
const DELAY = Math.round(1000 / FPS)
const BG = { r: 10, g: 18, b: 33 }

const list = await fetch(`${BASE}/json/list`).then((r) => r.json())
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('未找到宿主调试目标：请带 --remote-debugging-port=9222 启动')
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
const realClick = (mode, gap) => {
  const args = [join(here, 'realinput.py'), mode]
  if (gap) args.push('--gap', String(gap))
  return execFileSync('python', args, { encoding: 'utf8' }).trim()
}

/** 抓一段：duration 内按 FPS 采样画布，返回 { frames, label } */
async function capture(duration, label, labelColor = '#7df0ff') {
  const frames = []
  const labelSvg = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <text x="16" y="30" font-family="Microsoft YaHei, sans-serif" font-size="17"
         font-weight="bold" fill="${labelColor}" stroke="#060b14" stroke-width="3"
         paint-order="stroke">${label}</text>
     </svg>`
  )
  const n = Math.round(duration / DELAY)
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    const data = await evalJs('document.querySelector("#pet").toDataURL("image/png")')
    if (typeof data === 'string' && data.startsWith('data:image/png')) {
      // 等比放大到 SIZE 宽、底部居中贴到固定画布、叠标签
      const cell = await sharp(Buffer.from(data.split(',')[1], 'base64'))
        .resize(SIZE - 56, SIZE - 56, { kernel: 'lanczos3', fit: 'inside' })
        .png()
        .toBuffer()
      const meta = await sharp(cell).metadata()
      const left = Math.round((SIZE - meta.width) / 2)
      const top = Math.round(SIZE - 20 - meta.height)
      const composed = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BG } })
        .composite([
          { input: cell, left, top },
          { input: labelSvg, left: 0, top: 0 }
        ])
        .png()
        .toBuffer()
      frames.push(composed)
    }
    const spent = Date.now() - t0
    if (spent < DELAY) await sleep(DELAY - spent)
  }
  console.log(`  「${label}」抓到 ${frames.length} 帧`)
  return frames
}

// ---------- 开始录制 ----------
console.log('录制宣传演示 GIF（真实鼠标注入）')

// 复位可能残留的状态，回到待机
await evalJs(`(() => {
  document.querySelector('#pet').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return true;
})()`)
await sleep(2200)

const frames = []

// 1. 待机呼吸
frames.push(...(await capture(1600, '待机 · 会呼吸会眨眼')))

// 2. 单击 → 挥剑斩击（点几下直到抽到 slash）
console.log('  单击找挥剑动作…')
for (let i = 0; i < 8; i++) {
  realClick('click')
  await sleep(600)
  const a = await evalJs('window.__zhuochong.action')
  if (a === 'slash') break
  await sleep(1400)
}
frames.push(...(await capture(900, '单击 · 挥剑斩击')))
await sleep(5000) // 清空连点/大招窗口

// 3~5. 三连双击：Lv1 → Lv2 → Lv3
const levels = [
  ['Lv.1 跃焰斩', '#7df0ff'],
  ['Lv.2 霜雷斩', '#7ab8ff'],
  ['Lv.3 烈阳斩 · 全屏十字剑气', '#ffd76a']
]
for (const [label, color] of levels) {
  realClick('double', 140)
  await sleep(120)
  const a = await evalJs('window.__zhuochong.action')
  console.log(`  双击 → ${a}`)
  frames.push(...(await capture(2000, label, color)))
}

// 收尾：等窗口恢复，回待机
await sleep(2000)

// ---------- 合成 GIF ----------
console.log(`共 ${frames.length} 帧，编码 GIF…`)
const gif = GIFEncoder()
for (const png of frames) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const palette = quantize(data, 256)
  const index = applyPalette(data, palette)
  gif.writeFrame(index, info.width, info.height, { palette, delay: DELAY })
}
gif.finish()
writeFileSync(OUT, gif.bytes())
const kb = Math.round(gif.bytes().length / 1024)
console.log(`完成 → docs/demo.gif (${kb} KiB, ${frames.length} 帧, ${SIZE}x${SIZE} @${FPS}fps)`)
ws.close()
process.exit(0)
