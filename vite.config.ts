import { defineConfig } from 'vite'

// 桌面应用固定端口：tauri.conf.json build.devUrl 与此保持一致
// publicDir 指向 plugins：浏览器打开 http://localhost:1420 可直接预览内置角色（无 Tauri 能力）
export default defineConfig({
  publicDir: 'plugins',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: 'chrome110',
    outDir: 'dist'
  }
})
