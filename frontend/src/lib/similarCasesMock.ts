/**
 * Заглушка сервиса похожих случаев (clinical-requirements.md §2).
 * Позже заменяется локальной/серверной базой и эмбеддингами.
 */
export type SimilarCaseHit = {
  id: string
  patternLabel: string
  similarity: number
  rationale: string
  exampleRef: string
}

/** Область интереса: текущий срез и пиксель креста (минимальный сценарий §2). */
export type SimilarCasesFocusContext = {
  sliceIndex: number
  col: number
  row: number
  hu: number | null
  /** Клинический режим просмотра (лёгкие, сосуды, …) — влияет на приоритет шаблонов в демо. */
  clinicalViewModeId?: string
  clinicalViewLabel?: string
  windowCenter?: number
  windowWidth?: number
}

function clamp01(x: number) {
  return Math.max(0.05, Math.min(0.95, x))
}

function clinicalBoost(modeId: string | undefined, patternId: 'consolidation' | 'gg' | 'pleural'): number {
  if (!modeId) return 0
  if (modeId === 'lung' || modeId === 'bronchi') {
    if (patternId === 'gg') return 0.06
    if (patternId === 'consolidation') return 0.04
    if (patternId === 'pleural') return 0.02
  }
  if (modeId === 'vessels' || modeId === 'heart' || modeId === 'aorta_oas') {
    if (patternId === 'pleural') return 0.03
  }
  return 0
}

export async function fetchSimilarCasesMock(
  _seriesUid: string,
  focus: SimilarCasesFocusContext | null,
): Promise<SimilarCaseHit[]> {
  await new Promise((r) => setTimeout(r, 280))
  const huNote =
    focus?.hu != null && Number.isFinite(focus.hu)
      ? ` Учтён HU≈${focus.hu.toFixed(0)} в точке (срез ${focus.sliceIndex + 1}, ${focus.col}, ${focus.row}).`
      : ' Точка интереса не задана — используется только идентификатор серии.'
  const modeNote =
    focus?.clinicalViewLabel && focus.clinicalViewModeId
      ? ` Режим просмотра: «${focus.clinicalViewLabel}» (W/L ориентир ${focus.windowCenter ?? '—'}/${focus.windowWidth ?? '—'}).`
      : ''
  const baseConsolidation =
    focus?.hu != null && focus.hu > -200 && focus.hu < 100 ? 0.76 : 0.72
  const s1 = clamp01(baseConsolidation + clinicalBoost(focus?.clinicalViewModeId, 'consolidation'))
  const s2 = clamp01(0.58 + clinicalBoost(focus?.clinicalViewModeId, 'gg'))
  const s3 = clamp01(0.41 + clinicalBoost(focus?.clinicalViewModeId, 'pleural'))

  return [
    {
      id: 'mock-1',
      patternLabel: 'Периферический консолидативный очаг (дифф. диагноз)',
      similarity: s1,
      rationale:
        'Грубое сходство по гистограмме HU в периферийных зонах и доле низкой плотности; не учитывает клинику.' +
        huNote +
        modeNote,
      exampleRef: 'Демо-кейс #1042 (локальная база не подключена)',
    },
    {
      id: 'mock-2',
      patternLabel: 'Интерстициальные изменения / «матовое стекло»',
      similarity: s2,
      rationale:
        'Частичное пересечение по текстуре; низкая специфичность без тонких срезов и динамики.' +
        huNote +
        modeNote,
      exampleRef: 'Шаблон обучения / ссылка будет из PACS',
    },
    {
      id: 'mock-3',
      patternLabel: 'Плевральная реакция без устойчивого паренхиматозного очага',
      similarity: s3,
      rationale: 'Слабые признаки; требуется корреляция с серией и соседними срезами.' + huNote + modeNote,
      exampleRef: '—',
    },
  ]
}
