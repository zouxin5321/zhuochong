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
