/**
 * Точка подключения серверного инференса вместо чистых эвристик.
 *
 * Задайте в `.env`: VITE_PATHOLOGY_API_URL=https://your-inference-host
 * Реализация POST (объём, серия, маски) — на стороне бэкенда; клиент пока только сообщает, настроен ли URL.
 */
export function isPathologyRemoteApiConfigured(): boolean {
  const raw = import.meta.env.VITE_PATHOLOGY_API_URL
  return typeof raw === 'string' && raw.trim().length > 0
}

export function getPathologyRemoteApiBase(): string | null {
  if (!isPathologyRemoteApiConfigured()) return null
  return String(import.meta.env.VITE_PATHOLOGY_API_URL).trim().replace(/\/$/, '')
}
