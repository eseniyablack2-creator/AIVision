import { useEffect, useState } from 'react'
import type { SimilarCaseHit, SimilarCasesFocusContext } from '../lib/similarCasesMock'
import { fetchSimilarCasesMock } from '../lib/similarCasesMock'

type Props = {
  open: boolean
  onClose: () => void
  seriesInstanceUid: string
  focus: SimilarCasesFocusContext | null
}

export function SimilarCasesModal({ open, onClose, seriesInstanceUid, focus }: Props) {
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<SimilarCaseHit[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!open || !seriesInstanceUid) return
    let cancelled = false
    setLoading(true)
    void fetchSimilarCasesMock(seriesInstanceUid, focus).then((list) => {
      if (!cancelled) {
        setHits(list)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    open,
    seriesInstanceUid,
    refreshKey,
    focus?.sliceIndex,
    focus?.col,
    focus?.row,
    focus?.hu,
    focus?.clinicalViewModeId,
    focus?.clinicalViewLabel,
    focus?.windowCenter,
    focus?.windowWidth,
  ])

  if (!open) return null

  return (
    <div className="similar-cases-overlay" role="dialog" aria-modal="true" aria-labelledby="similar-cases-title">
      <button type="button" className="similar-cases-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="similar-cases-panel">
        <div className="similar-cases-header">
          <h2 id="similar-cases-title">Похожие случаи</h2>
          <div className="similar-cases-header-actions">
            <button
              type="button"
              className="similar-cases-refresh"
              title="Перезапросить демо-список по текущему контексту viewer"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Обновить
            </button>
            <button type="button" className="similar-cases-close" onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          </div>
        </div>
        <p className="similar-cases-disclaimer">
          Демонстрационные данные. Не диагноз и не замена заключению врача. Решение и интерпретация остаются за
          специалистом (clinical-requirements.md §2).
        </p>
        {focus ? (
          <div className="similar-cases-focus-block">
            <p className="similar-cases-focus">
              Область интереса: срез {focus.sliceIndex + 1}, пиксель ({focus.col}, {focus.row})
              {focus.hu != null ? `, HU ≈ ${focus.hu.toFixed(0)}` : ''}. Контекст обновляется при сдвиге
              креста, смене режима или окна; кнопка «Обновить» перезапрашивает демо-список.
            </p>
            {(focus.clinicalViewLabel || focus.windowCenter != null) && (
              <div className="similar-cases-context-chips" aria-label="Контекст просмотра">
                {focus.clinicalViewLabel ? (
                  <span className="similar-cases-chip">{focus.clinicalViewLabel}</span>
                ) : null}
                {focus.windowCenter != null && focus.windowWidth != null ? (
                  <span className="similar-cases-chip similar-cases-chip-mono">
                    W {Math.round(focus.windowWidth)} / L {Math.round(focus.windowCenter)}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <p className="similar-cases-focus similar-cases-focus-muted">
            Откройте серию в viewer и наведите крест на интересующую область — затем снова откройте «Похожие
            случаи».
          </p>
        )}
        {loading ? (
          <p className="similar-cases-loading">Поиск шаблонов…</p>
        ) : (
          <ul className="similar-cases-list">
            {hits.map((h) => (
              <li key={h.id}>
                <div className="similar-cases-li-head">
                  <strong>{h.patternLabel}</strong>
                  <span className="similar-cases-sim">сходство {(h.similarity * 100).toFixed(0)}%</span>
                </div>
                <p className="similar-cases-rationale">{h.rationale}</p>
                <p className="similar-cases-ref">{h.exampleRef}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
