import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

function glslAsText() {
  return {
    name: 'glsl-as-text',
    transform(code: string, id: string) {
      if (!id.endsWith('.glsl')) return null
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), glslAsText()],
  resolve: {
    alias: {
      globalthis: path.resolve(__dirname, 'src/shims/globalthis.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['vtk.js', 'globalthis'],
  },
})
