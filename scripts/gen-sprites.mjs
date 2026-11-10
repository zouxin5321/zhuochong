/**
 * 生成所有内置角色的精灵图与应用图标。
 * 用 SVG 画每一帧再合成一张 PNG 帧表，避免二进制素材进仓库难以审阅。
 * 用法：npm run sprites
 *
 * v1.3 重做形体系统：贴近动漫 Q 版角色比例（约 2.5 头身）——
 * 1) 大头小身：头部占身高 ~60%，圆脸颊 + 收窄下巴，五官大而集中；
 * 2) 结构分离：头 / 身体 / 手臂 / 脚丫是独立部件，手臂垂在体侧、
 *    脚踩在地面，不再是「一个圆球加两只耳朵」；
 * 3) 动漫眼睛：大竖椭圆 + 彩色虹膜 + 双高光，眨眼/开心/眩晕各有神态；
 * 4) 细节：额纹、腮毛、奶嘴线（鼻-嘴连线）、头侧绒毛、颈下投影；
 * 5) 焰甲保留头盔、龙角、胸甲、能量纹与节段尾，比例同样 Q 版化。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

/** 渲染分辨率：SVG 以矢量绘制，这里只决定栅格化密度 */
const CELL = 128/** 造型坐标系恒为 64×64，所有 path 坐标都按这个写 */
const COLS = 8

/** 每行一个动作，frames 是该行用到的帧数（<= COLS） */
const ACTIONS = [
  {
    key: 'idle',
    frames: [
      { dy: 0, headTilt: 0 },
      { dy: -1, headTilt: -1.6, earTwitch: true },
      { dy: 0, headTilt: 0 },
      { dy: 1, headTilt: 1.4, eyes: 'blink' }
    ]
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
      { sy: 0.74, dy: 9, legs: 0, ears: 'back', tail: -34 },
      { sy: 0.74, dy: 8, legs: 1, ears: 'back', tail: -18 },
      { sy: 0.74, dy: 9, legs: 0, ears: 'back', tail: -30 },
      { sy: 0.74, dy: 8, legs: 1, ears: 'back', tail: -12 }
    ]
  },
  {
    // 蠕动：横向撑开 + 纵向压下，来回
    key: 'wiggle',
    frames: [
      { sx: 1.12, sy: 0.92, dy: 2, eyes: 'happy', tail: -38 },
      { sx: 0.94, sy: 1.08, dy: -1, eyes: 'happy', tail: -6 },
      { sx: 1.12, sy: 0.92, dy: 2, eyes: 'happy', tail: -38 },
      { sx: 0.94, sy: 1.08, dy: -1, eyes: 'happy', tail: -6 }
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
      { paw: 'up', eyes: 'happy', dy: -2, tilt: -7 },
      { paw: 'up', eyes: 'happy', dy: -2, tilt: 7 },
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

/**
 * 配色：light 是受光面，dark 是背光面，shadow 是环境遮蔽，outline 是轮廓线。
 * eyeColor 是虹膜色，动漫眼睛的大高光靠它撑。
 */
const PALETTES = {
  blue: {
    light: '#d4f4ff',
    body: '#7fd8ff',
    dark: '#3d92c6',
    shadow: '#17557d',
    belly: '#f0fbff',
    blush: '#ff9fb2',
    eyeColor: '#2f7dff',
    eyeDark: '#143c8f',
    outline: '#123f5c',
    accent: '#7fd8ff',
    pattern: 'none'
  },
  orange: {
    light: '#ffe3bc',
    body: '#ffb066',
    dark: '#d37c35',
    shadow: '#844512',
    belly: '#fff7ec',
    blush: '#ff9fb2',
    eyeColor: '#e8940f',
    eyeDark: '#7c4a00',
    outline: '#5f3310',
    accent: '#ffd08a',
    pattern: 'stripes'
  },
  tuxedo: {
    light: '#9aafc9',
    body: '#5b6d89',
    dark: '#2f4055',
    shadow: '#111b28',
    belly: '#f4f8ff',
    blush: '#a8bcd6',
    eyeColor: '#ffd76e',
    eyeDark: '#8a5c06',
    outline: '#0c1520',
    accent: '#8fa6c4',
    pattern: 'tuxedo'
  },
  calico: {
    light: '#ffffff',
    body: '#f7f0e3',
    dark: '#c9ac89',
    shadow: '#82664a',
    belly: '#ffffff',
    blush: '#ffb0b8',
    eyeColor: '#d98a2b',
    eyeDark: '#7a4310',
    outline: '#4e3a28',
    accent: '#ffb066',
    pattern: 'patches'
  },
  /** 机甲龙猫：深钢外壳 + 熔岩橙能量纹，靠高对比发光在小尺寸下抓住视线 */
  mecha: {
    light: '#7e99bd',
    body: '#2c3648',
    dark: '#131a26',
    shadow: '#05080d',
    belly: '#c8d6e8',
    blush: '#ff8a5c',
    eyeColor: '#ffb266',
    eyeDark: '#8a4a1a',
    outline: '#04070c',
    accent: '#ff8f52',
    glow: '#ffb266',
    pattern: 'armor'
  }
}

const INK = '#101c2e'

/**
 * 体型定义（v1.3 动漫 Q 版结构）。
 * head 是脸的轮廓（大头），body 是躯干，二者是分离部件；
 * 耳朵/角/腮毛只定义左侧，右侧由镜像自动生成；
 * arm 定义垂放手臂（左侧），右侧镜像，wavePaw 是挥手抬起那只爪的位置；
 * feet 是脚丫参数，tail 是尾巴，face 各字段决定五官位置。
 */
const BREEDS = {
  /** 小卓：圆脸大头，小圆耳，短粗尾，最幼态的一只 */
  chubby: {
    head: 'M32 4.4 C43.6 4.4 51.2 11.8 51.2 21.4 C51.2 27.8 48 32.6 43.2 35 C39.6 36.8 35.8 37.6 32 37.6 C28.2 37.6 24.4 36.8 20.8 35 C16 32.6 12.8 27.8 12.8 21.4 C12.8 11.8 20.4 4.4 32 4.4 Z',
    earUp: 'M16.6 13.6 C15.4 8 17.4 4.4 21 4.2 C24.8 4 27.2 7.8 28 12.4 C24.6 11.2 20.2 11.9 16.6 13.6 Z',
    earBack: 'M16.4 14.2 C14.4 10.6 14.4 7.4 16.2 6.2 C19.4 7.8 22.4 9.6 25 11.4 Z',
    earInner: 'M18.6 11.2 C18.2 7.8 19.4 5.8 21.4 5.7 C23.6 5.6 25.1 8 25.7 10.8 C23.4 10.2 20.8 10.5 18.6 11.2 Z',
    body: 'M32 34.8 C40.2 34.8 45.4 40 46 46.8 C46.5 53.2 42 57.2 32 57.2 C22 57.2 17.5 53.2 18 46.8 C18.6 40 23.8 34.8 32 34.8 Z',
    belly: 'M32 42 C37.6 42 41 45.8 41.2 50.4 C41.4 54 37.8 56 32 56 C26.2 56 22.6 54 22.8 50.4 C23 45.8 26.4 42 32 42 Z',
    arm: { x: 20.4, y: 46.4, rot: 16, rx: 3.2, ry: 4.9 },
    wavePaw: [45.8, 39.8],
    footDX: 6.2,
    footY: 56.6,
    footRx: 4.6,
    footRy: 2.9,
    tail: 'M43.5 51.5 C52.5 50 55.5 42 50 35.8',
    tailWidth: 4.8,
    tailStyle: 'gradient',
    eyeY: 22.4,
    eyeSpread: 8.4,
    eyeRx: 3.8,
    eyeRy: 4.7,
    noseY: 28.8,
    mouthY: 30.6,
    blushY: 28.4,
    blushDX: 11.8,
    whiskerY: 27.6
  },

  /** 小橘：瘦一点的脸，大尖耳，额纹三道，长条纹尾 + 腮毛 */
  tabby: {
    head: 'M32 5 C42.8 5 49.8 12 49.8 21.2 C49.8 27.6 47.2 32.2 42.8 34.6 C39.4 36.4 35.7 37.2 32 37.2 C28.3 37.2 24.6 36.4 21.2 34.6 C16.8 32.2 14.2 27.6 14.2 21.2 C14.2 12 21.2 5 32 5 Z',
    earUp: 'M16.2 14.8 C14.6 8.6 15.8 3.6 19.4 2.6 C23.6 1.5 27.6 6.2 29.2 11.8 C25.2 10.6 20.4 11.6 16.2 14.8 Z',
    earBack: 'M16 15.4 C14.2 11 14.4 7.2 16.4 6 C20 7.4 23.4 9.4 26 11.4 Z',
    earInner: 'M18.8 12 C18 7.8 19 5.2 21 4.7 C23.4 4.1 25.8 7.2 27 10.8 C24.4 10 21.6 10.6 18.8 12 Z',
    body: 'M32 35 C38.8 35 43 39.6 43.6 46.2 C44.2 52.6 40.2 56.6 32 56.6 C23.8 56.6 19.8 52.6 20.4 46.2 C21 39.6 25.2 35 32 35 Z',
    belly: 'M32 43 C36.4 43 39.2 46.4 39.4 50.4 C39.6 53.8 36.6 55.6 32 55.6 C27.4 55.6 24.4 53.8 24.6 50.4 C24.8 46.4 27.6 43 32 43 Z',
    arm: { x: 21.4, y: 46.2, rot: 14, rx: 2.9, ry: 4.6 },
    wavePaw: [45.2, 39.6],
    footDX: 5.6,
    footY: 56,
    footRx: 4.2,
    footRy: 2.7,
    tail: 'M43 50.5 C55 47.5 58 33 51 24.5',
    tailWidth: 3.1,
    tailStyle: 'striped',
    eyeY: 22.2,
    eyeSpread: 8.2,
    eyeRx: 3.7,
    eyeRy: 4.6,
    noseY: 28.6,
    mouthY: 30.4,
    blushY: 28.2,
    blushDX: 11.6,
    whiskerY: 27.4,
    foreheadMarks: true,
    cheekTuft: 'M14.8 25.6 C11.6 24.6 10 26.2 11 28.2 C12 30.2 14 29.8 15.4 28.4 Z'
  },

  /** 小煤：方脸宽下巴，外张三角耳，白色大围兜，细长尾 */
  tuxedo: {
    head: 'M32 4.8 C43.6 4.8 51 11.4 51 20.8 C51 26.6 48.8 31.2 44.6 34.2 C40.9 36.8 36.5 37.6 32 37.6 C27.5 37.6 23.1 36.8 19.4 34.2 C15.2 31.2 13 26.6 13 20.8 C13 11.4 20.4 4.8 32 4.8 Z',
    earUp: 'M16 14.8 L13.6 4.4 L26.8 11 Z',
    earBack: 'M15.8 15.4 L13.8 7 L26 12.4 Z',
    earInner: 'M17.8 12.6 L16.6 7 L23.8 10.6 Z',
    body: 'M32 34.8 C40 34.8 45.6 39.4 46.2 46 C46.8 52.8 42 57.4 32 57.4 C22 57.4 17.2 52.8 17.8 46 C18.4 39.4 24 34.8 32 34.8 Z',
    belly: 'M32 41.4 C38.4 41.4 42 45.6 42.2 50.6 C42.4 54.4 38.4 56.4 32 56.4 C25.6 56.4 21.6 54.4 21.8 50.6 C22 45.6 25.6 41.4 32 41.4 Z',
    arm: { x: 20, y: 46.8, rot: 17, rx: 3.2, ry: 5 },
    wavePaw: [46, 40],
    footDX: 6.4,
    footY: 56.8,
    footRx: 4.7,
    footRy: 2.9,
    tail: 'M44 51.5 C53.5 50 56 40 51 34',
    tailWidth: 2.8,
    tailStyle: 'gradient',
    eyeY: 22.4,
    eyeSpread: 8.6,
    eyeRx: 3.8,
    eyeRy: 4.7,
    noseY: 28.8,
    mouthY: 30.6,
    blushY: 28.4,
    blushDX: 12,
    whiskerY: 27.6,
    muzzlePatch: true
  },

  /** 三花：蓬松长毛，圆折耳，脸颊两撮绒毛，头顶橘斑，最粗的尾巴 */
  calico: {
    head: 'M32 4.6 C43 4.6 50.6 11.6 50.6 21 C50.6 27.4 47.8 32.2 43.2 34.8 C39.5 36.9 35.8 37.7 32 37.7 C28.2 37.7 24.5 36.9 20.8 34.8 C16.2 32.2 13.4 27.4 13.4 21 C13.4 11.6 21 4.6 32 4.6 Z',
    earUp: 'M16.8 13.8 C15.2 9.6 16.8 6.2 20.4 5.8 C23.8 5.5 26 8.8 26.6 12.8 C23.4 11.8 19.8 12.3 16.8 13.8 Z',
    earBack: 'M16.4 14.6 C14.6 11 15 7.6 17 6.4 C20 7.8 23 9.8 25.6 11.8 Z',
    earInner: 'M18.8 11.6 C18.2 8.6 19.4 7 21.2 6.9 C23.2 6.8 24.4 8.8 25 11.2 C22.8 10.6 20.8 10.8 18.8 11.6 Z',
    headSpots: ['M38 8 C43 7.5 48 11 48.6 16.5 C49 20.5 45 21.5 41.5 19.5 C38.5 17.8 36.5 12.5 38 8 Z'],
    fluff: [
      'M13.8 24 C10.8 23.2 9.2 24.8 10 26.8 C10.8 28.8 13 28.6 14.6 27.2 Z',
      'M13.4 29 C11.2 28.8 10 30.2 10.8 31.8 C11.6 33.4 13.6 33 15 31.6 Z'
    ],
    body: 'M32 34.6 C41 34.6 46.6 39.6 47.4 46.6 C48.2 53.4 43 57.6 32 57.6 C21 57.6 15.8 53.4 16.6 46.6 C17.4 39.6 23 34.6 32 34.6 Z',
    belly: 'M32 42.6 C37.8 42.6 41.2 46.4 41.4 50.8 C41.6 54.2 37.8 56.2 32 56.2 C26.2 56.2 22.4 54.2 22.6 50.8 C22.8 46.4 26.2 42.6 32 42.6 Z',
    arm: { x: 20, y: 46.8, rot: 18, rx: 3.3, ry: 5 },
    wavePaw: [46, 40],
    footDX: 6.4,
    footY: 57,
    footRx: 4.8,
    footRy: 3,
    tail: 'M43.5 51.5 C53.5 50.5 57 41 52 33.5',
    tailWidth: 5.8,
    tailStyle: 'fluffy',
    eyeY: 22.4,
    eyeSpread: 8.4,
    eyeRx: 3.8,
    eyeRy: 4.7,
    noseY: 28.8,
    mouthY: 30.6,
    blushY: 28.4,
    blushDX: 11.8,
    whiskerY: 27.6
  },

  /**
   * 机甲龙猫：Q 版大头小身 + 硬核武装。
   * 头盔压住头顶，龙角从耳后弯出，胸甲与能量纹在小小的身体上。
   */
  mecha: {
    head: 'M32 4.6 C43.4 4.6 51 11.8 51 21.2 C51 27.6 47.8 32.4 43 34.9 C39.4 36.8 35.7 37.6 32 37.6 C28.3 37.6 24.6 36.8 21 34.9 C16.2 32.4 13 27.6 13 21.2 C13 11.8 20.6 4.6 32 4.6 Z',
    earUp: 'M15.6 14.4 L13.4 5.2 L25.4 11 Z',
    earBack: 'M15.4 15 L13.6 7.4 L25 12.6 Z',
    horns: 'M22.8 21.8 C15.8 18.8 13.2 10.4 17.6 5.2 C18 10.8 21 15.6 26.4 19 Z',
    helmet: 'M32 2.6 C42.8 2.6 50.4 9.4 51.5 17.8 C51.7 19.2 50.6 20.1 49.3 20 L14.7 20 C13.4 20.1 12.3 19.2 12.5 17.8 C13.6 9.4 21.2 2.6 32 2.6 Z',
    gem: true,
    body: 'M32 34.8 C40.4 34.8 45.6 40 46.2 46.8 C46.7 53.2 42.2 57.2 32 57.2 C21.8 57.2 17.3 53.2 17.8 46.8 C18.4 40 23.6 34.8 32 34.8 Z',
    belly: 'M32 42.6 C36.8 42.6 39.6 46 39.8 50 C40 53.4 36.8 55.4 32 55.4 C27.2 55.4 24 53.4 24.2 50 C24.4 46 27.2 42.6 32 42.6 Z',
    arm: { x: 20.2, y: 46.6, rot: 15, rx: 3.2, ry: 4.9 },
    wavePaw: [45.8, 39.8],
    footDX: 6.2,
    footY: 56.6,
    footRx: 4.6,
    footRy: 2.9,
    armor: 'M25.4 40.2 C28.6 38.4 35.4 38.4 38.6 40.2 L37.2 48.8 C34.4 50.8 29.6 50.8 26.8 48.8 Z',
    glowPath: 'M32 41.4 L29.8 46 L32 45.2 L30.6 50',
    tail: 'M43.5 51 C52.5 49.5 55.5 40.5 50.5 33.5',
    tailWidth: 3.4,
    tailStyle: 'segmented',
    eyeY: 23.2,
    eyeSpread: 8.2,
    eyeRx: 3.6,
    eyeRy: 4.4,
    noseY: 29.2,
    mouthY: 31,
    blushY: 28.8,
    blushDX: 11.8,
    whiskerY: 28,
    eyeStyle: 'glow',
    bellyOpacity: 0.4,
    whiskerLight: true
  }
}

/**
 * 眼睛：动漫式大眼。open/wide 是「大椭圆 + 彩虹膜 + 双高光」，
 * blink/happy/sleep 是弧线，dizzy 是螺旋，glow 是机甲竖瞳。
 */
function eyesSvg(style, y, spread, P, B) {
  const lx = 32 - spread
  const rx = 32 + spread
  const { eyeRx = 3.8, eyeRy = 4.7 } = B
  // 机甲体型：竖瞳 + 外发光，在深色外壳上才立得住
  if (P.eyeStyle === 'glow' && (style === 'open' || style === 'wide')) {
    const ry = style === 'wide' ? 4.9 : 4.4
    const one = (cx) => `
      <circle cx="${cx}" cy="${y}" r="5.4" fill="${P.glow}" opacity="0.14"/>
      <ellipse cx="${cx}" cy="${y}" rx="3.6" ry="${ry}" fill="#070c14"/>
      <ellipse cx="${cx}" cy="${y}" rx="1.15" ry="${ry * 0.62}" fill="${P.glow}"/>
      <ellipse cx="${cx}" cy="${y - ry * 0.35}" rx="0.5" ry="${ry * 0.32}" fill="#fff6e8"/>`
    return one(lx) + one(rx)
  }
  const openEye = (cx, s = 1) => `
      <ellipse cx="${cx}" cy="${y}" rx="${eyeRx * s}" ry="${eyeRy * s}" fill="${INK}"/>
      <ellipse cx="${cx}" cy="${y + 0.5}" rx="${eyeRx * 0.72 * s}" ry="${eyeRy * 0.66 * s}" fill="url(#irisG)"/>
      <ellipse cx="${cx}" cy="${y + 1.6}" rx="${eyeRx * 0.34 * s}" ry="${eyeRy * 0.22 * s}" fill="${P.eyeDark}" opacity="0.7"/>
      <ellipse cx="${cx}" cy="${y + eyeRy * s * 0.52}" rx="${eyeRx * 0.5 * s}" ry="${eyeRy * 0.18 * s}" fill="#ffffff" opacity="0.3"/>
      <circle cx="${cx - 1.2 * s}" cy="${y - 1.9 * s}" r="${1.5 * s}" fill="#ffffff"/>
      <circle cx="${cx + 1.2 * s}" cy="${y + 1.9 * s}" r="${0.75 * s}" fill="#ffffff" opacity="0.9"/>`
  switch (style) {
    case 'blink':
      return `<path d="M${lx - eyeRx} ${y + 0.2} Q${lx} ${y + 2.4} ${lx + eyeRx} ${y + 0.2}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
              <path d="M${rx - eyeRx} ${y + 0.2} Q${rx} ${y + 2.4} ${rx + eyeRx} ${y + 0.2}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'happy':
      return `<path d="M${lx - eyeRx - 0.3} ${y + 1.1} Q${lx} ${y - 3.4} ${lx + eyeRx + 0.3} ${y + 1.1}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
              <path d="M${rx - eyeRx - 0.3} ${y + 1.1} Q${rx} ${y - 3.4} ${rx + eyeRx + 0.3} ${y + 1.1}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    case 'sleep':
      return `<path d="M${lx - eyeRx} ${y + 0.4} Q${lx} ${y + 3} ${lx + eyeRx} ${y + 0.4}" stroke="${INK}" stroke-width="2.1" fill="none" stroke-linecap="round"/>
              <path d="M${rx - eyeRx} ${y + 0.4} Q${rx} ${y + 3} ${rx + eyeRx} ${y + 0.4}" stroke="${INK}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`
    case 'dizzy':
      return `<path d="M${lx - 3} ${y - 1.4} a3.2 3.2 0 1 0 5.2 2.8" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
              <path d="M${rx - 3} ${y - 1.4} a3.2 3.2 0 1 0 5.2 2.8" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    case 'wide':
      return openEye(lx, 1.18) + openEye(rx, 1.18)
    default:
      return openEye(lx) + openEye(rx)
  }
}

/** 花纹：叠加在躯干上的装饰，画在 bodyClip 里所以不会溢出轮廓 */
function patternSvg(kind, P) {
  if (kind === 'armor') {
    // 鳞甲：三排交错弧线，压得很淡，只做材质暗示，不抢脸的注意力
    return `<g stroke="${P.light}" stroke-width="0.7" fill="none" opacity="0.30">
      <path d="M20 26 Q24 28 28 26 M28 26 Q32 28 36 26 M36 26 Q40 28 44 26"/>
      <path d="M18 31 Q22 33 26 31 M26 31 Q30 33 34 31 M34 31 Q38 33 42 31 M42 31 Q45 32.6 47 31.4"/>
      <path d="M17 36.5 Q21 38.5 25 36.5 M25 36.5 Q29 38.5 33 36.5 M33 36.5 Q37 38.5 41 36.5"/>
      <path d="M18 42 Q22 44 26 42 M26 42 Q30 44 34 42 M34 42 Q38 44 42 42"/>
    </g>`
  }
  if (kind === 'stripes') {
    return `<g stroke="${P.dark}" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.75">
      <path d="M26 36.5 Q32 39.8 38 36.5"/>
      <path d="M22.5 41.5 Q32 45.8 41.5 41.5"/>
      <path d="M21 50 Q24 52 26.5 51.5"/>
      <path d="M43 50 Q40 52 37.5 51.5"/>
    </g>`
  }
  if (kind === 'patches') {
    return `<path d="M21 38 C25 36 29.5 37 30 41 C30.5 45 25 46.5 21.5 44.5 Z" fill="#ffb066" opacity="0.92"/>
            <path d="M40 40 C44.5 40.5 46.5 45 44 48 C41.5 50.5 37.5 47.5 38.5 43.5 Z" fill="#5b6d89" opacity="0.88"/>
            <path d="M35 51 C39 50.5 42 53.5 40.5 56 C39 58 34.5 56.5 35 53.5 Z" fill="#ffb066" opacity="0.78"/>
            <path d="M20 50 C23.5 49.5 25.5 52.5 24 55 C22.5 57.5 18.5 55.5 19.5 52.5 Z" fill="#5b6d89" opacity="0.6"/>`
  }
  return ''
}

function zzzSvg(step) {
  const one = (x, y, s, o) =>
    `<path d="M${x} ${y} h${3.4 * s} l${-3.4 * s} ${3.4 * s} h${3.4 * s}"
       stroke="#9fd8ff" stroke-width="${1.1 * s}" fill="none" stroke-linecap="round"
       stroke-linejoin="round" opacity="${o}"/>`
  return `<g>
    ${step >= 1 ? one(44, 14, 1, 0.9) : ''}
    ${step >= 2 ? one(49, 7, 0.8, 0.7) : ''}
    ${step >= 3 ? one(52, 1.5, 0.62, 0.5) : ''}
  </g>`
}

function starsSvg(step) {
  const star = (x, y, r, o) =>
    `<path d="M${x} ${y - r} l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32}
      ${-r * 0.68} ${r * 0.32} ${-r * 0.32} ${r * 0.68}
      ${-r * 0.32} ${-r * 0.68} ${-r * 0.68} ${-r * 0.32}
      ${r * 0.68} ${-r * 0.32} Z" fill="#ffe27a" opacity="${o}"/>`
  const spots = [
    [15, 12],
    [48, 8],
    [32, 3]
  ]
  return `<g>${spots
    .map(([x, y], i) => (i === step % 3 ? star(x, y, 3.4, 0.95) : star(x, y, 2.2, 0.5)))
    .join('')}</g>`
}

/** 渐变与裁剪定义：每个角色一套明暗，画体积全靠这里 */
function defsSvg(P, B) {
  return `<defs>
    <radialGradient id="bodyG" cx="0.36" cy="0.2" r="0.88">
      <stop offset="0" stop-color="${P.light}"/>
      <stop offset="0.34" stop-color="${P.body}"/>
      <stop offset="0.62" stop-color="${P.body}"/>
      <stop offset="0.88" stop-color="${P.dark}"/>
      <stop offset="1" stop-color="${P.shadow}"/>
    </radialGradient>
    <linearGradient id="irisG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.eyeDark}"/>
      <stop offset="0.45" stop-color="${P.eyeColor}"/>
      <stop offset="0.8" stop-color="${P.eyeColor}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="earG" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="${P.light}"/>
      <stop offset="0.55" stop-color="${P.body}"/>
      <stop offset="1" stop-color="${P.dark}"/>
    </linearGradient>
    <linearGradient id="shadeG" x1="0" y1="0.34" x2="0" y2="1">
      <stop offset="0" stop-color="${P.shadow}" stop-opacity="0"/>
      <stop offset="0.45" stop-color="${P.shadow}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${P.shadow}" stop-opacity="0.62"/>
    </linearGradient>
    <linearGradient id="tailG" x1="0" y1="0.2" x2="1" y2="1">
      <stop offset="0" stop-color="${P.body}"/>
      <stop offset="1" stop-color="${P.dark}"/>
    </linearGradient>
    <radialGradient id="shadowG" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#04101d" stop-opacity="0.34"/>
      <stop offset="0.55" stop-color="#04101d" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#04101d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hornG" x1="0" y1="1" x2="0.7" y2="0">
      <stop offset="0" stop-color="#8a6428"/>
      <stop offset="0.45" stop-color="#e6bd74"/>
      <stop offset="1" stop-color="#fff3d0"/>
    </linearGradient>
    <linearGradient id="steelG" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${P.light}"/>
      <stop offset="0.4" stop-color="${P.body}"/>
      <stop offset="1" stop-color="${P.dark}"/>
    </linearGradient>
    <clipPath id="bodyClip"><path d="${B.body}"/></clipPath>
    <clipPath id="headClip"><path d="${B.head}"/></clipPath>
  </defs>`
}

/** 尾巴：三种风格，蓬松款叠三条 stroke 做毛量感 */
function tailSvg(B, P, angle) {
  const t = `<g transform="rotate(${angle} 48 44)">`
  if (B.tailStyle === 'fluffy') {
    return `${t}
      <path d="${B.tail}" stroke="${P.dark}" stroke-width="${B.tailWidth + 2.4}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="${P.body}" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="${P.accent}" stroke-width="${B.tailWidth * 0.6}" fill="none" stroke-linecap="round" opacity="0.8"/>
      <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth + 2.4}" fill="none" stroke-linecap="round" opacity="0.18"/>
    </g>`
  }
  if (B.tailStyle === 'striped') {
    return `${t}
      <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth + 1.2}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="${P.body}" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="${P.dark}" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"
            stroke-dasharray="0.9 3.4" opacity="0.85"/>
    </g>`
  }
  if (B.tailStyle === 'segmented') {
    // 机械节段：粗底 + 深色切缝，末端一颗能量灯
    return `${t}
      <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth + 1.6}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="url(#steelG)" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"/>
      <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"
            stroke-dasharray="0.8 2.6" opacity="0.9"/>
      <path d="${B.tail}" stroke="${P.glow}" stroke-width="${B.tailWidth * 0.5}" fill="none" stroke-linecap="round"
            stroke-dasharray="0.7 2.7" opacity="0.85"/>
      <circle cx="50.7" cy="33.7" r="2.2" fill="${P.glow}" opacity="0.22"/>
      <circle cx="50.7" cy="33.7" r="1.15" fill="${P.glow}"/>
      <circle cx="50.7" cy="33.7" r="0.5" fill="#fff6e8"/>
    </g>`
  }
  return `${t}
    <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth + 1.2}" fill="none" stroke-linecap="round"/>
    <path d="${B.tail}" stroke="url(#tailG)" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"/>
  </g>`
}

/**
 * 伪立体倒角：把轮廓线朝背光方向平移后描粗边，在裁剪内形成背光侧厚暗弧；
 * 再朝受光方向平移描亮边，形成受光侧反光弧。两个弧之间的「明暗交界」
 * 给出体积转轴的错觉，是平面矢量画立体感的关键一步。
 */
function bevel(d, P, clipId) {
  return `<g clip-path="url(#${clipId})">
      <path d="${d}" fill="none" stroke="${P.shadow}" stroke-width="3" opacity="0.5" transform="translate(1.8 1.4)"/>
      <path d="${d}" fill="none" stroke="${P.light}" stroke-width="2" opacity="0.45" transform="translate(-1.4 -1.2)"/>
    </g>`
}

/** 躯干：渐变填充 + 裁剪内的倒角/遮蔽/高光/反光/颈下投影 + 轮廓与边缘光 */
function torsoSvg(B, P) {
  return `
    <path d="${B.body}" fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.7" stroke-linejoin="round"/>
    <g clip-path="url(#bodyClip)">
      <rect x="0" y="0" width="64" height="64" fill="url(#shadeG)"/>
      ${bevel(B.body, P, 'bodyClip')}
      <!-- 左上受光：三层同心椭圆叠出柔和高光 -->
      <ellipse cx="27" cy="39.5" rx="8" ry="6" fill="#ffffff" opacity="0.10"/>
      <ellipse cx="26.8" cy="39.2" rx="5" ry="3.8" fill="#ffffff" opacity="0.13"/>
      <!-- 手臂在身体两侧的落影（环境遮蔽） -->
      <ellipse cx="${B.arm.x + 2.2}" cy="${B.arm.y}" rx="3.4" ry="5" fill="${P.shadow}" opacity="0.24"/>
      <ellipse cx="${64 - B.arm.x - 2.2}" cy="${B.arm.y}" rx="3.4" ry="5" fill="${P.shadow}" opacity="0.24"/>
      <!-- 颈下投影：头压在身体上的落影，把两个部件「接」在一起 -->
      <ellipse cx="32" cy="39" rx="12.5" ry="3.4" fill="${P.shadow}" opacity="0.3"/>
      <!-- 底部反光：把身体从地面“托”起来 -->
      <ellipse cx="32" cy="55" rx="12" ry="3.6" fill="${P.light}" opacity="0.18"/>
    </g>
    <path d="${B.body}" fill="none" stroke="${P.light}" stroke-width="0.9" opacity="0.35"
          transform="translate(-0.55 -0.7)"/>`
}

/** 头部：耳朵/角/盔在头后，脸的渐变、绒毛高光、五官依次叠上 */
function headGroup(B, P, o) {
  const earBack = o.ears === 'back'
  const earD = earBack ? B.earBack : B.earUp
  // 左耳（可 twitch），右侧镜像；镜像用 translate(64 0) scale(-1 1)
  const earL = (d, extra = '') =>
    `<g${extra}><path d="${d}" fill="url(#earG)" stroke="${P.outline}" stroke-width="1.5" stroke-linejoin="round"/></g>`
  const twitchRot = o.earTwitch ? ` transform="rotate(-8 21 9)"` : ''
  const earInnerL =
    !earBack && B.earInner
      ? `<g${twitchRot}><path d="${B.earInner}" fill="${P.blush}" opacity="0.72"/></g>`
      : ''
  const earsEl =
    `<g>${earL(earD, twitchRot)}
       ${earInnerL}
       <g transform="translate(64 0) scale(-1 1)">
         <path d="${earD}" fill="url(#earG)" stroke="${P.outline}" stroke-width="1.5" stroke-linejoin="round"/>
         ${!earBack && B.earInner ? `<path d="${B.earInner}" fill="${P.blush}" opacity="0.72"/>` : ''}
       </g>
     </g>`

  // 龙角（耳后）
  const hornsEl = B.horns
    ? `<g><path d="${B.horns}" fill="url(#hornG)" stroke="${P.outline}" stroke-width="1.2" stroke-linejoin="round"/>
         <g transform="translate(64 0) scale(-1 1)">
           <path d="${B.horns}" fill="url(#hornG)" stroke="${P.outline}" stroke-width="1.2" stroke-linejoin="round"/>
         </g></g>`
    : ''

  // 头盔 + 额心宝石
  const helmetEl = B.helmet
    ? `<path d="${B.helmet}" fill="url(#steelG)" stroke="${P.outline}" stroke-width="1.4" stroke-linejoin="round"/>
       <path d="M32 3.4 C40 3.4 46.5 6.4 49.5 11.5" stroke="${P.light}" stroke-width="1" fill="none" opacity="0.6" stroke-linecap="round"/>
       ${
         B.gem
           ? `<circle cx="32" cy="10.5" r="3" fill="${P.glow}" opacity="0.25"/>
              <path d="M32 7.6 L34.2 10.5 L32 13.4 L29.8 10.5 Z" fill="${P.glow}" stroke="${P.outline}" stroke-width="0.8" stroke-linejoin="round"/>
              <circle cx="31.4" cy="9.8" r="0.7" fill="#fff6e8"/>`
           : ''
       }`
    : ''

  // 头顶绒毛感高光 + 耳朵投影 + 倒角 + 下巴反光（都裁剪在头轮廓里）
  const headShade = `
    <g clip-path="url(#headClip)">
      <rect x="0" y="0" width="64" height="64" fill="url(#shadeG)" opacity="0.8"/>
      ${bevel(B.head, P, 'headClip')}
      <!-- 耳朵压在头上的落影 -->
      <ellipse cx="21.5" cy="14.4" rx="4.6" ry="1.9" fill="${P.shadow}" opacity="0.26"/>
      <ellipse cx="42.5" cy="14.4" rx="4.6" ry="1.9" fill="${P.shadow}" opacity="0.26"/>
      <ellipse cx="25" cy="11" rx="10" ry="6.5" fill="#ffffff" opacity="0.20"/>
      <ellipse cx="24.6" cy="10.6" rx="6" ry="3.6" fill="#ffffff" opacity="0.26"/>
      <ellipse cx="32" cy="37.4" rx="10" ry="3" fill="${P.light}" opacity="0.16"/>
    </g>`

  // 头顶斑块（三花）
  const spotsEl = (B.headSpots || [])
    .map((d) => `<path d="${d}" fill="${P.accent}" opacity="0.9"/>`)
    .join('')
  const spotsClip = spotsEl ? `<g clip-path="url(#headClip)">${spotsEl}</g>` : ''

  // 腮毛（小橘一撮，三花两撮）
  const fluffEl = (B.fluff || (B.cheekTuft ? [B.cheekTuft] : []))
    .map(
      (d) =>
        `<path d="${d}" fill="${P.body}" stroke="${P.outline}" stroke-width="1.1" stroke-linejoin="round"/>`
    )
    .join('')
  const fluffAll = fluffEl
    ? `<g>${fluffEl}<g transform="translate(64 0) scale(-1 1)">${fluffEl}</g></g>`
    : ''

  // 白色口鼻围兜（小煤）
  const muzzleEl = B.muzzlePatch
    ? `<g clip-path="url(#headClip)">
         <ellipse cx="32" cy="31" rx="7" ry="5" fill="${P.belly}" opacity="0.9"/>
       </g>`
    : ''

  // 五官
  const faceEl = `
    ${eyesSvg(o.eyes, B.eyeY, B.eyeSpread, P, B)}
    <path d="M30.4 ${B.noseY - 0.7} L33.6 ${B.noseY - 0.7} L32 ${B.noseY + 1.3} Z"
          fill="${P.blush}" stroke="${P.outline}" stroke-width="0.5" stroke-linejoin="round"/>
    <path d="M32 ${B.noseY + 1.3} L32 ${B.mouthY - 0.4}" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>
    <path d="M29.2 ${B.mouthY} Q30.7 ${B.mouthY + 1.9} 32 ${B.mouthY + 0.2} Q33.3 ${B.mouthY + 1.9} 34.8 ${B.mouthY}"
          stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="${32 - B.blushDX}" cy="${B.blushY}" rx="3.2" ry="2" fill="${P.blush}" opacity="0.45"/>
    <ellipse cx="${32 + B.blushDX}" cy="${B.blushY}" rx="3.2" ry="2" fill="${P.blush}" opacity="0.45"/>
    <g stroke="${B.whiskerLight ? P.light : P.outline}" stroke-width="1"
       opacity="${B.whiskerLight ? 0.5 : 0.6}" stroke-linecap="round">
      <path d="M${32 - 12} ${B.whiskerY} L${32 - 17.5} ${B.whiskerY - 2}"/>
      <path d="M${32 - 12} ${B.whiskerY + 3} L${32 - 17.8} ${B.whiskerY + 3.6}"/>
      <path d="M${32 + 12} ${B.whiskerY} L${32 + 17.5} ${B.whiskerY - 2}"/>
      <path d="M${32 + 12} ${B.whiskerY + 3} L${32 + 17.8} ${B.whiskerY + 3.6}"/>
    </g>`

  // 额纹（小橘）
  const foreheadEl = B.foreheadMarks
    ? `<g stroke="${P.dark}" stroke-width="1.9" stroke-linecap="round" fill="none" opacity="0.8">
         <path d="M25.8 7.8 L27.6 12.2"/>
         <path d="M32 7 L32 11.8"/>
         <path d="M38.2 7.8 L36.4 12.2"/>
       </g>`
    : ''

  // 戴盔的角色让角/耳压在盔体上（像从盔里伸出来），其余角色耳根藏在头后
  const beforeHead = B.helmet ? '' : hornsEl + earsEl
  const afterHead = B.helmet ? hornsEl + earsEl : ''

  return `<g transform="rotate(${o.headTilt || 0} 32 30)">
    ${beforeHead}
    <path d="${B.head}" fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.7" stroke-linejoin="round"/>
    ${headShade}
    ${spotsClip}
    ${muzzleEl}
    ${helmetEl}
    ${afterHead}
    ${foreheadEl}
    ${fluffAll}
    ${faceEl}
  </g>`
}

/** 单帧角色：所有姿态都是同一套部件做变换，体型来自 BREED */
function chibiSvg(o, P, B) {
  const {
    dy = 0,
    rot = 0,
    tilt = 0,
    sx = 1,
    sy = 1,
    flip = false,
    paw = 'down',
    tail = -16,
    legs = -1,
    zzz = 0,
    stars = 0,
    sparkle = false
  } = o

  const rotate = rot + tilt
  const sxw = (flip ? -1 : 1) * sx

  // 落地投影：跳得越高越小越淡
  const shadowScale = Math.max(0.52, 1 + dy * 0.045)
  const shadowAlpha = Math.max(0.25, 1 + dy * 0.06)

  // 胸甲 + 能量纹：装甲盖住腹部，能量纹用三层描边模拟发光
  const armorEl = B.armor
    ? `<path d="${B.armor}" fill="url(#steelG)" stroke="${P.outline}" stroke-width="1.2" stroke-linejoin="round"/>
       <path d="${B.armor}" fill="none" stroke="${P.light}" stroke-width="0.6" opacity="0.5"
             transform="translate(0 -0.55)"/>
       <path d="M28.6 41.6 L35.4 41.6" stroke="${P.outline}" stroke-width="0.7" opacity="0.5"/>`
    : ''
  const glowEl = B.glowPath
    ? `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
         <path d="${B.glowPath}" stroke="${P.glow}" stroke-width="4.2" opacity="0.18"/>
         <path d="${B.glowPath}" stroke="${P.glow}" stroke-width="2.1" opacity="0.55"/>
         <path d="${B.glowPath}" stroke="#fff3dc" stroke-width="0.85"/>
       </g>`
    : ''

  // 手臂：垂放在体侧（左侧定义 + 镜像），挥手时右臂抬起
  const armL = `<g transform="rotate(${B.arm.rot} ${B.arm.x} ${B.arm.y - 3.5})">
      <ellipse cx="${B.arm.x}" cy="${B.arm.y}" rx="${B.arm.rx}" ry="${B.arm.ry}"
               fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.4"/>
      <path d="M${B.arm.x - 1.2} ${B.arm.y + B.arm.ry - 2.4} Q${B.arm.x} ${B.arm.y + B.arm.ry - 1.2} ${B.arm.x + 1.2} ${B.arm.y + B.arm.ry - 2.4}"
            stroke="${P.outline}" stroke-width="0.8" fill="none" opacity="0.55" stroke-linecap="round"/>
    </g>`
  const armR = `<g transform="translate(64 0) scale(-1 1)">${armL}</g>`
  const waveArm = `<g transform="rotate(-24 ${B.wavePaw[0]} ${B.wavePaw[1] + 4})">
      <ellipse cx="${B.wavePaw[0]}" cy="${B.wavePaw[1]}" rx="${B.arm.rx + 0.6}" ry="${B.arm.ry + 0.4}"
               fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.4"/>
      <path d="M${B.wavePaw[0] - 1.9} ${B.wavePaw[1] - 3.6} l0.6 2
               M${B.wavePaw[0] + 0.3} ${B.wavePaw[1] - 4} l0.6 2
               M${B.wavePaw[0] + 2.4} ${B.wavePaw[1] - 3.6} l0.6 2"
            stroke="${P.outline}" stroke-width="0.9" stroke-linecap="round"/>
    </g>`
  const armsEl = paw === 'up' ? armL + waveArm : armL + armR

  // 脚丫：两只小圆脚踩在地上，爬行时交替挪动
  const foot = (dx, extraRot = 0) =>
    `<g transform="rotate(${extraRot} ${32 + dx} ${B.footY - 2})">
       <ellipse cx="${32 + dx}" cy="${B.footY}" rx="${B.footRx}" ry="${B.footRy}"
                fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.3"/>
       <path d="M${32 + dx - 1.6} ${B.footY - 1.1} L${32 + dx - 1.6} ${B.footY + 0.7}
                M${32 + dx + 0.1} ${B.footY - 1.5} L${32 + dx + 0.1} ${B.footY + 0.9}
                M${32 + dx + 1.8} ${B.footY - 1.1} L${32 + dx + 1.8} ${B.footY + 0.7}"
             stroke="${P.outline}" stroke-width="0.7" opacity="0.5" stroke-linecap="round"/>
     </g>`
  const feetEl =
    legs >= 0
      ? foot(B.footDX + (legs ? -2.4 : 0), legs ? -10 : 0) + foot(-B.footDX + (legs ? 0 : 2.4), legs ? 0 : 10)
      : foot(B.footDX) + foot(-B.footDX)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 64 64">
  ${defsSvg(P, B)}
  <ellipse cx="32" cy="59.6" rx="${15.5 * shadowScale}" ry="${3.4 * shadowScale}"
           fill="url(#shadowG)" opacity="${shadowAlpha}"/>
  <!-- 接触暗核：紧贴脚下的深影，跳起时收得更小更淡 -->
  <ellipse cx="32" cy="59.2" rx="${8.5 * shadowScale}" ry="${1.8 * shadowScale}"
           fill="#04101d" opacity="${0.32 * shadowAlpha}"/>
  <g transform="translate(32 ${35 + dy}) rotate(${rotate}) scale(${sxw} ${sy}) translate(-32 -35)">
    ${tailSvg(B, P, tail)}
    ${torsoSvg(B, P)}
    <g clip-path="url(#bodyClip)">
      ${patternSvg(P.pattern, P)}
      <path d="${B.belly}" fill="${P.belly}" opacity="${B.bellyOpacity ?? 0.85}"/>
      ${armorEl}
      ${glowEl}
    </g>
    ${feetEl}
    ${armsEl}
    ${headGroup(B, P, o)}
    ${zzz ? zzzSvg(zzz) : ''}
    ${stars ? starsSvg(stars) : ''}
    ${
      sparkle
        ? `<g fill="#ffe27a"><path d="M52 16 l1.2 3.2 3.2 1.2 -3.2 1.2 -1.2 3.2 -1.2 -3.2 -3.2 -1.2 3.2 -1.2 Z"/>
             <path d="M12 20 l0.9 2.4 2.4 0.9 -2.4 0.9 -0.9 2.4 -0.9 -2.4 -2.4 -0.9 2.4 -0.9 Z"/></g>`
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
    breed: 'chubby',
    scale: 1,
    description: '圆脸大头的小蓝猫，会呼吸眨眼歪头，点一下翻跟头'
  },
  {
    id: 'orange-tabby',
    dir: 'plugins/orange-tabby',
    name: '小橘',
    palette: 'orange',
    breed: 'tabby',
    scale: 1,
    description: '大尖耳橘虎斑，额纹三道腮毛炸开，爱蠕动着讨摸'
  },
  {
    id: 'tuxedo-cat',
    dir: 'plugins/tuxedo-cat',
    name: '小煤',
    palette: 'tuxedo',
    breed: 'tuxedo',
    scale: 1,
    description: '方脸宽下巴的燕尾服猫，白围兜金瞳，转圈圈最拿手'
  },
  {
    id: 'calico-cat',
    dir: 'plugins/calico-cat',
    name: '三花',
    palette: 'calico',
    breed: 'calico',
    scale: 1,
    description: '蓬松长毛的三花，脸颊两撮绒毛大尾巴，慢吞吞地爬'
  },
  {
    id: 'mecha-dragon',
    dir: 'plugins/mecha-dragon',
    name: '焰甲',
    palette: 'mecha',
    breed: 'mecha',
    scale: 1,
    description: 'Q版机甲龙猫，头盔龙角与熔岩能量纹，看着凶其实很黏人'
  }
]

/** 所有角色共用同一套动作表，体型与配色各自不同 */
function manifestOf(ch) {
  return {
    id: ch.id,
    name: ch.name,
    version: '1.3.0',
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
  const B = BREEDS[ch.breed]
  const composites = []
  ACTIONS.forEach((action, row) => {
    action.frames.forEach((frame, col) => {
      composites.push({
        input: Buffer.from(chibiSvg(frame, P, B)),
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

// 应用图标：小卓的头部特写（复用同一帧矢量，保证和角色长得一样）
await mkdir('assets', { recursive: true })
const iconInner = chibiSvg({}, PALETTES.blue, BREEDS.chubby)
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a1b33"/><stop offset="1" stop-color="#06101f"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <g transform="translate(512 560) scale(8.6) translate(-32 -35)">
    ${iconInner}
  </g>
</svg>`

await writeFile('assets/app-icon.png', await sharp(Buffer.from(iconSvg)).png().toBuffer())
console.log('app icon -> assets/app-icon.png (1024x1024)')

// 文档配图：五角色 × 9 个代表动作
const PREVIEW_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 9]
const COL_OF = (row) => (row === 2 ? 0 : row === 7 || row === 9 ? 1 : 2)
const preview = []
for (let c = 0; c < CHARACTERS.length; c++) {
  for (let r = 0; r < PREVIEW_ROWS.length; r++) {
    const row = PREVIEW_ROWS[r]
    const buf = await sharp(`${CHARACTERS[c].dir}/spritesheet.png`)
      .extract({ left: COL_OF(row) * CELL, top: row * CELL, width: CELL, height: CELL })
      .resize(128, 128, { kernel: 'nearest' })
      .png()
      .toBuffer()
    preview.push({ input: buf, left: c * 128, top: r * 128 })
  }
}
await mkdir('docs', { recursive: true })
await sharp({
  create: {
    width: CHARACTERS.length * 128,
    height: PREVIEW_ROWS.length * 128,
    channels: 4,
    background: { r: 10, g: 22, b: 38, alpha: 1 }
  }
})
  .composite(preview)
  .png()
  .toFile('docs/preview.png')
console.log('preview -> docs/preview.png')
