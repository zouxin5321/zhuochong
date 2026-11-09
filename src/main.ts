import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Pet } from './pet'
import { Behavior } from './behavior'
import type { AppConfig, PluginInfo } from './types'

const canvasEl = document.querySelector<HTMLCanvasElement>('#pet')
const hintEl = document.querySelector<HTMLDivElement>('#hint')
if (!canvasEl || !hintEl) throw new Error('页面结构缺失：找不到 #pet / #hint')

const canvas: HTMLCanvasElement = canvasEl
const hint: HTMLDivElement = hintEl

/** 是否跑在 Tauri 宿主里；否则是浏览器预览模式（只渲染内置角色，无窗口能力） */
const isTauri = '__TAURI_INTERNALS__' in window

let pet: Pet | null = null
let behavior: Behavior | null = null
let current: PluginInfo | null = null
let hideTimer: number | undefined

async function resizeWindow(width: number, height: number): Promise<void> {
  if (!isTauri) return
  await invoke('resize_pet', { width, height }).catch(() => undefined)
}

/** 提示条：窗口只有角色那么大，出错时临时放大窗口，否则文字看不见 */
async function say(text: string, ms = 2600): Promise<void> {
  if (text.length > 24) await resizeWindow(268, 132)
  hint.textContent = text
  hint.classList.remove('hidden')
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    hint.classList.add('hidden')
    if (pet) void resizeWindow(pet.width, pet.height)
  }, ms)
}

/** 插件清单：Tauri 下由宿主扫描；浏览器预览固定加载内置角色 */
async function listAllPlugins(): Promise<PluginInfo[]> {
  if (isTauri) return invoke<PluginInfo[]>('list_plugins')
  const manifest = await fetch('/builtin-default/manifest.json').then((r) => r.json())
  return [
    {
      id: manifest.id,
      name: `${manifest.name}（浏览器预览）`,
      version: manifest.version,
      dir: '',
      manifest
    }
  ]
}

async function spriteOf(plugin: PluginInfo): Promise<string> {
  if (isTauri) return invoke<string>('load_sprite', { pluginId: plugin.id })
  return `/builtin-default/${plugin.manifest.sprite.file}?t=${Date.now()}`
}

async function mount(plugin: PluginInfo): Promise<void> {
  behavior?.stop()
  pet?.destroy()

  pet = new Pet(canvas, plugin.manifest)
  await pet.load(await spriteOf(plugin))
  behavior = new Behavior(pet, plugin.manifest.behavior)
  behavior.start()
  await resizeWindow(pet.width, pet.height)

  current = plugin
  if (isTauri) {
    const cfg = await invoke<AppConfig>('get_config')
    await invoke('set_config', { config: { ...cfg, activePlugin: plugin.id } })
  }
}

async function boot(): Promise<void> {
  const plugins = await listAllPlugins()
  if (!plugins.length) {
    await say('没有找到角色插件：把插件文件夹放到插件目录后重启，托盘菜单可打开目录。')
    return
  }

  const cfg = isTauri ? await invoke<AppConfig>('get_config') : {}
  let index = plugins.findIndex((p) => p.id === cfg.activePlugin)
  if (index < 0) index = 0
  await mount(plugins[index])

  // ---------- 交互 ----------
  // 拖拽联动：按下后窗口真的移动了才算「被拎起来」（切 drag 动作），
  // 松手播 wake；单纯点击不触发。位移判断同时挡掉拖动结束系统补发的 click。
  let pointerDown = false
  let moved = false
  let dragOrigin: { x: number; y: number } | null = null
  let saveTimer: number | undefined

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isTauri) return
    pointerDown = true
    moved = false
    dragOrigin = null
    const win = getCurrentWindow()
    void win
      .outerPosition()
      .then((p) => {
        dragOrigin = { x: p.x, y: p.y }
      })
      .catch(() => undefined)
    void win.startDragging()
  })

  canvas.addEventListener('pointerup', () => {
    if (moved) behavior?.onDragEnd()
    pointerDown = false
  })

  canvas.addEventListener('click', () => {
    const origin = dragOrigin
    if (isTauri && origin) {
      void getCurrentWindow()
        .outerPosition()
        .then((p) => {
          const delta = Math.abs(p.x - origin.x) + Math.abs(p.y - origin.y)
          if (delta > 4) {
            moved = true
            behavior?.onDragEnd()
          } else {
            behavior?.onClick()
          }
        })
        .catch(() => behavior?.onClick())
      return
    }
    behavior?.onClick()
  })

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (plugins.length < 2) {
      void say(`当前只有「${plugins[0].name}」一个角色，插件目录里再加一个就能切换`)
      return
    }
    index = (index + 1) % plugins.length
    const next = plugins[index]
    void mount(next).then(() => say(`角色：${next.name}`))
  })

  // 测试/调试入口：domcheck 与控制台都能直接驱动行为（浏览器预览模式也注册）
  Object.defineProperty(window, '__zhuochong', {
    value: {
      get action() {
        return pet?.currentAction ?? ''
      },
      get pluginId() {
        return current?.id ?? ''
      },
      get pluginName() {
        return current?.name ?? ''
      },
      get sleeping() {
        return behavior?.isSleeping ?? false
      },
      actions: () => Object.keys(current?.manifest.actions ?? {}),
      get behavior() {
        return behavior
      },
      get pet() {
        return pet
      },
      forceSleep: () => behavior?.forceSleep() ?? false,
      forceAmbient: () => behavior?.forceAmbient() ?? false,
      wake: () => behavior?.onClick()
    },
    writable: false,
    configurable: true
  })

  if (!isTauri) return

  // 位置记忆 + 拖拽开始检测：拖动过程中窗口位置会持续变化
  let dragWatchdog: number | undefined
  await getCurrentWindow().onMoved(({ payload }) => {
    if (pointerDown && !moved) {
      moved = true
      behavior?.onDragStart()
    }
    if (moved && pointerDown) {
      // 兜底：OS 级拖动可能吞掉 pointerup，位置停止变化 450ms 即视为松手
      window.clearTimeout(dragWatchdog)
      dragWatchdog = window.setTimeout(() => {
        if (moved && pointerDown) {
          behavior?.onDragEnd()
          pointerDown = false
        }
      }, 450)
    }
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void invoke('save_position', { x: payload.x, y: payload.y })
    }, 400)
  })
}

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(err)
  void say(msg)
})
