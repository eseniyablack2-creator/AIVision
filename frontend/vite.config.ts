import http from 'node:http'
import path from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Проверка GET /health к 127.0.0.1:8787 из процесса Node (Vite), а не из браузера.
 * Так видно реальную причину: inference не запущен vs браузер/прокси.
 */
function mountBackendHealthProbe(middlewares: Connect.Server) {
  middlewares.use((req, res, next) => {
    const url = req.url ?? ''
    if (req.method !== 'GET' || !url.startsWith('/__aivision_health_probe')) {
      next()
      return
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: 8787,
        path: '/health',
        method: 'GET',
        timeout: 5000,
      },
      (r) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          res.statusCode = r.statusCode ?? 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(body.length > 0 ? body : JSON.stringify({ status: 'error', service: 'aivision-health-probe', error: 'empty' }))
        })
      },
    )
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          status: 'error',
          service: 'aivision-health-probe',
          error: err.message || String(err),
          code: err.code ?? null,
        }),
      )
    })
    upstream.on('timeout', () => {
      upstream.destroy()
      if (!res.headersSent) {
        res.statusCode = 504
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status: 'error', service: 'aivision-health-probe', error: 'timeout' }))
      }
    })
    upstream.end()
  })
}

function aivisionBackendHealthProbePlugin(): Plugin {
  return {
    name: 'aivision-backend-health-probe',
    /** Раньше остальных плагинов — иначе SPA может отдать index.html вместо JSON. */
    enforce: 'pre',
    configureServer(server) {
      mountBackendHealthProbe(server.middlewares)
    },
    configurePreviewServer(server) {
      mountBackendHealthProbe(server.middlewares)
    },
  }
}

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

/** `vite` и `vite preview`: один origin с UI → браузер не ходит на :8787 напрямую. */
const inferenceProxy = {
  '/__aivision_inference': {
    target: 'http://127.0.0.1:8787',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/__aivision_inference/, ''),
  },
} as const

export default defineConfig({
  plugins: [aivisionBackendHealthProbePlugin(), react(), glslAsText()],
  server: {
    /** Иначе на Windows Vite часто слушает только [::1]:5173 —127.0.0.1:5173 и прокси API не открываются. */
    host: true,
    /** По умолчанию 5173 часто занят другим процессом; 5174 — стабильнее для AIVision (если занят, Vite возьмёт следующий). */
    port: 5174,
    strictPort: false,
    proxy: { ...inferenceProxy },
  },
  preview: {
    host: true,
    proxy: { ...inferenceProxy },
  },
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
