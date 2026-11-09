/**
 * 生成所有内置角色的精灵图与应用图标。
 * 用 SVG 画每一帧再合成一张 PNG 帧表，避免二进制素材进仓库难以审阅。
 * 用法：npm run sprites
 *
 * 帧表布局：8 列 × 10 行，每格 64×64。
 * 行号与动作的对应关系写在各自的 manifest.json 里（actions.*.row）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const CELL = 64
const COLS = 8

/** 每行一个动作，frames 是该行用到的帧数（<= COLS） */
const ACTIONS = [
  {
    key: 'idle',
    frames: [{ dy: 0 }, { dy: -1 }, { dy: 0 }, { dy: 1, eyes: 'blink' }]
  },
  {
    key: 'jump',
    frames: [
      { dy: 0 },
      { dy: -5, eyes: 'wide' },
      { dy: -9, eyes: 'happy', sparkle: true, paw: 'up' },
      { dy: -3, sparkle: true }
    ]
  },
  { key: 'drag', frames: [{ rot: -8, ears: 'back' }, { rot: 8, ears: 'back' }] },
  {
    // 翻滚：整体绕身体中心转一整圈
    key: 'roll',
    frames: [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({
      rot: deg,
      eyes: 'happy',
      tail: -34,
      dy: deg % 180 === 0 ? 0 : -2
    }))
  },
  {
    // 爬行：压低身体、四爪交替
    key: 'crawl',
    frames: [
      { sy: 0.72, dy: 11, legs: 0, ears: 'back', tail: -34 },
      { sy: 0.72, dy: 10, legs: 1, ears: 'back', tail: -18 },
      { sy: 0.72, dy: 11, legs: 0, ears: 'back', tail: -30 },
      { sy: 0.72, dy: 10, legs: 1, ears: 'back', tail: -12 }
    ]
  },
  {
    // 蠕动：横向撑开 + 纵向压下，来回
    key: 'wiggle',
    frames: [
      { sx: 1.14, sy: 0.9, dy: 2, eyes: 'happy', tail: -38 },
      { sx: 0.92, sy: 1.09, dy: -1, eyes: 'happy', tail: -6 },
      { sx: 1.14, sy: 0.9, dy: 2, eyes: 'happy', tail: -38 },
      { sx: 0.92, sy: 1.09, dy: -1, eyes: 'happy', tail: -6 }
    ]
  },
  {
    // 转圈圈：原地转身，横向压扁再翻面
    key: 'spin',
    frames: [
      { sx: 1 },
      { sx: 0.78, dy: -2, tail: -42 },
      { sx: 0.42, dy: -4, tail: -52 },
      { sx: 0.12, dy: -2, flip: true },
      { sx: 0.45, dy: 0, flip: true, tail: -20 },
      { sx: 0.78, flip: true, tail: -34 },
      { sx: 1, flip: true },
      { sx: 1, dy: 0 }
    ]
  },
  {
    // 睡觉：闭眼、呼吸、冒 Z
    key: 'sleep',
    frames: [
      { eyes: 'sleep', zzz: 1, sy: 0.99 },
      { eyes: 'sleep', zzz: 2, sy: 1.01 },
      { eyes: 'sleep', zzz: 3, sy: 0.99 },
      { eyes: 'sleep', zzz: 2, sy: 1.01 }
    ]
  },
  {
    // 挥手：抬爪左右摆
    key: 'wave',
    frames: [
      { paw: 'up', eyes: 'happy', dy: -1 },
      { paw: 'up', eyes: 'happy', dy: -2, tilt: -8 },
      { paw: 'up', eyes: 'happy', dy: -2, tilt: 8 },
      { paw: 'up', eyes: 'happy' }
    ]
  },
  {
    // 头晕：左右晃 + 头顶转星星
    key: 'dizzy',
    frames: [
      { rot: -7, stars: 1, eyes: 'dizzy' },
      { rot: 6, stars: 2, eyes: 'dizzy' },
      { rot: -4, stars: 3, eyes: 'dizzy' },
      { rot: 5, stars: 1, eyes: 'dizzy' }
    ]
  }
]

const PALETTES = {
  blue: { body: '#7fd8ff', dark: '#4aa8d8', belly: '#e6f7ff', blush: '#ff9fb2', pattern: 'none' },
  orange: { body: '#ffb066', dark: '#dd8a3e', belly: '#fff7ec', blush: '#ff9fb2', pattern: 'stripes' },
  tuxedo: { body: '#5b6d89', dark: '#39485e', belly: '#f4f8ff', blush: '#9fb3d1', pattern: 'tuxedo' },
  calico: { body: '#f8f2e7', dark: '#d8c7ae', belly: '#ffffff', blush: '#ffb0b8', pattern: 'patches' }
}

const INK = '#0b2033'

/** 眼睛：open / wide / blink / happy / sleep / dizzy */
function eyesSvg(style) {
  switch (style) {
    case 'blink':
      return `<path d="M22.6 33.6 Q25.6 35.4 28.6 33.6" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>
              <path d="M35.6 33.6 Q38.6 35.4 41.6 33.6" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>`
    case 'happy':
      return `<path d="M22.4 34.4 Q25.6 30.8 28.8 34.4" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
              <path d="M35.4 34.4 Q38.6 30.8 41.8 34.4" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'sleep':
      return `<path d="M22.6 33.8 Q25.6 36 28.6 33.8" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
              <path d="M35.6 33.8 Q38.6 36 41.6 33.8" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'dizzy':
      return `<path d="M23 32.4 a3 3 0 1 0 5 2.6" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
              <path d="M36 32.4 a3 3 0 1 0 5 2.6" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`
    case 'wide':
      return `<ellipse cx="25.5" cy="33.4" rx="3" ry="3.8" fill="${INK}"/>
              <ellipse cx="38.5" cy="33.4" rx="3" ry="3.8" fill="${INK}"/>
              <circle cx="26.6" cy="32" r="1.3" fill="#ffffff"/>
              <circle cx="39.6" cy="32" r="1.3" fill="#ffffff"/>`
    default:
      return `<ellipse cx="25.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
              <ellipse cx="38.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
              <circle cx="26.4" cy="32.4" r="0.9" fill="#ffffff"/>
              <circle cx="39.4" cy="32.4" r="0.9" fill="#ffffff"/>`
  }
}

/** 花纹：叠加在身体上的装饰，猫种之间靠这里区分 */
function patternSvg(kind, P) {
  if (kind === 'stripes') {
    return `<g stroke="${P.dark}" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.85">
      <path d="M27 21.5 Q32 24.5 37 21.5"/>
      <path d="M25 26 Q32 29.5 39 26"/>
      <path d="M16.2 33 Q19.5 35 21 34"/>
      <path d="M47.8 33 Q44.5 35 43 34"/>
    </g>`
  }
  if (kind === 'tuxedo') {
    return `<path d="M32 26 C39 26 43 32 43 39 C43 47 38 52 32 52 C26 52 21 47 21 39 C21 32 25 26 32 26 Z"
              fill="${P.belly}" opacity="0.95"/>
            <ellipse cx="32" cy="38.6" rx="5.4" ry="3.6" fill="${P.belly}"/>`
  }
  if (kind === 'patches') {
    return `<path d="M19 24 C23 20 29 20 30 25 C31 30 24 32 20 30 Z" fill="#ffb066" opacity="0.9"/>
            <path d="M40 22 C45 23 48 28 45 31 C42 34 37 30 38 26 Z" fill="#5b6d89" opacity="0.85"/>
            <path d="M36 44 C41 43 45 47 43 51 C40 54 34 51 35 47 Z" fill="#ffb066" opacity="0.75"/>`
  }
  return ''
}

function zzzSvg(step) {
  const one = (x, y, s, o) =>
    `<path d="M${x} ${y} h${3.4 * s} l${-3.4 * s} ${3.4 * s} h${3.4 * s}"
       stroke="#9fd8ff" stroke-width="${1.1 * s}" fill="none" stroke-linecap="round"
       stroke-linejoin="round" opacity="${o}"/>`
  return `<g>
    ${step >= 1 ? one(43, 18, 1, 0.9) : ''}
    ${step >= 2 ? one(48, 11, 0.8, 0.7) : ''}
    ${step >= 3 ? one(51, 5.5, 0.62, 0.5) : ''}
  </g>`
}

function starsSvg(step) {
  const star = (x, y, r, o) =>
    `<path d="M${x} ${y - r} l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32}
      ${-r * 0.68} ${r * 0.32} ${-r * 0.32} ${r * 0.68}
      ${-r * 0.32} ${-r * 0.68} ${-r * 0.68} ${-r * 0.32}
      ${r * 0.68} ${-r * 0.32} Z" fill="#ffe27a" opacity="${o}"/>`
  const spots = [
    [16, 16],
    [47, 12],
    [32, 6]
  ]
  return `<g>${spots
    .map(([x, y], i) => (i === step % 3 ? star(x, y, 3.4, 0.95) : star(x, y, 2.2, 0.5)))
    .join('')}</g>`
}

/**
 * 单帧猫。
 * 所有姿态都是同一套矢量部件做变换，改配色/花纹就能换猫。
 */
function catSvg(o = {}, P) {
  const {
    dy = 0,
    rot = 0,
    tilt = 0,
    sx = 1,
    sy = 1,
    flip = false,
    eyes = 'open',
    paw = 'down',
    tail = -18,
    ears = 'up',
    legs = -1,
    zzz = 0,
    stars = 0,
    sparkle = false
  } = o

  const earBack = ears === 'back'
  const rotate = rot + tilt
  const sxw = (flip ? -1 : 1) * sx

  // 耳朵：正常立起 / 后压（爬行、被拎起时）
  const earsEl = earBack
    ? `<path d="M18 30 L15.5 22 L26 25 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>
       <path d="M46 30 L48.5 22 L38 25 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>`
    : `<path d="M18 30 L20 15 L30 23 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>
       <path d="M46 30 L44 15 L34 23 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>
       <path d="M22 25 L22.6 19.4 L26.8 23 Z" fill="${P.blush}" opacity="0.75"/>
       <path d="M42 25 L41.4 19.4 L37.2 23 Z" fill="${P.blush}" opacity="0.75"/>`

  // 四爪：爬行时露出，两两交替
  const legsEl =
    legs >= 0
      ? `<g fill="${P.belly}" stroke="${P.dark}" stroke-width="1.2">
           <ellipse cx="${legs ? 21 : 23.5}" cy="53.5" rx="4.2" ry="2.6"/>
           <ellipse cx="${legs ? 43 : 40.5}" cy="53.5" rx="4.2" ry="2.6"/>
         </g>`
      : ''

  // 前爪：普通垂放 / 抬起挥动
  const pawEl =
    paw === 'up'
      ? `<g transform="rotate(-18 45 40)">
           <ellipse cx="46.5" cy="36" rx="4.4" ry="5" fill="${P.belly}" stroke="${P.dark}" stroke-width="1.4"/>
           <path d="M44.6 32.6 l0.6 2 M46.8 32.2 l0.6 2 M49 32.6 l0.6 2"
                 stroke="${P.dark}" stroke-width="0.9" stroke-linecap="round"/>
         </g>`
      : `<g fill="${P.belly}" stroke="${P.dark}" stroke-width="1.2">
           <ellipse cx="27.4" cy="51.4" rx="4" ry="2.5"/>
           <ellipse cx="36.6" cy="51.4" rx="4" ry="2.5"/>
         </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 64 64">
  <ellipse cx="32" cy="58.4" rx="16.5" ry="3.2" fill="#000" opacity="0.14"/>
  <g transform="translate(32 ${34 + dy}) rotate(${rotate}) scale(${sxw} ${sy}) translate(-32 -34)">
    <g transform="rotate(${tail} 48 44)">
      <path d="M48 44 C54.5 42.5 57 36 53 31" stroke="${P.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>
    ${earsEl}
    <path d="M32 17 C44 17 50 26 50 36 C50 47 42 53 32 53 C22 53 14 47 14 36 C14 26 20 17 32 17 Z"
          fill="${P.body}" stroke="${P.dark}" stroke-width="1.8"/>
    ${patternSvg(P.pattern, P)}
    <path d="M24 44 C26 49 30 51 32 51 C34 51 38 49 40 44 C36 47 28 47 24 44 Z" fill="${P.belly}" opacity="0.8"/>
    ${legsEl}
    ${pawEl}
    ${eyesSvg(eyes)}
    <path d="M30.6 36.4 L33.4 36.4 L32 38 Z" fill="${P.blush}"/>
    <path d="M30.4 39.4 Q32 40.8 33.6 39.4" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="20.6" cy="38.6" rx="3" ry="1.8" fill="${P.blush}" opacity="0.5"/>
    <ellipse cx="43.4" cy="38.6" rx="3" ry="1.8" fill="${P.blush}" opacity="0.5"/>
    <g stroke="${P.dark}" stroke-width="0.9" opacity="0.7" stroke-linecap="round">
      <path d="M18.6 38.4 L12.6 37.4"/>
      <path d="M18.8 40.6 L13 41.6"/>
      <path d="M45.4 38.4 L51.4 37.4"/>
      <path d="M45.2 40.6 L51 41.6"/>
    </g>
    ${zzz ? zzzSvg(zzz) : ''}
    ${stars ? starsSvg(stars) : ''}
    ${
      sparkle
        ? `<g fill="#ffe27a"><path d="M52 18 l1.2 3.2 3.2 1.2 -3.2 1.2 -1.2 3.2 -1.2 -3.2 -3.2 -1.2 3.2 -1.2 Z"/>
             <path d="M12 22 l0.9 2.4 2.4 0.9 -2.4 0.9 -0.9 2.4 -0.9 -2.4 -2.4 -0.9 2.4 -0.9 Z"/></g>`
        : ''
    }
  </g>
</svg>`
}

const CHARACTERS = [
  {
    id: 'builtin-default',
    dir: 'plugins/builtin-default',
    name: '小卓',
    palette: 'blue',
    scale: 2,
    description: '内置示例角色：会呼吸、会眨眼，点一下会翻跟头'
  },
  {
    id: 'orange-tabby',
    dir: 'plugins/orange-tabby',
    name: '小橘',
    palette: 'orange',
    scale: 2,
    description: '橘猫，贪吃但灵活，爱蠕动着讨摸'
  },
  {
    id: 'tuxedo-cat',
    dir: 'plugins/tuxedo-cat',
    name: '小煤',
    palette: 'tuxedo',
    scale: 2,
    description: '燕尾服黑猫，走路带风，转圈圈最拿手'
  },
  {
    id: 'calico-cat',
    dir: 'plugins/calico-cat',
    name: '三花',
    palette: 'calico',
    scale: 2,
    description: '三花猫，慢吞吞，喜欢爬来爬去'
  }
]

/** 所有角色共用同一套动作表，只有配色与花纹不同 */
function manifestOf(ch) {
  return {
    id: ch.id,
    name: ch.name,
    version: '1.1.0',
    author: 'zhuochong',
    description: ch.description,
    license: 'CC0-1.0',
    minHost: '0.1.0',
    scale: ch.scale,
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
      jump: { row: 1, frames: 4, fps: 10, loop: false, next: 'idle' },
      drag: { row: 2, frames: 2, fps: 8, loop: true },
      roll: { row: 3, frames: 8, fps: 14, loop: false, next: 'idle' },
      crawl: { row: 4, frames: 4, fps: 6, loop: false, next: 'idle' },
      wiggle: { row: 5, frames: 4, fps: 8, loop: false, next: 'idle' },
      spin: { row: 6, frames: 8, fps: 12, loop: false, next: 'idle' },
      sleep: { row: 7, frames: 4, fps: 2.5, loop: true },
      wave: { row: 8, frames: 4, fps: 7, loop: false, next: 'idle' },
      dizzy: { row: 9, frames: 4, fps: 6, loop: false, next: 'idle' }
    },
    behavior: {
      click: ['jump', 'roll', 'spin', 'wiggle', 'wave', 'crawl'],
      ambient: ['crawl', 'wiggle', 'spin'],
      doubleClick: 'spin',
      combo: { count: 4, windowMs: 1600, action: 'dizzy' },
      sleep: { afterMs: 120000, action: 'sleep' },
      drag: 'drag',
      wake: 'jump'
    }
  }
}

const sheetH = CELL * ACTIONS.length
const sheetW = CELL * COLS

for (const ch of CHARACTERS) {
  const P = PALETTES[ch.palette]
  const composites = []
  ACTIONS.forEach((action, row) => {
    action.frames.forEach((frame, col) => {
      composites.push({
        input: Buffer.from(catSvg(frame, P)),
        left: col * CELL,
        top: row * CELL
      })
    })
  })

  await mkdir(ch.dir, { recursive: true })
  await sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(`${ch.dir}/spritesheet.png`)

  await writeFile(`${ch.dir}/manifest.json`, JSON.stringify(manifestOf(ch), null, 2) + '\n')
  console.log(`sprite sheet -> ${ch.dir}/spritesheet.png (${sheetW}x${sheetH}, ${ACTIONS.length} actions)`)
}

// 应用图标：小卓的头部特写
await mkdir('assets', { recursive: true })
const P = PALETTES.blue
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a1b33"/><stop offset="1" stop-color="#06101f"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <g transform="translate(512 540) scale(9.6) translate(-32 -32)">
    <path d="M18 30 L20 15 L30 23 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M46 30 L44 15 L34 23 Z" fill="${P.body}" stroke="${P.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M32 17 C44 17 50 26 50 36 C50 47 42 53 32 53 C22 53 14 47 14 36 C14 26 20 17 32 17 Z"
          fill="${P.body}" stroke="${P.dark}" stroke-width="1.8"/>
    <ellipse cx="25.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
    <ellipse cx="38.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
    <circle cx="26.4" cy="32.4" r="0.9" fill="#ffffff"/>
    <circle cx="39.4" cy="32.4" r="0.9" fill="#ffffff"/>
    <path d="M30.4 38.2 Q32 39.6 33.6 38.2" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
</svg>`

await writeFile('assets/app-icon.png', await sharp(Buffer.from(iconSvg)).png().toBuffer())
console.log('app icon -> assets/app-icon.png (1024x1024)')
