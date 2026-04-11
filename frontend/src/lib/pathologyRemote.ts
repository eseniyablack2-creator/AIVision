/**
 * Точка подключения серверного инференса вместо чистых эвристик.
 *
 * Задайте в `frontend/.env`: VITE_PATHOLOGY_API_URL=http://127.0.0.1:8787
 * Без .env используется {@link getInferenceApiBase} (порт 8787, см. inference/README.md).
 */
import { getExplicitPathologyApiBaseFromEnv, getInferenceApiBase } from './inferenceApiBase'

export function isPathologyRemoteApiConfigured(): boolean {
  return getExplicitPathologyApiBaseFromEnv() != null
}

/** База для POST /v1/ct-screen и т.п.; без .env — localhost:8787. */
export function getPathologyRemoteApiBase(): string {
  return getInferenceApiBase()
}
