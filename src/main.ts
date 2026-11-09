import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Pet } from './pet'
import type { AppConfig, PluginInfo } from './types'

const canvasEl = document.querySelector<HTMLCanvasElement>('#pet')
const hintEl = document.querySelector<HTMLDivElement>('#hint')
if (!canvasEl || !hintEl) throw new Error('页面结构缺失：找不到 #pet / #hint')

const canvas: HTMLCanvasElement = canvasEl
const hint: HTMLDivElement = hintEl

/** 是否跑在 Tauri 宿主里；否则是浏览器预览模式（只渲染内置角色，无窗口能力） */
const isTauri = '__TAURI_INTERNALS__' in window

let pet: Pet | null = null
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
  pet?.destroy()
  pet = new Pet(canvas, plugin.manifest)
  await pet.load(await spriteOf(plugin))
  await resizeWindow(pet.width, pet.height)

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

  // 左键拖动窗口；单击互动；右键换下一个角色
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && isTauri) void getCurrentWindow().startDragging()
  })
  canvas.addEventListener('click', () => {
    pet?.playRandom(['happy', 'wave', 'jump'])
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

  if (!isTauri) return

  // 位置记忆：拖动结束后落盘，避免拖动过程中频繁写文件
  let saveTimer: number | undefined
  await getCurrentWindow().onMoved(({ payload }) => {
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
