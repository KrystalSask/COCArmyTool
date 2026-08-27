import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
