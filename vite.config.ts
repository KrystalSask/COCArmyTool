import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // 手机经局域网 IP 访问开发服务器时用 `DEV_HTTPS=1 npm run dev -- --host`
    // 开启自签名 HTTPS（crypto.subtle、剪贴板等 API 只在安全上下文可用）。
    // 默认保持 HTTP，Playwright e2e 的 webServer 探测不受影响。
    ...(process.env.DEV_HTTPS ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['army-icon.svg', 'game-icons/**/*.png'],
      workbox: {
        globIgnores: ['**/models/**', '**/*.wasm'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/models/') || url.pathname.endsWith('.wasm'),
          handler: 'CacheFirst',
          options: { cacheName: 'recognition-models-v1', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 } },
        }],
      },
      manifest: {
        name: 'COCArmyTool - COC 配兵助手',
        short_name: 'COCArmyTool',
        description: '部落冲突国服配兵链接管理与计算器',
        theme_color: '#5a3f30',
        background_color: '#2d211b',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/army-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
