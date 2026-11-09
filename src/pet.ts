import type { ActionSpec, Manifest } from './types'

/**
 * 精灵渲染器：按 manifest 的帧表把 spritesheet 逐帧画到 canvas。
 * 动作状态机放在这里，宿主只负责触发 play('happy') 之类的语义动作。
 */
export class Pet {
  private readonly ctx: CanvasRenderingContext2D
  private readonly img = new Image()
  private readonly dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))

  private action = ''
  private current: ActionSpec | null = null
  private actionStart = 0
  private raf = 0

  width = 0
  height = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: Manifest
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前环境不支持 canvas 2d')
    this.ctx = ctx
  }

  /** 加载精灵图并启动渲染循环；dataUrl 由宿主进程读取插件文件后传入 */
  async load(dataUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.img.onload = () => resolve()
      this.img.onerror = () => reject(new Error('精灵图解码失败，检查 sprite.file 是否为有效 PNG'))
      this.img.src = dataUrl
    })

    const { cellWidth, cellHeight } = this.manifest.sprite
    const scale = this.manifest.scale ?? 1
    this.width = Math.round(cellWidth * scale)
    this.height = Math.round(cellHeight * scale)

    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`

    this.play(this.pickDefaultAction())
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.draw(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
  }

  get currentAction(): string {
    return this.action
  }

  hasAction(name: string): boolean {
    return !!this.manifest.actions[name]
  }

  /** 切换动作；不存在的动作静默忽略，避免插件少定义动作就崩掉 */
  play(name: string): void {
    const next = this.manifest.actions[name]
    if (!next) return
    this.action = name
    this.current = next
    this.actionStart = performance.now()
  }

  /** 随机挑一个可用的互动动作，没有就用默认动作 */
  playRandom(among: string[]): void {
    const pool = among.filter((n) => this.hasAction(n))
    if (!pool.length) return
    this.play(pool[Math.floor(Math.random() * pool.length)])
  }

  private pickDefaultAction(): string {
    const wanted = this.manifest.defaultAction
    if (wanted && this.manifest.actions[wanted]) return wanted
    return Object.keys(this.manifest.actions)[0] || 'idle'
  }

  private draw(now: number): void {
    const action = this.current
    if (!action) return

    const sprite = this.manifest.sprite
    const fps = action.fps && action.fps > 0 ? action.fps : 8
    const elapsed = (now - this.actionStart) / 1000
    let index = Math.floor(elapsed * fps)
    const loop = action.loop !== false

    if (loop) {
      index %= Math.max(1, action.frames)
    } else if (index >= action.frames) {
      // 单次动作播完：按 next → 默认动作 回落
      const next = action.next || this.pickDefaultAction()
      if (next !== this.action) {
        this.play(next)
        index = 0
      } else {
        index = action.frames - 1
        this.actionStart = now
      }
    }

    const col = index % Math.max(1, sprite.columns)
    const row = action.row
    const sx = col * sprite.cellWidth
    const sy = row * sprite.cellHeight

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.imageSmoothingEnabled = false
    this.ctx.drawImage(
      this.img,
      sx,
      sy,
      sprite.cellWidth,
      sprite.cellHeight,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    )
  }
}
