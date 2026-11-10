/**
 * 龙焰喵（dragon-flame）：AI 立绘 + 程序化动画。
 *
 * 与 gen-sprites.mjs 的矢量路线不同，本脚本消费 assets/dragon/ 下的
 * 4 张 AI 生成姿态图（待机/跳跃/睡觉/挥手），完成：
 * 1. 抠图：模型输出的是「画着棋盘格的不透明图」，从边缘泛洪填充
 *    把浅中性色（棋盘格）抠成真 alpha；
 * 2. 裁掉右下角水印文字；按 alpha 包围盒裁剪并归一化到 128×128 格子；
 * 3. 扫描青色发光眼的质心，用于待机/挥手时的「呼吸辉光」叠加；
 * 4. 睡姿的青色像素调暗（入睡熄灯）；
 * 5. 用 SVG <image> 承载位图做位移/旋转/挤压/翻面，叠加地面投影、
 *    Zzz、星星、龙焰余烬粒子，合成 8 列 × 10 行帧表；
 * 6. 输出 plugins/dragon-flame/ 精灵图 + manifest，并更新市场索引。
 *
 * 用法：node scripts/gen-dragon.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets', 'dragon')
const OUT = join(ROOT, 'plugins', 'dragon-flame')

const CELL = 128
const COLS = 8
const GROUND = 120 // 格子内地面线
const BODY_CY = 72 // 旋转轴心

const POSE_FILES = {
  idle: 'Redraw_the_exact_same_chibi_ca_2026-11-10T03-03-47.png',
  jump: 'The_exact_same_chibi_armored_c_2026-11-10T03-04-55.png',
  sleep: 'The_exact_same_chibi_armored_c_2026-11-10T03-05-10.png',
  wave: 'The_exact_same_chibi_armored_c_2026-11-10T03-05-23.png',
  walk: 'The_exact_same_chibi_armored_c_2026-11-10T04-01-28.png',
  sit: 'The_exact_same_chibi_armored_c_2026-11-10T04-01-41.png',
  slash: 'The_exact_same_chibi_armored_c_2026-11-10T04-01-59.png',
  power: 'The_exact_same_chibi_armored_c_2026-11-10T04-02-10.png'
}

/** 右下角水印区域（x>=x0 且 y>=y0 一律透明；四个姿态角色都不会到这里） */
const WATERMARK = { x0: 780, y0: 918 }

/**
 * 每个姿态的「口袋」种子矩形 [x0,y0,x1,y1]：翅膀/龙伴与头盔之间残留的
 * 棋盘格（大多被翅膀挡住看不到白格），从这些种子向四周泛洪清除。
 * 泛洪只穿过浅中性色（棋盘格），遇到深色盔甲/翼膜轮廓即停。
 */
const POCKET_SEEDS = {
  idle: [
    [470, 770, 600, 880],
    [370, 740, 445, 860],
    [390, 640, 445, 715]
  ],
  jump: [
    [650, 210, 760, 360],
    [290, 340, 460, 690],
    [590, 330, 700, 430]
  ],
  sleep: [
    [380, 735, 465, 845],
    [670, 780, 755, 840]
  ],
  wave: [
    [680, 220, 785, 375],
    [490, 770, 600, 860],
    [350, 475, 460, 550]
  ]
}

/** 棋盘格背景判定：浅色且接近中性灰 */
function isBgLike(r, g, b) {
  const mn = Math.min(r, g, b)
  const mx = Math.max(r, g, b)
  return mn >= 165 && mx - mn <= 38
}

/** 青色发光像素判定（眼睛辉光） */
function isCyan(r, g, b) {
  return r < 150 && g > 165 && b > 150 && g - r > 40
}

/** 从四边泛洪抠掉棋盘格，再柔化亮色边缘，清掉水印区 */
async function cutout(file) {
  const { data, info } = await sharp(join(ASSETS, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  const px = (x, y) => (y * w + x) * ch
  const visited = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    const i = y * w + x
    if (!visited[i]) {
      visited[i] = 1
      stack.push(i)
    }
  }
  const bgTest = (i) => {
    const o = i * ch
    return data[o + 3] === 0 || isBgLike(data[o], data[o + 1], data[o + 2])
  }
  for (let x = 0; x < w; x++) {
    if (bgTest(x)) push(x, 0)
    if (bgTest((h - 1) * w + x)) push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    if (bgTest(y * w)) push(0, y)
    if (bgTest(y * w + w - 1)) push(w - 1, y)
  }
  while (stack.length) {
    const i = stack.pop()
    const o = i * ch
    data[o + 3] = 0
    const x = i % w
    const y = (i / w) | 0
    if (x > 0 && bgTest(i - 1)) push(x - 1, y)
    if (x < w - 1 && bgTest(i + 1)) push(x + 1, y)
    if (y > 0 && bgTest(i - w)) push(x, y - 1)
    if (y < h - 1 && bgTest(i + w)) push(x, y + 1)
  }
  // 自动封闭区清除：泛洪后仍不透明的 bgLike 连通块（新姿态纯白背景里的
  // 四肢/剑/翅膀间空隙）只要面积够大就是背景，按面积阈值移除。
  {
    const seen = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      if (seen[i]) continue
      const o = i * ch
      if (data[o + 3] === 0 || !isBgLike(data[o], data[o + 1], data[o + 2])) {
        seen[i] = 1
        continue
      }
      const comp = [i]
      seen[i] = 1
      let head = 0
      while (head < comp.length) {
        const j = comp[head++]
        const x = j % w
        const y = (j / w) | 0
        for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) {
          if (k < 0 || seen[k]) continue
          const ko = k * ch
          if (data[ko + 3] !== 0 && isBgLike(data[ko], data[ko + 1], data[ko + 2])) {
            seen[k] = 1
            comp.push(k)
          }
        }
      }
      if (comp.length >= 250) for (const j of comp) data[j * ch + 3] = 0
    }
  }
  // 封闭区二次清除：翅膀/龙伴与头盔之间的「口袋」棋盘格，泛洪从边缘进不去。
  // 口袋的特征：连通块里同时有大量「白格(>=249)」和「灰格(<=228)」两种平坦色；
  // 盔甲高光是有渐变的单一色调，不会同时满足两个计数。
  {
    const isCand = (i) => {
      const o = i * ch
      if (data[o + 3] === 0) return false
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b)
      return mn >= 158 && mx - mn <= 14
    }
    const seen = new Uint8Array(w * h)
    const stack2 = []
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || !isCand(i)) continue
      stack2.length = 0
      stack2.push(i)
      seen[i] = 1
      const comp = [i]
      let white = 0, grey = 0
      while (stack2.length) {
        const j = stack2.pop()
        const v = data[j * ch]
        if (v >= 249) white++
        else if (v <= 228) grey++
        const x = j % w
        const y = (j / w) | 0
        for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) {
          if (k < 0 || seen[k] || !isCand(k)) continue
          seen[k] = 1
          stack2.push(k)
          comp.push(k)
        }
      }
      if (comp.length >= 120 && white >= 80 && grey >= 15) {
        for (const j of comp) data[j * ch + 3] = 0
      }
    }
  }
  // 口袋种子泛洪：从已知残留区向四周清除浅中性色
  {
    const bgish = (o) => {
      if (data[o + 3] === 0) return true // 已透明区域可穿过
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b)
      return mn >= 150 && mx - mn <= 30
    }
    const pass = new Uint8Array(w * h)
    const stack3 = []
    const seedPush = (i) => {
      if (!pass[i] && bgish(i * ch)) {
        pass[i] = 1
        stack3.push(i)
      }
    }
    for (const [x0, y0, x1, y1] of POCKET_SEEDS[file] || []) {
      for (let y = y0; y <= Math.min(y1, h - 1); y++) {
        for (let x = x0; x <= Math.min(x1, w - 1); x++) seedPush(y * w + x)
      }
    }
    while (stack3.length) {
      const i = stack3.pop()
      if (data[i * ch + 3] !== 0) data[i * ch + 3] = 0
      const x = i % w
      const y = (i / w) | 0
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (k >= 0 && !pass[k]) {
          pass[k] = 1
          if (bgish(k * ch)) stack3.push(k)
        }
      }
    }
  }
  // 边缘柔化：紧邻透明区的亮色像素多半是抗锯齿白边
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const o = i * ch
      if (data[o + 3] === 0) continue
      const nearTransparent =
        data[o - ch + 3] === 0 || data[o + ch + 3] === 0 || data[o - w * ch + 3] === 0 || data[o + w * ch + 3] === 0
      if (!nearTransparent) continue
      const mn = Math.min(data[o], data[o + 1], data[o + 2])
      const mx = Math.max(data[o], data[o + 1], data[o + 2])
      if (mn >= 140 && mx - mn <= 48) data[o + 3] = Math.round(data[o + 3] * 0.3)
    }
  }
  // 水印区直接透明
  for (let y = WATERMARK.y0; y < h; y++) {
    for (let x = WATERMARK.x0; x < w; x++) data[(y * w + x) * ch + 3] = 0
  }
  return { data, info }
}

/** 按 alpha 包围盒裁剪，等比缩到格子里，返回 128×128 画布上的 PNG 与青眼质心 */
async function normalizePose(cut, maxH = 114, maxW = 124) {
  const { data, info } = cut
  const { width: w, height: h, channels: ch } = info
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const scale = Math.min(maxH / bh, maxW / bw)
  const tw = Math.max(1, Math.round(bw * scale))
  const th = Math.max(1, Math.round(bh * scale))
  const cropped = await sharp(data, { raw: { width: w, height: h, channels: ch } })
    .extract({ left: x0, top: y0, width: bw, height: bh })
    .resize(Math.round(bw * scale * 2), Math.round(bh * scale * 2), { kernel: 'lanczos3' }) // 2x 超采样
    .png()
    .toBuffer()
  const half = await sharp(cropped)
    .resize(tw, th, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const left = Math.round((CELL - tw) / 2)
  const top = GROUND - th
  const canvas = await sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: half, left, top }])
    .png()
    .toBuffer()
  // 扫青眼质心（在最终画布坐标里）
  const { data: cd, info: ci } = await sharp(canvas).raw().toBuffer({ resolveWithObject: true })
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < ci.height; y++) {
    for (let x = 0; x < ci.width; x++) {
      const o = (y * ci.width + x) * ci.channels
      if (cd[o + 3] > 100 && isCyan(cd[o], cd[o + 1], cd[o + 2])) {
        sx += x
        sy += y
        n++
      }
    }
  }
  const eyes = n > 20 ? { x: sx / n, y: sy / n, r: Math.max(4, Math.sqrt(n / Math.PI) * 0.8) } : null
  return { png: canvas, eyes }
}

/** 睡姿熄灯：把青色像素压暗 */
async function dimCyan(pngBuf) {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] === 0) continue
    if (isCyan(data[i], data[i + 1], data[i + 2])) {
      data[i] = Math.round(data[i] * 0.4)
      data[i + 1] = Math.round(data[i + 1] * 0.42)
      data[i + 2] = Math.round(data[i + 2] * 0.45)
    } else if (data[i + 1] > 120 && data[i + 2] > 120 && data[i] < 200 && data[i + 1] - data[i] > 14) {
      // 辉光光晕
      data[i] = Math.round(data[i] * 0.5)
      data[i + 1] = Math.round(data[i + 1] * 0.52)
      data[i + 2] = Math.round(data[i + 2] * 0.55)
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer()
}

const zzzSvg = (step) => {
  const one = (x, y, s, o) =>
    `<path d="M${x} ${y} h${3.2 * s} l${-3.2 * s} ${3.2 * s} h${3.2 * s}" stroke="#9fd8ff"
       stroke-width="${1.2 * s}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`
  return `<g>${step >= 1 ? one(96, 30, 1.1, 0.95) : ''}${step >= 2 ? one(103, 21, 0.9, 0.7) : ''}${
    step >= 3 ? one(108, 14, 0.7, 0.5) : ''
  }</g>`
}

const starsSvg = (step) => {
  const star = (x, y, r, o) =>
    `<path d="M${x} ${y - r} l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32} ${-r * 0.68} ${r * 0.32}
      ${-r * 0.32} ${r * 0.68} ${-r * 0.32} ${-r * 0.68} ${-r * 0.68} ${-r * 0.32} ${r * 0.68} ${-r * 0.32} Z"
      fill="#ffe27a" opacity="${o}"/>`
  const spots = [
    [22, 26],
    [100, 18],
    [62, 8]
  ]
  return `<g>${spots.map(([x, y], i) => (i === step % 3 ? star(x, y, 4, 0.95) : star(x, y, 2.6, 0.5))).join('')}</g>`
}

/** 龙焰余烬：尾侧飘起的小火星，青-橙两色 */
const embersSvg = (step) => {
  const c = '#7df0ff'
  const o = '#ffb266'
  const dots = [
    [104, 96, 1.3, c, 0.9],
    [110, 84, 1.0, o, 0.8],
    [99, 72, 0.8, c, 0.65],
    [113, 62, 0.7, o, 0.5]
  ]
  const shift = [0, -3, -6, -3][step % 4]
  return `<g>${dots
    .map(
      ([x, y, r, col, op], i) =>
        `<circle cx="${x + (i % 2 ? 1.5 : -1) * ((step % 4) - 1.5)}" cy="${y + shift * (0.5 + i * 0.3)}" r="${r}" fill="${col}" opacity="${op}"/>
         <circle cx="${x}" cy="${y + shift * (0.5 + i * 0.3)}" r="${r * 2.2}" fill="${col}" opacity="${op * 0.18}"/>`
    )
    .join('')}</g>`
}

const sparkleSvg = () =>
  `<g fill="#ffe27a">
     <path d="M100 22 l1.4 3.8 3.8 1.4 -3.8 1.4 -1.4 3.8 -1.4 -3.8 -3.8 -1.4 3.8 -1.4 Z"/>
     <path d="M22 34 l1 2.8 2.8 1 -2.8 1 -1 2.8 -1 -2.8 -2.8 -1 2.8 -1 Z"/>
   </g>`

/** 眨眼：用暗色横椭圆盖住双眼光辉（面罩本来就是黑的，效果像闭眼） */
const blinkSvg = (eyes, t) => {
  if (!eyes) return ''
  const ry = eyes.r * (0.9 - 0.5 * t)
  return `<ellipse cx="${eyes.x}" cy="${eyes.y}" rx="${eyes.r * 3.4}" ry="${ry}"
    fill="#04070c" opacity="${0.72 + 0.2 * t}"/>`
}

/** 落地尘土：贴地的几粒灰尘扩散淡出 */
const dustSvg = (step) => {
  const grains = [
    [40, 116, 2.6],
    [52, 119, 2.0],
    [88, 117, 2.4],
    [78, 120, 1.8]
  ]
  const spread = [0, 3, 6, 9][Math.min(step, 3)]
  const op = [0.55, 0.4, 0.25, 0.12][Math.min(step, 3)]
  return `<g fill="#8fa3bd">${grains
    .map(
      ([x, y, r], i) =>
        `<circle cx="${x + (i % 2 ? spread : -spread)}" cy="${y - spread * 0.3}" r="${r}" opacity="${op}"/>`
    )
    .join('')}</g>`
}

/** 能量冲击环：脚下扩散的青色圆环 */
const ringsSvg = (step) => {
  const r = 8 + step * 11
  const op = Math.max(0.12, 0.6 - step * 0.16)
  return `<g fill="none" stroke="#6ef2ff" stroke-linecap="round">
    <ellipse cx="64" cy="${GROUND}" rx="${r}" ry="${r * 0.24}" stroke-width="1.8" opacity="${op}"/>
    <ellipse cx="64" cy="${GROUND}" rx="${r * 0.62}" ry="${r * 0.15}" stroke-width="1.2" opacity="${op * 0.7}"/>
  </g>`
}

/** 剑光挥击弧：跟随挥剑节奏的青色月牙 */
const arcSvg = (t) => {
  const op = 0.85 - t * 0.45
  return `<path d="M30 38 Q56 14 88 34" stroke="#7df0ff" stroke-width="${5 - t * 2}" fill="none"
    stroke-linecap="round" opacity="${op}"/>
    <path d="M24 46 Q54 20 94 40" stroke="#aef7ff" stroke-width="${2.4 - t}" fill="none"
    stroke-linecap="round" opacity="${op * 0.7}"/>`
}

/**
 * 单帧合成：位图姿态放进 SVG <image> 做形变，叠加投影与特效。
 * o: { pose, dx, dy, rot, sx, sy, flip, glow, zzz, stars, embers, sparkle,
 *      blink, dust, rings, arc, shadowRx }
 */
function frameSvg(o) {
  const {
    pose,
    dx = 0,
    dy = 0,
    rot = 0,
    sx = 1,
    sy = 1,
    flip = false,
    glow = 0,
    zzz = 0,
    stars = 0,
    embers = 0,
    sparkle = false,
    blink = false,
    dust = -1,
    rings = -1,
    arc = -1,
    eyes,
    shadowRx = 26
  } = o
  const jumpLift = Math.min(0, dy)
  const shadowScale = Math.max(0.5, 1 + jumpLift * 0.028)
  const shadowAlpha = Math.max(0.22, 1 + jumpLift * 0.03)
  const sxF = flip ? -sx : sx
  const transform = `translate(${dx} ${dy}) rotate(${rot} 64 ${BODY_CY}) translate(64 ${GROUND}) scale(${sxF} ${sy}) translate(-64 ${-GROUND})`
  const img = `<image href="data:image/png;base64,${pose.toString('base64')}" x="0" y="0" width="${CELL}" height="${CELL}" transform="${transform}" image-rendering="optimizeQuality"/>`
  const eyeInfo = eyes ?? POSES.idle.eyes
  const glowEl =
    glow > 0 && eyeInfo
      ? `<circle cx="${eyeInfo.x}" cy="${eyeInfo.y}" r="${eyeInfo.r * 3}" fill="#6ef2ff" opacity="${glow * 0.32}"/>`
      : ''
  const blinkEl = blink && eyeInfo ? blinkSvg(eyeInfo, 1) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">
    <ellipse cx="64" cy="${GROUND + 3}" rx="${shadowRx * shadowScale}" ry="${4.6 * shadowScale}" fill="#02080f" opacity="${0.16 * shadowAlpha}"/>
    <ellipse cx="64" cy="${GROUND + 2}" rx="${shadowRx * 0.55 * shadowScale}" ry="${2.6 * shadowScale}" fill="#02080f" opacity="${0.3 * shadowAlpha}"/>
    ${img}
    ${glowEl}
    ${blinkEl}
    ${arc >= 0 ? arcSvg(arc) : ''}
    ${rings >= 0 ? ringsSvg(rings) : ''}
    ${dust >= 0 ? dustSvg(dust) : ''}
    ${embers ? embersSvg(embers) : ''}
    ${zzz ? zzzSvg(zzz) : ''}
    ${stars ? starsSvg(stars) : ''}
    ${sparkle ? sparkleSvg() : ''}
  </svg>`
}

// ---------- 主流程 ----------
await mkdir(ASSETS, { recursive: true })
await mkdir(OUT, { recursive: true })

console.log('抠图与归一化...')
const POSES = {}
for (const [name, file] of Object.entries(POSE_FILES)) {
  const cut = await cutout(file)
  const norm = await normalizePose(cut)
  POSES[name] = norm
  console.log(`  ${name}: eyes=${norm.eyes ? `${norm.eyes.x.toFixed(0)},${norm.eyes.y.toFixed(0)} r${norm.eyes.r.toFixed(1)}` : 'none'}`)
}
POSES.sleepDim = { png: await dimCyan(POSES.sleep.png), eyes: null }

// 帧表：8 列 × 10 行，动作与既有宿主约定一致
const idleP = POSES.idle.png
const jumpP = POSES.jump.png
const waveP = POSES.wave.png
const sleepP = POSES.sleepDim.png
const walkP = POSES.walk.png
const sitP = POSES.sit.png
const slashP = POSES.slash.png
const powerP = POSES.power.png

const ACTIONS = [
  // idle：呼吸浮动 + 辉光呼吸 + 尾侧余烬
  {
    key: 'idle',
    frames: [
      { pose: idleP, glow: 0.1, embers: 0 },
      { pose: idleP, dy: -1.5, rot: -1.2, glow: 0.2, embers: 1 },
      { pose: idleP, glow: 0.13, embers: 2 },
      { pose: idleP, dy: 1, rot: 1, glow: 0.07, embers: 3 }
    ]
  },
  // blink：眨眼（面罩上青瞳收暗再亮起）
  {
    key: 'blink',
    frames: [
      { pose: idleP, glow: 0.08 },
      { pose: idleP, blink: true, glow: 0.02 },
      { pose: idleP, blink: true, glow: 0.02 },
      { pose: idleP, glow: 0.1 }
    ]
  },
  // walk：迈步行走（步点起伏 + 轻微前倾 + 影子随步收缩）
  {
    key: 'walk',
    frames: [
      { pose: walkP, rot: -1.5, shadowRx: 25 },
      { pose: walkP, rot: -2.5, dy: -2, dx: 1.5, shadowRx: 23 },
      { pose: walkP, rot: -1.5, shadowRx: 25 },
      { pose: walkP, rot: 0.5, dy: -1, dx: -1, shadowRx: 24 },
      { pose: walkP, rot: 1.5, shadowRx: 25 },
      { pose: walkP, rot: 2.5, dy: -2, dx: -1.5, shadowRx: 23 },
      { pose: walkP, rot: 1.5, shadowRx: 25 },
      { pose: walkP, rot: -0.5, dy: -1, dx: 1, shadowRx: 24 }
    ]
  },
  // run：小跑（更大起伏倾斜，带星光）
  {
    key: 'run',
    frames: [
      { pose: walkP, rot: -5, dy: -2, dx: 2, shadowRx: 22 },
      { pose: walkP, rot: -6, dy: -5, dx: 3, sparkle: true, shadowRx: 19 },
      { pose: walkP, rot: -5, dy: -2, dx: 2, shadowRx: 22 },
      { pose: walkP, rot: 5, dy: -2, dx: -2, shadowRx: 22 },
      { pose: walkP, rot: 6, dy: -5, dx: -3, sparkle: true, shadowRx: 19 },
      { pose: walkP, rot: 5, dy: -2, dx: -2, shadowRx: 22 }
    ]
  },
  // slash：挥剑（蓄力下蹲 → 斩击带剑光弧 → 收势扬尘）
  {
    key: 'slash',
    frames: [
      { pose: idleP, rot: -5, sy: 0.97, shadowRx: 24 },
      { pose: idleP, rot: -8, sy: 0.94, dy: 1, shadowRx: 25 },
      { pose: slashP, rot: -3, dy: -3, arc: 0, shadowRx: 22 },
      { pose: slashP, rot: 2, dy: -1, arc: 1, dust: 0, shadowRx: 24 },
      { pose: slashP, rot: 5, arc: 2, dust: 1, shadowRx: 24 },
      { pose: idleP, rot: 3, dy: 1, sy: 0.97, dust: 2, shadowRx: 25 }
    ]
  },
  // power：展翼蓄力（下蹲 → 升腾 → 双翼全开 + 能量冲击环）
  {
    key: 'power',
    frames: [
      { pose: idleP, sy: 0.9, dy: 3, shadowRx: 27 },
      { pose: idleP, sy: 0.96, dy: 1, glow: 0.15, shadowRx: 26 },
      { pose: powerP, dy: -4, glow: 0.5, rings: 0, embers: 1, shadowRx: 21 },
      { pose: powerP, dy: -6, glow: 0.4, rings: 1, embers: 2, sparkle: true, shadowRx: 19 },
      { pose: powerP, dy: -4, glow: 0.3, rings: 2, embers: 3, shadowRx: 21 },
      { pose: idleP, rings: 3, dust: 1, glow: 0.15, shadowRx: 25 }
    ]
  },
  // jump：下蹲起跳 + 空中星光 + 落地
  {
    key: 'jump',
    frames: [
      { pose: idleP, sy: 0.94, dy: 2, shadowRx: 27 },
      { pose: jumpP, dy: -14, sparkle: true, shadowRx: 22 },
      { pose: jumpP, dy: -22, rot: -3, sparkle: true, shadowRx: 18 },
      { pose: idleP, dy: -6, sy: 0.97, dust: 0, shadowRx: 24 },
      { pose: idleP, sy: 0.94, dy: 1, dust: 2, shadowRx: 26 }
    ]
  },
  // roll：翻滚
  {
    key: 'roll',
    frames: [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({
      pose: idleP,
      rot: deg,
      dy: deg % 180 === 0 ? 0 : -2
    }))
  },
  // spin：转圈圈
  {
    key: 'spin',
    frames: [
      { pose: idleP },
      { pose: idleP, sx: 0.78, dy: -2 },
      { pose: idleP, sx: 0.42, dy: -4 },
      { pose: idleP, sx: 0.12, dy: -2, flip: true },
      { pose: idleP, sx: 0.45, flip: true },
      { pose: idleP, sx: 0.78, flip: true },
      { pose: idleP, flip: true },
      { pose: idleP }
    ]
  },
  // crawl：匍匐爬行
  {
    key: 'crawl',
    frames: [
      { pose: walkP, sy: 0.72, dy: 4, dx: 0, rot: -2, shadowRx: 24 },
      { pose: walkP, sy: 0.72, dy: 4, dx: 2.4, rot: 0, shadowRx: 24 },
      { pose: walkP, sy: 0.72, dy: 4, dx: 0, rot: 2, shadowRx: 24 },
      { pose: walkP, sy: 0.72, dy: 4, dx: -2.4, rot: 0, shadowRx: 24 }
    ]
  },
  // sit：坐地休息（呼吸起伏 + 偶尔闭眼）
  {
    key: 'sit',
    frames: [
      { pose: sitP, sy: 0.99, shadowRx: 28 },
      { pose: sitP, sy: 1.01, glow: 0.12, shadowRx: 28 },
      { pose: sitP, sy: 0.99, blink: true, eyes: POSES.sit.eyes, shadowRx: 28 },
      { pose: sitP, sy: 1.01, glow: 0.1, eyes: POSES.sit.eyes, shadowRx: 28 }
    ]
  },
  // wave：挥手
  {
    key: 'wave',
    frames: [
      { pose: waveP, rot: -5, glow: 0.12 },
      { pose: waveP, rot: -7, dy: -1.5, glow: 0.2 },
      { pose: waveP, rot: 4, dy: -1.5, glow: 0.2 },
      { pose: waveP, glow: 0.12 }
    ]
  },
  // wiggle：扭一扭
  {
    key: 'wiggle',
    frames: [
      { pose: idleP, sx: 1.1, sy: 0.92, rot: -3 },
      { pose: idleP, sx: 0.94, sy: 1.06, rot: 3 },
      { pose: idleP, sx: 1.1, sy: 0.92, rot: -3 },
      { pose: idleP, sx: 0.94, sy: 1.06, rot: 3 }
    ]
  },
  // sleep：睡觉（青瞳熄灭 + zzz）
  {
    key: 'sleep',
    frames: [
      { pose: sleepP, zzz: 1, sy: 0.99, shadowRx: 30 },
      { pose: sleepP, zzz: 2, sy: 1.01, shadowRx: 30 },
      { pose: sleepP, zzz: 3, sy: 0.99, shadowRx: 30 },
      { pose: sleepP, zzz: 2, sy: 1.01, shadowRx: 30 }
    ]
  },
  // dizzy：头晕
  {
    key: 'dizzy',
    frames: [
      { pose: idleP, rot: -7, stars: 1 },
      { pose: idleP, rot: 6, stars: 2 },
      { pose: idleP, rot: -4, stars: 3 },
      { pose: idleP, rot: 5, stars: 1 }
    ]
  },
  // drag：被拎起来（悬空晃动，影子缩小）
  {
    key: 'drag',
    frames: [
      { pose: idleP, rot: -9, dy: 2, sx: 1.03, shadowRx: 14 },
      { pose: idleP, rot: 9, dy: 2, sx: 0.97, shadowRx: 14 }
    ]
  }
]

const sheetW = CELL * COLS
const sheetH = CELL * ACTIONS.length
const composites = []
ACTIONS.forEach((action, row) => {
  action.frames.forEach((frame, col) => {
    composites.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">${frameSvg(frame)}</svg>`
      ),
      left: col * CELL,
      top: row * CELL
    })
  })
})

await sharp({
  create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, 'spritesheet.png'))
console.log(`spritesheet -> ${OUT}/spritesheet.png (${sheetW}x${sheetH})`)

// 单帧大图预览（各动作代表帧），供人工目检
const previewCells = [
  ACTIONS[0].frames[1], // idle 呼吸
  ACTIONS[2].frames[1], // walk 迈步
  ACTIONS[4].frames[2], // slash 斩击
  ACTIONS[5].frames[3], // power 展翼
  ACTIONS[10].frames[1], // sit 坐
  ACTIONS[13].frames[1] // sleep 睡
]
const PREV = 256
const previewComps = []
for (let i = 0; i < previewCells.length; i++) {
  const big = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PREV}" height="${PREV}" viewBox="0 0 128 128">${frameSvg(previewCells[i])}</svg>`)
  )
    .png()
    .toBuffer()
  previewComps.push({ input: big, left: i * PREV, top: 0 })
}
await sharp({ create: { width: PREV * previewCells.length, height: PREV, channels: 4, background: { r: 16, g: 26, b: 44, alpha: 1 } } })
  .composite(previewComps)
  .png()
  .toFile(join(ROOT, 'docs', 'dragon-preview.png'))
console.log('preview -> docs/dragon-preview.png')

const manifest = {
  id: 'dragon-flame',
  name: '龙焰喵',
  version: '1.1.0',
  author: 'zhuochong',
  description: 'AI 立绘的机甲猫骑士：青焰竖瞳、背负小龙、盾剑随身，会行走小跑、挥剑斩击、展翼蓄力',
  license: 'CC0-1.0',
  minHost: '0.1.0',
  scale: 1,
  defaultAction: 'idle',
  sprite: {
    file: 'spritesheet.png',
    cellWidth: CELL,
    cellHeight: CELL,
    columns: COLS,
    rows: ACTIONS.length
  },
  actions: {
    idle: { row: 0, frames: 4, fps: 4, loop: true },
    blink: { row: 1, frames: 4, fps: 6, loop: false, next: 'idle' },
    walk: { row: 2, frames: 8, fps: 7, loop: false, next: 'idle' },
    run: { row: 3, frames: 6, fps: 12, loop: false, next: 'idle' },
    slash: { row: 4, frames: 6, fps: 10, loop: false, next: 'idle' },
    power: { row: 5, frames: 6, fps: 8, loop: false, next: 'idle' },
    jump: { row: 6, frames: 5, fps: 10, loop: false, next: 'idle' },
    roll: { row: 7, frames: 8, fps: 14, loop: false, next: 'idle' },
    spin: { row: 8, frames: 8, fps: 12, loop: false, next: 'idle' },
    crawl: { row: 9, frames: 4, fps: 6, loop: false, next: 'idle' },
    sit: { row: 10, frames: 4, fps: 3, loop: false, next: 'idle' },
    wave: { row: 11, frames: 4, fps: 7, loop: false, next: 'idle' },
    wiggle: { row: 12, frames: 4, fps: 8, loop: false, next: 'idle' },
    sleep: { row: 13, frames: 4, fps: 2.5, loop: true },
    dizzy: { row: 14, frames: 4, fps: 6, loop: false, next: 'idle' },
    drag: { row: 15, frames: 2, fps: 8, loop: true }
  },
  behavior: {
    click: ['jump', 'slash', 'power', 'roll', 'spin', 'wave', 'wiggle', 'run'],
    ambient: ['walk', 'sit', 'wiggle', 'crawl', 'blink'],
    doubleClick: 'spin',
    combo: { count: 4, windowMs: 1600, action: 'dizzy' },
    sleep: { afterMs: 120000, action: 'sleep' },
    drag: 'drag',
    wake: 'power'
  }
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('manifest -> plugins/dragon-flame/manifest.json')
