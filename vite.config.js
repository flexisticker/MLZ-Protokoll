import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'MLZ-Protokoll',
        short_name: 'Protokoll',
        description: 'Logbuch, Arbeitszeit und Nachweise',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f6f9',
        theme_color: '#1d3557',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8090' } },
  build: { chunkSizeWarningLimit: 900 },
});
