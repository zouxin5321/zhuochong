/** 插件与配置的数据结构（与 docs/PLUGIN_SPEC.md 一一对应） */

export interface SpriteSpec {
  file: string
  cellWidth: number
  cellHeight: number
  columns: number
  rows: number
}

export interface ActionSpec {
  row: number
  frames: number
  fps?: number
  loop?: boolean
  /** 非循环动作播完后自动切到的动作 */
  next?: string
}

export interface Manifest {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  license?: string
  /** 允许运行的最低宿主版本（semver，比较时只取主版本.次版本.修订） */
  minHost?: string
  /** 相对精灵原始像素的缩放倍数，默认 1 */
  scale?: number
  defaultAction?: string
  sprite: SpriteSpec
  actions: Record<string, ActionSpec>
  /** 行为池（可选；缺省时宿主用内置默认值，老插件无需修改） */
  behavior?: BehaviorConfig
}

/**
 * 行为配置：告诉宿主「哪些动作属于哪类事件」。
 * 宿主负责计时与判定（连点、发呆、睡眠），插件只声明动作名。
 */
export interface BehaviorConfig {
  /** 单击时随机播放的动作池 */
  click?: string[]
  /** 发呆时自言自语式播放的动作池 */
  ambient?: string[]
  /** 双击触发的动作（如转圈圈） */
  doubleClick?: string
  /** 连点 N 次触发的动作（如头晕） */
  combo?: { count: number; windowMs: number; action: string }
  /** 无交互多久后睡觉 */
  sleep?: { afterMs: number; action: string }
  /** 被拖拽（拎起来）时循环播放的动作 */
  drag?: string
  /** 从睡眠/拖拽恢复时播放的动作 */
  wake?: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /** 插件所在目录（内置插件在应用资源目录下） */
  dir: string
  manifest: Manifest
}

export interface AppConfig {
  activePlugin?: string
  x?: number
  y?: number
}
