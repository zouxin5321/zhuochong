import type { BehaviorConfig } from './types'
import type { Pet } from './pet'

/** 与 manifest 缺省值对齐的默认行为配置（老插件没有 behavior 块也能用） */
const DEFAULTS: Required<BehaviorConfig> = {
  click: ['happy', 'jump', 'wave', 'roll'],
  ambient: ['wiggle', 'crawl', 'spin'],
  doubleClick: 'spin',
  combo: { count: 4, windowMs: 1600, action: 'dizzy' },
  sleep: { afterMs: 120000, action: 'sleep' },
  drag: 'drag',
  wake: 'jump'
}

/**
 * 行为调度：把「用户事件 + 时间流逝」翻译成动作。
 * 规则（全部可被 manifest.behavior 覆盖）：
 *  - 单击：从 click 池随机（不连续重复）
 *  - 双击（<320ms 两次）：doubleClick 动作
 *  - 连点 combo.count 次（windowMs 内）：combo.action（如头晕）
 *  - 发呆 9s 且不在动作中：从 ambient 池随机来一段
 *  - 无交互 sleep.afterMs：睡觉，任意交互唤醒并播 wake
 *  - 拖拽（拎起来）：循环 drag 动作，松手播 wake
 */
export class Behavior {
  private cfg: Required<BehaviorConfig>
  private timer: number | undefined
  private clicks: number[] = []
  private lastInteract = Date.now()
  private dragging = false
  private sleeping = false

  constructor(
    private readonly pet: Pet,
    behavior?: BehaviorConfig,
    private readonly hooks: { onSleep?: () => void; onWake?: () => void } = {}
  ) {
    this.cfg = {
      click: behavior?.click?.length ? behavior.click : DEFAULTS.click,
      ambient: behavior?.ambient?.length ? behavior.ambient : DEFAULTS.ambient,
      doubleClick: behavior?.doubleClick ?? DEFAULTS.doubleClick,
      combo: behavior?.combo ?? DEFAULTS.combo,
      sleep: behavior?.sleep ?? DEFAULTS.sleep,
      drag: behavior?.drag ?? DEFAULTS.drag,
      wake: behavior?.wake ?? DEFAULTS.wake
    }
  }

  start(): void {
    this.stop()
    this.timer = window.setInterval(() => this.tick(), 2000)
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
  }

  get isSleeping(): boolean {
    return this.sleeping
  }

  /** 距上次交互的毫秒数（测试用：可手动推进） */
  get idleMs(): number {
    return Date.now() - this.lastInteract
  }

  onClick(): void {
    this.lastInteract = Date.now()
    if (this.dragging) return

    if (this.sleeping) {
      this.sleeping = false
      this.pet.play(this.pick(this.cfg.wake))
      this.hooks.onWake?.()
      return
    }

    const now = Date.now()
    this.clicks = this.clicks.filter((t) => now - t < this.cfg.combo.windowMs)
    this.clicks.push(now)

    const combo = this.cfg.combo
    if (combo && this.clicks.length >= combo.count && this.pet.hasAction(combo.action)) {
      this.clicks = []
      this.pet.play(combo.action)
      return
    }
    if (
      this.clicks.length >= 2 &&
      now - this.clicks[this.clicks.length - 2] < 320 &&
      this.pet.hasAction(this.cfg.doubleClick)
    ) {
      this.pet.play(this.cfg.doubleClick)
      return
    }
    this.pet.playRandom(this.cfg.click)
  }

  onDragStart(): void {
    this.lastInteract = Date.now()
    this.dragging = true
    this.sleeping = false
    if (this.pet.hasAction(this.cfg.drag)) this.pet.play(this.cfg.drag)
  }

  onDragEnd(): void {
    if (!this.dragging) return
    this.dragging = false
    this.lastInteract = Date.now()
    this.pet.play(this.pick(this.cfg.wake))
  }

  /** 强制进入睡眠（测试入口）；返回是否真的睡了 */
  forceSleep(): boolean {
    const action = this.cfg.sleep.action
    if (!this.pet.hasAction(action)) return false
    this.sleeping = true
    this.pet.play(action)
    this.hooks.onSleep?.()
    return true
  }

  /** 测试入口：立刻模拟「发呆来一段」 */
  forceAmbient(): boolean {
    if (!this.cfg.ambient.some((n) => this.pet.hasAction(n))) return false
    this.pet.playRandom(this.cfg.ambient)
    return true
  }

  private pick(name: string): string {
    return this.pet.hasAction(name) ? name : this.pet.currentAction
  }

  private tick(): void {
    const idle = this.idleMs
    if (this.dragging) return

    if (!this.sleeping && idle >= this.cfg.sleep.afterMs && this.pet.hasAction(this.cfg.sleep.action)) {
      this.sleeping = true
      this.pet.play(this.cfg.sleep.action)
      this.hooks.onSleep?.()
      return
    }

    // 发呆自言自语：安静 9 秒以上、不在任何动作里，一半概率来一段
    if (!this.sleeping && idle > 9000 && !this.pet.isBusy && Math.random() < 0.5) {
      this.pet.playRandom(this.cfg.ambient)
    }
  }
}
