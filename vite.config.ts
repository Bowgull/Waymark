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
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(Date.now()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
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
