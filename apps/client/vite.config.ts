import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function productionCspPlugin(): Plugin {
  return {
    name: 'production-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const cspTag =
        '    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\' ws: wss: http: https:; font-src \'self\'; object-src \'none\'; base-uri \'self\';" />';
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n${cspTag}`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    productionCspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Kanban Local-First Colaborativo',
        short_name: 'Kanban',
        description: 'Gestor de proyectos colaborativo en tiempo real y offline-first',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
             src: 'pwa-192x192.png',
             sizes: '192x192',
             type: 'image/png'
          },
          {
             src: 'pwa-512x512.png',
             sizes: '512x512',
             type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ]
});
