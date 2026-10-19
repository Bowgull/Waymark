import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // The worker's CORS allows http://localhost:5173 only: never drift to 5174 when the
  // port is busy, fail instead (e2e env note 29: another port fails every API call).
  server: { port: 5173, strictPort: true },
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(Date.now()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // three.js only loads with the world engine (a dynamic import), never in the first paint.
          if (id.includes('/node_modules/three/')) return 'three'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react'
          }
          if (id.includes('/@capacitor/') || id.includes('/@aparajita/')) {
            return 'native'
          }
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory-vendor/')) {
            return 'charts'
          }
          if (id.includes('/lucide-react/')) {
            return 'icons'
          }
          if (id.includes('/driver.js/')) {
            return 'tour'
          }
          return 'vendor'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
