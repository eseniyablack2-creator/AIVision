import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), glslAsText()],
  resolve: {
    alias: [
      { find: 'globalthis', replacement: path.resolve(__dirname, 'src/shims/globalthis.ts') },
      {
        find: 'fast-deep-equal/index.js',
        replacement: path.resolve(__dirname, 'src/shims/fast-deep-equal.ts'),
      },
      {
        find: 'fast-deep-equal',
        replacement: path.resolve(__dirname, 'src/shims/fast-deep-equal.ts'),
      },
      {
        find: 'seedrandom/index.js',
        replacement: path.resolve(__dirname, 'src/shims/seedrandom.ts'),
      },
      {
        find: 'seedrandom',
        replacement: path.resolve(__dirname, 'src/shims/seedrandom.ts'),
      },
      {
        find: 'spark-md5/spark-md5.js',
        replacement: path.resolve(__dirname, 'src/shims/spark-md5.ts'),
      },
      {
        find: 'spark-md5',
        replacement: path.resolve(__dirname, 'src/shims/spark-md5.ts'),
      },
    ],
  },
  optimizeDeps: {
    exclude: ['vtk.js'],
  },
  worker: {
    format: 'es',
  },
})
