import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onContinue: () => void
  onHideComparison: () => void
  primaryPatientId: string
  secondaryPatientId: string
}

export function ComparisonPatientMismatchModal({
  open,
  onContinue,
  onHideComparison,
  primaryPatientId,
  secondaryPatientId,
}: Props) {
  const primaryActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    primaryActionRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onHideComparison()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onHideComparison])

  if (!open) return null

  return (
    <div
      className="comparison-patient-mismatch-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-patient-mismatch-title"
    >
      <button
        type="button"
        className="comparison-patient-mismatch-backdrop"
        aria-label="Закрыть сравнение"
        onClick={onHideComparison}
      />
      <div className="comparison-patient-mismatch-panel">
        <h2 id="comparison-patient-mismatch-title">Разные Patient ID</h2>
        <p className="comparison-patient-mismatch-lead">
          В колонках указаны разные идентификаторы пациента. Убедитесь, что сравниваете данные одного
          человека, прежде чем продолжать.
        </p>
        <dl className="comparison-patient-mismatch-ids">
          <div>
            <dt>Текущая серия</dt>
            <dd>{primaryPatientId.trim() || '—'}</dd>
          </div>
          <div>
            <dt>Серия сравнения</dt>
            <dd>{secondaryPatientId.trim() || '—'}</dd>
          </div>
        </dl>
        <p className="comparison-patient-mismatch-kbd-hint">Escape — вернуть одну колонку</p>
        <div className="comparison-patient-mismatch-actions">
          <button type="button" className="comparison-patient-mismatch-secondary" onClick={onHideComparison}>
            Одна колонка
          </button>
          <button
            ref={primaryActionRef}
            type="button"
            className="comparison-patient-mismatch-primary"
            onClick={onContinue}
          >
            Продолжить сравнение
          </button>
        </div>
      </div>
    </div>
  )
}
