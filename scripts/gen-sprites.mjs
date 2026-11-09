/**
 * 生成所有内置角色的精灵图与应用图标。
 * 用 SVG 画每一帧再合成一张 PNG 帧表，避免二进制素材进仓库难以审阅。
 * 用法：npm run sprites
 *
 * 帧表布局：8 列 × 10 行。
 *
 * v1.2 两个变化：
 * 1) 造型分体型（BREEDS）：身体轮廓、耳形、尾巴、脸距、爪位各自独立，
 *    不再是「同一个圆身体换四套配色」。
 * 2) 立体光影：径向底色 + 底部环境遮蔽 + 左上高光 + 底部反光 + 边缘光，
 *    落地投影随跳跃高度变化。帧格 64 → 128，viewBox 仍是 64（矢量放大），
 *    保证渐变与描边在放大显示时不糊。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

/** 渲染分辨率：SVG 以矢量绘制，这里只决定栅格化密度 */
const CELL = 128
/** 造型坐标系恒为 64×64，所有 path 坐标都按这个写 */
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

/**
 * 配色：light 是受光面，dark 是背光面，shadow 是环境遮蔽，outline 是轮廓线。
 * 每个角色都带一组完整明暗，才能画出体积。
 */
const PALETTES = {
  blue: {
    light: '#c9f2ff',
    body: '#7fd8ff',
    dark: '#3d92c6',
    shadow: '#17557d',
    belly: '#ecfbff',
    blush: '#ff9fb2',
    outline: '#123f5c',
    accent: '#7fd8ff',
    pattern: 'none'
  },
  orange: {
    light: '#ffe0b8',
    body: '#ffb066',
    dark: '#d37c35',
    shadow: '#844512',
    belly: '#fff7ec',
    blush: '#ff9fb2',
    outline: '#5f3310',
    accent: '#ffd08a',
    pattern: 'stripes'
  },
  tuxedo: {
    light: '#93a8c4',
    body: '#5b6d89',
    dark: '#2f4055',
    shadow: '#111b28',
    belly: '#f4f8ff',
    blush: '#a8bcd6',
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
    outline: '#4e3a28',
    accent: '#ffb066',
    pattern: 'patches'
  },
  /** 机甲龙猫：深钢外壳 + 熔岩橙能量纹，靠高对比发光在小尺寸下抓住视线 */
  mecha: {
    light: '#6f8bb0',
    body: '#2c3648',
    dark: '#131a26',
    shadow: '#05080d',
    belly: '#c8d6e8',
    blush: '#ff8a5c',
    outline: '#04070c',
    accent: '#ff8f52',
    glow: '#ffb266',
    pattern: 'armor'
  }
}

const INK = '#0b2033'

/**
 * 体型定义。
 * body 是躯干轮廓，earUp / earBack 是左右两只耳朵，tail 是尾巴路径，
 * eyes/face 决定五官位置，paws/legs 决定爪位，wavePaw 是挥手时抬起那只爪子的位置。
 * 这些值都是 64×64 坐标系下的绝对坐标，手调出来的四个不同体型。
 */
const BREEDS = {
  /** 小卓：圆胖一团，短耳短尾，脸最低最圆 */
  chubby: {
    body: 'M32 16 C45.5 16 52 25.5 52 36.5 C52 47.5 43.5 55 32 55 C20.5 55 12 47.5 12 36.5 C12 25.5 18.5 16 32 16 Z',
    earUp: [
      'M19.5 28 C19 21.5 20.5 16 22 15 C25.5 18 28.5 20.5 30.5 22.5 Z',
      'M44.5 28 C45 21.5 43.5 16 42 15 C38.5 18 35.5 20.5 33.5 22.5 Z'
    ],
    earBack: [
      'M19.5 28.5 C18 25 17.5 21.5 19 20 C22 21.5 25 23 27.5 24.5 Z',
      'M44.5 28.5 C46 25 46.5 21.5 45 20 C42 21.5 39 23 36.5 24.5 Z'
    ],
    earInner: [
      'M21.5 25.5 C21.3 21.8 22.1 18.8 22.9 18 C25.2 20 27 21.7 28.2 22.8 Z',
      'M42.5 25.5 C42.7 21.8 41.9 18.8 41.1 18 C38.8 20 37 21.7 35.8 22.8 Z'
    ],
    tail: 'M47 45.5 C54 44.5 57 38.5 53.5 33.5',
    tailWidth: 3.8,
    tailStyle: 'gradient',
    eyeY: 33.5,
    eyeSpread: 6.4,
    noseY: 37.2,
    mouthY: 39.2,
    blushY: 38.4,
    blushX: 11.2,
    whiskerY: 38.6,
    paws: [
      [27.2, 51.4],
      [36.8, 51.4]
    ],
    legs: [23.5, 40.5],
    legY: 53.5,
    wavePaw: [46.5, 35.6],
    belly:
      'M24 44 C26 49.4 30 51.4 32 51.4 C34 51.4 38 49.4 40 44 C36 47.2 28 47.2 24 44 Z'
  },

  /** 小橘：瘦高个，大尖耳，长尾巴带环纹，脸颊有腮毛 */
  tabby: {
    body: 'M32 11.5 C42.5 11.5 48 21 48 33.5 C48 45.5 41.5 54 32 54 C22.5 54 16 45.5 16 33.5 C16 21 21.5 11.5 32 11.5 Z',
    earUp: [
      'M17.5 26 C17 19 18 11 19.5 9.5 C24 14 28.5 19 30.5 21.5 Z',
      'M46.5 26 C47 19 46 11 44.5 9.5 C40 14 35.5 19 33.5 21.5 Z'
    ],
    earBack: [
      'M17.5 26.5 C16 22.5 15.5 18.5 17 17 C20.5 19 24 21 26.5 22.8 Z',
      'M46.5 26.5 C48 22.5 48.5 18.5 47 17 C43.5 19 40 21 37.5 22.8 Z'
    ],
    earInner: [
      'M19.8 23.6 C19.6 18.6 20.2 14.4 21 13.2 C24 16.6 26.6 19.4 28 21.2 Z',
      'M44.2 23.6 C44.4 18.6 43.8 14.4 43 13.2 C40 16.6 37.4 19.4 36 21.2 Z'
    ],
    tail: 'M47.5 43.5 C57 41.5 60 30 54.5 22.5',
    tailWidth: 3,
    tailStyle: 'striped',
    eyeY: 31.5,
    eyeSpread: 6.2,
    noseY: 35.4,
    mouthY: 37.4,
    blushY: 36.6,
    blushX: 12,
    whiskerY: 36.8,
    paws: [
      [27.4, 50.6],
      [36.6, 50.6]
    ],
    legs: [23.5, 40.5],
    legY: 52.8,
    wavePaw: [46, 33.6],
    cheekTuft: true,
    belly:
      'M24.5 42.5 C26.5 48 30 50.4 32 50.4 C34 50.4 37.5 48 39.5 42.5 C35.5 46 28.5 46 24.5 42.5 Z'
  },

  /** 小煤：肩宽方脸，耳朵大而外张，尾巴细长上勾 */
  tuxedo: {
    body: 'M32 14.5 C43.5 14.5 50 20 50 29 C50 33.4 49.4 38 48 42.5 C45.6 50.5 39.6 55 32 55 C24.4 55 18.4 50.5 16 42.5 C14.6 38 14 33.4 14 29 C14 20 20.5 14.5 32 14.5 Z',
    earUp: [
      'M17.8 27.5 L14.5 12.5 L28.6 20.4 Z',
      'M46.2 27.5 L49.5 12.5 L35.4 20.4 Z'
    ],
    earBack: [
      'M18 28 L15 19 L27 23.5 Z',
      'M46 28 L49 19 L37 23.5 Z'
    ],
    earInner: [
      'M18.6 24 L17 17 L23.5 21 Z',
      'M45.4 24 L47 17 L40.5 21 Z'
    ],
    tail: 'M48 45.5 C55.5 44 57.5 34.5 52.5 29.5',
    tailWidth: 2.8,
    tailStyle: 'gradient',
    eyeY: 33,
    eyeSpread: 6.8,
    noseY: 37,
    mouthY: 39,
    blushY: 38,
    blushX: 11.6,
    whiskerY: 38,
    paws: [
      [27, 50.8],
      [37, 50.8]
    ],
    legs: [23, 41],
    legY: 52.8,
    wavePaw: [47, 35],
    belly:
      'M25 43 C27 48.6 30.4 51 32 51 C33.6 51 37 48.6 39 43 C35.6 46.4 28.4 46.4 25 43 Z'
  },

  /** 三花：蓬松长毛，折耳，尾巴最粗，脸稍宽 */
  calico: {
    body: 'M32 14 C38.5 14 44.5 17.5 47.5 23 C50.5 28.5 51.5 36 50 43 C48.8 48.6 46 53 41.5 55.4 C38.5 57 35 57 32 57 C29 57 25.5 57 22.5 55.4 C18 53 15.2 48.6 14 43 C12.5 36 13.5 28.5 16.5 23 C19.5 17.5 25.5 14 32 14 Z',
    earUp: [
      'M19 27.5 C16.8 22.4 18.6 17.8 22.8 17.4 C25.8 17.2 27.8 20 27.8 23.4 Z',
      'M45 27.5 C47.2 22.4 45.4 17.8 41.2 17.4 C38.2 17.2 36.2 20 36.2 23.4 Z'
    ],
    earBack: [
      'M19 28 C17.4 24 17 20.6 18.6 19.4 C21.6 21 24.6 23 26.8 24.6 Z',
      'M45 28 C46.6 24 47 20.6 45.4 19.4 C42.4 21 39.4 23 37.2 24.6 Z'
    ],
    earInner: [
      'M20.4 24.4 C19.4 21.4 20.4 19.2 22.6 19.2 C24.2 19.2 25.4 21 25.4 22.8 Z',
      'M43.6 24.4 C44.6 21.4 43.6 19.2 41.4 19.2 C39.8 19.2 38.6 21 38.6 22.8 Z'
    ],
    tail: 'M46.5 45 C55.5 45 59 37 55.5 29.5',
    tailWidth: 5.6,
    tailStyle: 'fluffy',
    eyeY: 33.5,
    eyeSpread: 6.6,
    noseY: 37.4,
    mouthY: 39.4,
    blushY: 38.6,
    blushX: 11.4,
    whiskerY: 38.8,
    paws: [
      [27, 52],
      [37, 52]
    ],
    legs: [23, 41],
    legY: 54,
    wavePaw: [46.5, 36.2],
    belly:
      'M24.5 45 C26.5 50 30 52.2 32 52.2 C34 52.2 37.5 50 39.5 45 C35.5 48.2 28.5 48.2 24.5 45 Z'
  },

  /**
   * 机甲龙猫：Q 版圆身 + 硬核武装。
   * 反差萌的关键是「比例还是幼体」——大头短腿圆脸，但披甲、长角、尾巴带节段。
   */
  mecha: {
    body: 'M32 15 C42.5 15 48.6 20.2 50.4 28.4 C51.8 34 51 40 48.8 45 C46.6 50.6 40.4 54.6 32 54.6 C23.6 54.6 17.4 50.6 15.2 45 C13 40 12.2 34 13.6 28.4 C15.4 20.2 21.5 15 32 15 Z',
    earUp: [
      'M19.4 25.6 L17.6 16 L27.6 22 Z',
      'M44.6 25.6 L46.4 16 L36.4 22 Z'
    ],
    earBack: [
      'M19.6 26.4 C17.8 23.4 17.4 20.4 18.8 19.4 C21.6 21 24.4 22.8 26.6 24.2 Z',
      'M44.4 26.4 C46.2 23.4 46.6 20.4 45.2 19.4 C42.4 21 39.6 22.8 37.4 24.2 Z'
    ],
    earInner: [
      'M20.6 23.4 L19.6 18.4 L24.8 21.4 Z',
      'M43.4 23.4 L44.4 18.4 L39.2 21.4 Z'
    ],
    // 龙角：从耳后向外上方弯出，末端回收，和耳朵明显区分
    horns: [
      'M22.4 22.6 C15.6 19.6 13 11.4 17.2 6.4 C17.6 12 20.6 16.8 26 20.2 Z',
      'M41.6 22.6 C48.4 19.6 51 11.4 46.8 6.4 C46.4 12 43.4 16.8 38 20.2 Z'
    ],
    armor:
      'M25 40.4 C28.2 38.6 35.8 38.6 39 40.4 L37.4 49.2 C34.4 51.2 29.6 51.2 26.6 49.2 Z',
    glowPath: 'M32 41.6 L29.6 46.4 L32 45.6 L30.4 50.6',
    tail: 'M46.6 46 C55 45.6 58 37.8 54.4 31',
    tailWidth: 3.4,
    tailStyle: 'segmented',
    eyeY: 32.8,
    eyeSpread: 6.6,
    noseY: 36.8,
    mouthY: 38.9,
    blushY: 37.8,
    blushX: 11.4,
    whiskerY: 38,
    paws: [
      [27, 51.4],
      [37, 51.4]
    ],
    legs: [23, 41],
    legY: 53.4,
    wavePaw: [46.6, 35.4],
    eyeStyle: 'glow',
    bellyOpacity: 0.4,
    whiskerLight: true,
    belly: 'M27.6 48.6 C29.4 50.6 34.6 50.6 36.4 48.6 C33.8 49.6 30.2 49.6 27.6 48.6 Z'
  }
}

/** 眼睛：open / wide / blink / happy / sleep / dizzy；坐标由体型的 eyeY / eyeSpread 决定 */
function eyesSvg(style, y, spread, P) {
  const lx = 32 - spread
  const rx = 32 + spread
  // 机甲体型：竖瞳 + 外发光，在深色外壳上才立得住
  if (P.eyeStyle === 'glow' && style === 'open') {
    const one = (cx) => `
      <circle cx="${cx}" cy="${y}" r="4" fill="${P.glow}" opacity="0.16"/>
      <ellipse cx="${cx}" cy="${y}" rx="2.8" ry="3.5" fill="#070c14"/>
      <ellipse cx="${cx}" cy="${y}" rx="1.05" ry="2.6" fill="${P.glow}"/>
      <ellipse cx="${cx}" cy="${y - 0.4}" rx="0.42" ry="1.5" fill="#fff6e8"/>`
    return one(lx) + one(rx)
  }
  switch (style) {
    case 'blink':
      return `<path d="M${lx - 3} ${y + 0.1} Q${lx} ${y + 1.9} ${lx + 3} ${y + 0.1}" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>
              <path d="M${rx - 3} ${y + 0.1} Q${rx} ${y + 1.9} ${rx + 3} ${y + 0.1}" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>`
    case 'happy':
      return `<path d="M${lx - 3.2} ${y + 0.9} Q${lx} ${y - 2.7} ${lx + 3.2} ${y + 0.9}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
              <path d="M${rx - 3.2} ${y + 0.9} Q${rx} ${y - 2.7} ${rx + 3.2} ${y + 0.9}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'sleep':
      return `<path d="M${lx - 3} ${y + 0.3} Q${lx} ${y + 2.5} ${lx + 3} ${y + 0.3}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
              <path d="M${rx - 3} ${y + 0.3} Q${rx} ${y + 2.5} ${rx + 3} ${y + 0.3}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'dizzy':
      return `<path d="M${lx - 2.6} ${y - 1.1} a3 3 0 1 0 5 2.6" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
              <path d="M${rx - 2.6} ${y - 1.1} a3 3 0 1 0 5 2.6" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`
    case 'wide':
      return `<ellipse cx="${lx}" cy="${y}" rx="3" ry="3.8" fill="${INK}"/>
              <ellipse cx="${rx}" cy="${y}" rx="3" ry="3.8" fill="${INK}"/>
              <circle cx="${lx + 1.1}" cy="${y - 1.4}" r="1.3" fill="#ffffff"/>
              <circle cx="${rx + 1.1}" cy="${y - 1.4}" r="1.3" fill="#ffffff"/>`
    default:
      return `<ellipse cx="${lx}" cy="${y}" rx="2.6" ry="3.2" fill="${INK}"/>
              <ellipse cx="${rx}" cy="${y}" rx="2.6" ry="3.2" fill="${INK}"/>
              <circle cx="${lx + 0.9}" cy="${y - 1.1}" r="0.9" fill="#ffffff"/>
              <circle cx="${rx + 0.9}" cy="${y - 1.1}" r="0.9" fill="#ffffff"/>`
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
      <path d="M27.5 19.5 Q32 22.8 36.5 19.5"/>
      <path d="M25.5 24.5 Q32 28.2 38.5 24.5"/>
      <path d="M16.2 32 Q19.5 34.2 21 33"/>
      <path d="M47.8 32 Q44.5 34.2 43 33"/>
    </g>`
  }
  if (kind === 'tuxedo') {
    return `<ellipse cx="32" cy="41" rx="9.4" ry="12.6" fill="${P.belly}" opacity="0.95"/>
            <ellipse cx="32" cy="38.6" rx="5.4" ry="3.6" fill="${P.belly}"/>`
  }
  if (kind === 'patches') {
    return `<path d="M19 24 C23 20 29 20 30 25 C31 30 24 32 20 30 Z" fill="#ffb066" opacity="0.92"/>
            <path d="M40 22 C45 23 48 28 45 31 C42 34 37 30 38 26 Z" fill="#5b6d89" opacity="0.88"/>
            <path d="M36 44 C41 43 45 47 43 51 C40 54 34 51 35 47 Z" fill="#ffb066" opacity="0.78"/>
            <path d="M17 40 C21 39 24 43 22 47 C19 50 15 46 16 43 Z" fill="#5b6d89" opacity="0.6"/>`
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

/** 渐变与裁剪定义：每个角色一套明暗，画体积全靠这里 */
function defsSvg(P, B) {
  return `<defs>
    <radialGradient id="bodyG" cx="0.34" cy="0.24" r="0.95">
      <stop offset="0" stop-color="${P.light}"/>
      <stop offset="0.34" stop-color="${P.body}"/>
      <stop offset="0.72" stop-color="${P.body}"/>
      <stop offset="1" stop-color="${P.dark}"/>
    </radialGradient>
    <linearGradient id="earG" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="${P.light}"/>
      <stop offset="0.55" stop-color="${P.body}"/>
      <stop offset="1" stop-color="${P.dark}"/>
    </linearGradient>
    <linearGradient id="shadeG" x1="0" y1="0.34" x2="0" y2="1">
      <stop offset="0" stop-color="${P.shadow}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${P.shadow}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${P.shadow}" stop-opacity="0.52"/>
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
      <circle cx="54.2" cy="31.4" r="2.2" fill="${P.glow}" opacity="0.22"/>
      <circle cx="54.2" cy="31.4" r="1.15" fill="${P.glow}"/>
      <circle cx="54.2" cy="31.4" r="0.5" fill="#fff6e8"/>
    </g>`
  }
  return `${t}
    <path d="${B.tail}" stroke="${P.outline}" stroke-width="${B.tailWidth + 1.2}" fill="none" stroke-linecap="round"/>
    <path d="${B.tail}" stroke="url(#tailG)" stroke-width="${B.tailWidth}" fill="none" stroke-linecap="round"/>
  </g>`
}

/** 躯干：渐变填充 + 裁剪内的遮蔽/高光/反光 + 轮廓与边缘光 */
function torsoSvg(B, P) {
  return `
    <path d="${B.body}" fill="url(#bodyG)" stroke="${P.outline}" stroke-width="1.7" stroke-linejoin="round"/>
    <g clip-path="url(#bodyClip)">
      <rect x="0" y="0" width="64" height="64" fill="url(#shadeG)"/>
      <!-- 左上受光：三层同心椭圆叠出柔和高光，避免依赖 SVG 滤镜 -->
      <ellipse cx="25.5" cy="24" rx="9" ry="7" fill="#ffffff" opacity="0.10"/>
      <ellipse cx="25.2" cy="23.6" rx="6" ry="4.6" fill="#ffffff" opacity="0.13"/>
      <ellipse cx="24.8" cy="23.2" rx="3.2" ry="2.4" fill="#ffffff" opacity="0.20"/>
      <!-- 右下背光加强 -->
      <ellipse cx="49" cy="45" rx="9" ry="14" fill="${P.shadow}" opacity="0.20"/>
      <!-- 底部反光：把身体从地面“托”起来 -->
      <ellipse cx="32" cy="53.5" rx="13" ry="4.6" fill="${P.light}" opacity="0.20"/>
    </g>
    <path d="${B.body}" fill="none" stroke="${P.light}" stroke-width="0.9" opacity="0.35"
          transform="translate(-0.55 -0.7)"/>`
}

/** 单帧角色：所有姿态都是同一套部件做变换，体型来自 BREED */
function catSvg(o, P, B) {
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

  // 落地投影：跳得越高越小越淡
  const shadowScale = Math.max(0.52, 1 + dy * 0.045)
  const shadowAlpha = Math.max(0.25, 1 + dy * 0.06)

  // 龙角：画在耳朵之前（角在耳后），金色渐变 + 深色描边
  const hornsEl = B.horns
    ? B.horns
        .map(
          (d) =>
            `<path d="${d}" fill="url(#hornG)" stroke="${P.outline}" stroke-width="1.2" stroke-linejoin="round"/>`
        )
        .join('')
    : ''

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

  const earsEl = (earBack ? B.earBack : B.earUp)
    .map(
      (d, i) =>
        `<path d="${d}" fill="url(#earG)" stroke="${P.outline}" stroke-width="1.5" stroke-linejoin="round"/>` +
        (!earBack && B.earInner
          ? `<path d="${B.earInner[i]}" fill="${P.blush}" opacity="0.72"/>`
          : '')
    )
    .join('')

  // 四爪：爬行时露出，两两交替
  const legsEl =
    legs >= 0
      ? `<g fill="${P.belly}" stroke="${P.outline}" stroke-width="1.1">
           <ellipse cx="${legs ? B.legs[0] - 2 : B.legs[0]}" cy="${B.legY}" rx="4.2" ry="2.6"/>
           <ellipse cx="${legs ? B.legs[1] + 2 : B.legs[1]}" cy="${B.legY}" rx="4.2" ry="2.6"/>
         </g>`
      : ''

  // 前爪：普通垂放 / 抬起挥动
  const pawEl =
    paw === 'up'
      ? `<g transform="rotate(-18 ${B.wavePaw[0]} ${B.wavePaw[1] + 4})">
           <ellipse cx="${B.wavePaw[0]}" cy="${B.wavePaw[1]}" rx="4.4" ry="5"
                    fill="${P.belly}" stroke="${P.outline}" stroke-width="1.3"/>
           <path d="M${B.wavePaw[0] - 1.9} ${B.wavePaw[1] - 3.4} l0.6 2
                    M${B.wavePaw[0] + 0.3} ${B.wavePaw[1] - 3.8} l0.6 2
                    M${B.wavePaw[0] + 2.5} ${B.wavePaw[1] - 3.4} l0.6 2"
                 stroke="${P.outline}" stroke-width="0.9" stroke-linecap="round"/>
         </g>`
      : `<g fill="${P.belly}" stroke="${P.outline}" stroke-width="1.1">
           <ellipse cx="${B.paws[0][0]}" cy="${B.paws[0][1]}" rx="4" ry="2.5"/>
           <ellipse cx="${B.paws[1][0]}" cy="${B.paws[1][1]}" rx="4" ry="2.5"/>
         </g>`

  const cheekEl = B.cheekTuft
    ? `<path d="M16.6 33.6 C14.2 33 12.6 34 13.4 35.8 C14.2 37.4 15.8 36.8 16.6 35.6 Z"
             fill="${P.body}" stroke="${P.outline}" stroke-width="1.1" stroke-linejoin="round"/>
       <path d="M47.4 33.6 C49.8 33 51.4 34 50.6 35.8 C49.8 37.4 48.2 36.8 47.4 35.6 Z"
             fill="${P.body}" stroke="${P.outline}" stroke-width="1.1" stroke-linejoin="round"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 64 64">
  ${defsSvg(P, B)}
  <ellipse cx="32" cy="58.6" rx="${16.5 * shadowScale}" ry="${3.6 * shadowScale}"
           fill="url(#shadowG)" opacity="${shadowAlpha}"/>
  <g transform="translate(32 ${34 + dy}) rotate(${rotate}) scale(${sxw} ${sy}) translate(-32 -34)">
    ${tailSvg(B, P, tail)}
    ${hornsEl}
    ${earsEl}
    ${torsoSvg(B, P)}
    <g clip-path="url(#bodyClip)">
      ${patternSvg(P.pattern, P)}
      <path d="${B.belly}" fill="${P.belly}" opacity="${B.bellyOpacity ?? 0.85}"/>
      ${armorEl}
      ${glowEl}
    </g>
    ${legsEl}
    ${pawEl}
    ${cheekEl}
    ${eyesSvg(eyes, B.eyeY, B.eyeSpread, P)}
    <path d="M${32 - 1.4} ${B.noseY} L${32 + 1.4} ${B.noseY} L32 ${B.noseY + 1.6} Z" fill="${P.blush}"/>
    <path d="M${32 - 1.6} ${B.mouthY} Q32 ${B.mouthY + 1.4} ${32 + 1.6} ${B.mouthY}"
          stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="${32 - B.blushX}" cy="${B.blushY}" rx="3" ry="1.8" fill="${P.blush}" opacity="0.45"/>
    <ellipse cx="${32 + B.blushX}" cy="${B.blushY}" rx="3" ry="1.8" fill="${P.blush}" opacity="0.45"/>
    <g stroke="${B.whiskerLight ? P.light : P.outline}" stroke-width="1.1"
       opacity="${B.whiskerLight ? 0.5 : 0.72}" stroke-linecap="round">
      <path d="M${32 - 13.4} ${B.whiskerY} L${32 - 20.2} ${B.whiskerY - 1.4}"/>
      <path d="M${32 - 13.2} ${B.whiskerY + 2.4} L${32 - 20} ${B.whiskerY + 3.8}"/>
      <path d="M${32 + 13.4} ${B.whiskerY} L${32 + 20.2} ${B.whiskerY - 1.4}"/>
      <path d="M${32 + 13.2} ${B.whiskerY + 2.4} L${32 + 20} ${B.whiskerY + 3.8}"/>
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
    breed: 'chubby',
    scale: 1.2,
    description: '圆胖的蓝猫，会呼吸眨眼，点一下翻跟头'
  },
  {
    id: 'orange-tabby',
    dir: 'plugins/orange-tabby',
    name: '小橘',
    palette: 'orange',
    breed: 'tabby',
    scale: 1.2,
    description: '瘦高的橘虎斑，大耳朵长尾巴，爱蠕动着讨摸'
  },
  {
    id: 'tuxedo-cat',
    dir: 'plugins/tuxedo-cat',
    name: '小煤',
    palette: 'tuxedo',
    breed: 'tuxedo',
    scale: 1.2,
    description: '肩宽方脸的燕尾服猫，尾巴细长，转圈圈最拿手'
  },
  {
    id: 'calico-cat',
    dir: 'plugins/calico-cat',
    name: '三花',
    palette: 'calico',
    breed: 'calico',
    scale: 1.2,
    description: '蓬松长毛的三花，折耳朵大尾巴，慢吞吞地爬'
  },
  {
    id: 'mecha-dragon',
    dir: 'plugins/mecha-dragon',
    name: '焰甲',
    palette: 'mecha',
    breed: 'mecha',
    scale: 1.2,
    description: '机甲龙猫，龙角胸甲与熔岩能量纹，看着凶其实很黏人'
  }
]

/** 所有角色共用同一套动作表，体型与配色各自不同 */
function manifestOf(ch) {
  return {
    id: ch.id,
    name: ch.name,
    version: '1.2.0',
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
        input: Buffer.from(catSvg(frame, P, B)),
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
const iconInner = catSvg({}, PALETTES.blue, BREEDS.chubby)
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a1b33"/><stop offset="1" stop-color="#06101f"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <g transform="translate(512 552) scale(9.2) translate(-32 -34)">
    ${iconInner}
  </g>
</svg>`

await writeFile('assets/app-icon.png', await sharp(Buffer.from(iconSvg)).png().toBuffer())
console.log('app icon -> assets/app-icon.png (1024x1024)')

// 文档配图：四角色 × 9 个代表动作
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
