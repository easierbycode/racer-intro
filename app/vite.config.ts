import { defineConfig } from 'vite'
import { fresh } from '@fresh/plugin-vite'

export default defineConfig({
  plugins: [fresh()],
  // The game's own vite dev server owns 5173 — keep the panel app off it.
  server: {
    port: 8000,
  },
})
