/**
 * 生成内置角色的精灵图与应用图标。
 * 用 SVG 画帧再合成一张 PNG 帧表，避免二进制素材进仓库难以审阅。
 * 用法：npm run sprites
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const CELL = 64
const COLS = 8
const ROWS = 3

const BODY = '#7fd8ff'
const BODY_DARK = '#4aa8d8'
const BELLY = '#e6f7ff'
const INK = '#0b2033'
const BLUSH = '#ff9fb2'

/** 一只坐着的猫：dy 上下浮动、blink 眨眼、tilt 倾斜、sparkle 加星光 */
function frameSvg({ dy = 0, blink = false, tilt = 0, sparkle = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 64 64">
  <g transform="translate(32 50) rotate(${tilt}) translate(-32 -50) translate(0 ${dy})">
    <ellipse cx="32" cy="58" rx="17" ry="3.4" fill="#000" opacity="0.14"/>
    <path d="M18 30 L20 15 L30 23 Z" fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M46 30 L44 15 L34 23 Z" fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M22 25 L22.6 19.4 L26.8 23 Z" fill="${BLUSH}" opacity="0.75"/>
    <path d="M42 25 L41.4 19.4 L37.2 23 Z" fill="${BLUSH}" opacity="0.75"/>
    <path d="M32 17 C44 17 50 26 50 36 C50 47 42 53 32 53 C22 53 14 47 14 36 C14 26 20 17 32 17 Z"
          fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.8"/>
    <path d="M24 44 C26 49 30 51 32 51 C34 51 38 49 40 44 C36 47 28 47 24 44 Z" fill="${BELLY}" opacity="0.85"/>
    ${
      blink
        ? `<path d="M22.5 33.5 Q25.5 35.6 28.5 33.5" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
           <path d="M35.5 33.5 Q38.5 35.6 41.5 33.5" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
        : `<ellipse cx="25.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
           <ellipse cx="38.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
           <circle cx="26.4" cy="32.4" r="0.9" fill="#ffffff"/>
           <circle cx="39.4" cy="32.4" r="0.9" fill="#ffffff"/>`
    }
    <path d="M30.4 38.2 Q32 39.6 33.6 38.2" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="20.5" cy="38.5" rx="3" ry="1.8" fill="${BLUSH}" opacity="0.55"/>
    <ellipse cx="43.5" cy="38.5" rx="3" ry="1.8" fill="${BLUSH}" opacity="0.55"/>
    <path d="M48 44 C54 42 56 36 53 32" stroke="${BODY_DARK}" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${
      sparkle
        ? `<g fill="#ffe27a"><path d="M52 18 l1.2 3.2 3.2 1.2 -3.2 1.2 -1.2 3.2 -1.2 -3.2 -3.2 -1.2 3.2 -1.2 Z"/>
            <path d="M12 22 l0.9 2.4 2.4 0.9 -2.4 0.9 -0.9 2.4 -0.9 -2.4 -2.4 -0.9 2.4 -0.9 Z"/></g>`
        : ''
    }
  </g>
</svg>`
}

const frames = [
  // row 0：待机（呼吸 + 眨眼）
  { row: 0, col: 0, svg: frameSvg({ dy: 0 }) },
  { row: 0, col: 1, svg: frameSvg({ dy: -1 }) },
  { row: 0, col: 2, svg: frameSvg({ dy: 0 }) },
  { row: 0, col: 3, svg: frameSvg({ dy: 1, blink: true }) },
  // row 1：开心（跳一下 + 星光）
  { row: 1, col: 0, svg: frameSvg({ dy: 0 }) },
  { row: 1, col: 1, svg: frameSvg({ dy: -5 }) },
  { row: 1, col: 2, svg: frameSvg({ dy: -8, sparkle: true }) },
  { row: 1, col: 3, svg: frameSvg({ dy: -3, sparkle: true }) },
  // row 2：被拖动（左右晃）
  { row: 2, col: 0, svg: frameSvg({ tilt: -7 }) },
  { row: 2, col: 1, svg: frameSvg({ tilt: 7 }) }
]

const sheetW = CELL * COLS
const sheetH = CELL * ROWS
const composites = frames.map((f) => ({
  input: Buffer.from(f.svg),
  left: f.col * CELL,
  top: f.row * CELL
}))

const sheet = sharp({
  create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite(composites)

await mkdir('plugins/builtin-default', { recursive: true })
await sheet.png({ compressionLevel: 9 }).toFile('plugins/builtin-default/spritesheet.png')
console.log(`sprite sheet -> plugins/builtin-default/spritesheet.png (${sheetW}x${sheetH})`)

// 应用图标：同一只猫的头部特写
await mkdir('assets', { recursive: true })
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a1b33"/><stop offset="1" stop-color="#06101f"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <g transform="translate(512 540) scale(9.6) translate(-32 -32)">
    <path d="M18 30 L20 15 L30 23 Z" fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M46 30 L44 15 L34 23 Z" fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M32 17 C44 17 50 26 50 36 C50 47 42 53 32 53 C22 53 14 47 14 36 C14 26 20 17 32 17 Z"
          fill="${BODY}" stroke="${BODY_DARK}" stroke-width="1.8"/>
    <ellipse cx="25.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
    <ellipse cx="38.5" cy="33.5" rx="2.6" ry="3.2" fill="${INK}"/>
    <circle cx="26.4" cy="32.4" r="0.9" fill="#ffffff"/>
    <circle cx="39.4" cy="32.4" r="0.9" fill="#ffffff"/>
    <path d="M30.4 38.2 Q32 39.6 33.6 38.2" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
</svg>`

await writeFile('assets/app-icon.png', await sharp(Buffer.from(iconSvg)).png().toBuffer())
console.log('app icon -> assets/app-icon.png (1024x1024)')
