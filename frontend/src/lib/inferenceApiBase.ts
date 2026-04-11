/**
 * Единая база HTTP для inference (FastAPI).
 * README: `uvicorn app.main:app --port 8787` → http://127.0.0.1:8787
 * start-aivision.ps1 поднимает **api.main** на :8000 (3D) — для него `VITE_SEGMENTATION_API_URL`, не pathology.
 */
export const DEFAULT_INFERENCE_API_BASE = 'http://127.0.0.1:8787'

/** Префикс прокси в `vite.config.ts` (`vite` и `vite preview`). */
export const INFERENCE_DEV_PROXY_PATH = '/__aivision_inference'

/**
 * Прокси Vite: запрос на тот же origin, что и страница → Node проксирует на 127.0.0.1:8787.
 * Раньше включали только для «локальных» hostname/портов — любой другой адрес (имя ПК, пустой порт)
 * давал прямой fetch на :8787 и «API недоступен» на Windows.
 * Для деплоя без Vite задайте VITE_PATHOLOGY_API_URL при сборке — тогда прокси не используется.
 */
export function getLocalInferenceProxyBase(): string | null {
  if (getExplicitPathologyApiBaseFromEnv() != null) return null
  if (typeof window === 'undefined' || !window.location?.origin) return null
  const { protocol } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return null
  return `${window.location.origin}${INFERENCE_DEV_PROXY_PATH}`
}

/** Альтернатива из start-aivision.ps1 (uvicorn api.main:app --port 8000). */
export const LEGACY_INFERENCE_API_BASE = 'http://127.0.0.1:8000'

function isLoopbackPort8000(base: string): boolean {
  try {
    const u = new URL(base)
    const host = u.hostname.toLowerCase()
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return (
      port === '8000' &&
      (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1')
    )
  } catch {
    return false
  }
}

/**
 * Явный базовый URL из `VITE_PATHOLOGY_API_URL` для **app.main** (CT `/v1/ct-screen`, порт 8787).
 * В dev значение на loopback **:8000** игнорируется: порт 8000 — это другой сервис (`api.main`, 3D),
 * а `npm run dev:full` поднимает inference только на **8787**. Иначе в `.env` остаётся старый URL и API «не подключается».
 */
export function getExplicitPathologyApiBaseFromEnv(): string | null {
  const raw = import.meta.env.VITE_PATHOLOGY_API_URL
  if (typeof raw !== 'string' || !raw.trim()) return null
  const t = raw.trim().replace(/\/$/, '')
  if (import.meta.env.DEV && isLoopbackPort8000(t)) return null
  return t
}

/** GLB /v1/visualize — отдельный entrypoint `api.main` (порт 8000 в start-aivision.ps1). */
export const DEFAULT_SEGMENTATION_API_BASE = LEGACY_INFERENCE_API_BASE

export function getSegmentationApiBase(): string {
  const raw = import.meta.env.VITE_SEGMENTATION_API_URL
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim().replace(/\/$/, '')
  }
  return DEFAULT_SEGMENTATION_API_BASE
}

/** Host из location.hostname: IPv6 без скобок (::1) → []. */
function hostForHttpUrl(hostname: string): string {
  if (hostname.startsWith('[')) return hostname
  if (hostname.includes(':')) return `[${hostname}]`
  return hostname
}

function originForInference(hostname: string, port: number): string {
  return `http://${hostForHttpUrl(hostname)}:${port}`
}

/**
 * Страница открыта по частному IPv4 (например Vite --host и http://192.168…:5173).
 * Тогда тот же IP:8787 часто режется файрволом Windows; API на этой же машине доступен с 127.0.0.1.
 */
function isPrivateLanHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false
  if (hostname.startsWith('[')) return false
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * Базовый URL для fetch к inference.
 * Без .env — тот же hostname, что у страницы (localhost vs 127.0.0.1), порт 8787.
 */
export function getInferenceApiBase(): string {
  const explicit = getExplicitPathologyApiBaseFromEnv()
  if (explicit != null) return explicit
  const localProxy = getLocalInferenceProxyBase()
  if (localProxy) return localProxy
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location
    if (protocol === 'http:' || protocol === 'https:') {
      if (isPrivateLanHostname(hostname)) {
        return DEFAULT_INFERENCE_API_BASE
      }
      return originForInference(hostname, 8787)
    }
  }
  return DEFAULT_INFERENCE_API_BASE
}

/** URL для GET /health при старте (несколько вариантов из‑за localhost ↔ 127.0.0.1 / IPv6). */
export function getInferenceHealthCheckCandidates(): string[] {
  const explicit = getExplicitPathologyApiBaseFromEnv()
  if (explicit != null) {
    const b = explicit
    return b === LEGACY_INFERENCE_API_BASE ? [b] : [b, LEGACY_INFERENCE_API_BASE]
  }
  const out: string[] = []
  const add = (u: string) => {
    if (!out.includes(u)) out.push(u)
  }
  const localProxy = getLocalInferenceProxyBase()
  if (localProxy) add(localProxy)
  /**
   * Сначала loopback: при открытии Vite по LAN (192.168…:5173) запрос на тот же IP:8787 на Windows
   * часто «висит» до таймаута (файрвол), хотя API слушает 0.0.0.0 и доступен с 127.0.0.1.
   */
  add('http://127.0.0.1:8787')
  add('http://localhost:8787')
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location
    if (protocol === 'http:' || protocol === 'https:') {
      add(originForInference(hostname, 8787))
      if (hostname === 'localhost') {
        add('http://127.0.0.1:8787')
      } else if (hostname === '127.0.0.1') {
        add('http://localhost:8787')
      }
    }
  }
  add(LEGACY_INFERENCE_API_BASE)
  return out
}
