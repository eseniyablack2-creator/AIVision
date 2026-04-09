import { useEffect, useState } from 'react'
import { formatDate } from '../lib/dicom'
import {
  diffComparisonSeries,
  formatFovMm,
  formatMmOptional,
  seriesToComparisonSnapshot,
  shortUid,
  type ComparisonSeriesSnapshot,
} from '../lib/comparisonSeriesMeta'
import type { DicomSeries } from '../lib/dicom'

type Props = {
  primary: DicomSeries
  secondary: DicomSeries
}

function MetaColumn({ snap }: { snap: ComparisonSeriesSnapshot }) {
  return (
    <div className="comparison-meta-col">
      <div className="comparison-meta-col-title">{snap.label}</div>
      <dl className="comparison-meta-dl">
        <div>
          <dt>Patient ID</dt>
          <dd>{snap.patientId || '—'}</dd>
        </div>
        <div>
          <dt>Имя</dt>
          <dd>{snap.patientName || '—'}</dd>
        </div>
        <div>
          <dt>Study UID</dt>
          <dd className="comparison-meta-mono" title={snap.studyInstanceUid}>
            {shortUid(snap.studyInstanceUid)}
          </dd>
        </div>
        <div>
          <dt>Series UID</dt>
          <dd className="comparison-meta-mono" title={snap.seriesInstanceUid}>
            {shortUid(snap.seriesInstanceUid)}
          </dd>
        </div>
        <div>
          <dt>Дата исслед.</dt>
          <dd>{formatDate(snap.studyDate)}</dd>
        </div>
        <div>
          <dt>Модальность</dt>
          <dd>{snap.modality}</dd>
        </div>
        <div>
          <dt>Матрица</dt>
          <dd>
            {snap.columns > 0 && snap.rows > 0 ? `${snap.columns}×${snap.rows}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Pixel spacing</dt>
          <dd>
            {snap.pixelSpacingX.toFixed(3)} × {snap.pixelSpacingY.toFixed(3)} мм
          </dd>
        </div>
        <div>
          <dt>FOV в плоскости ≈</dt>
          <dd>{formatFovMm(snap.fovWidthMm, snap.fovHeightMm)}</dd>
        </div>
        <div>
          <dt>Срезов</dt>
          <dd>{snap.sliceCount}</dd>
        </div>
        <div>
          <dt>Длина стека Z ≈</dt>
          <dd>{formatMmOptional(snap.extentZApproxMm, 0)}</dd>
        </div>
        <div>
          <dt>Толщина / шаг</dt>
          <dd>
            {formatMmOptional(snap.sliceThicknessMm)} / {formatMmOptional(snap.spacingBetweenSlicesMm)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function ComparisonMetadataBar({ primary, secondary }: Props) {
  const a = seriesToComparisonSnapshot(primary, 'Текущая серия')
  const b = seriesToComparisonSnapshot(secondary, 'Серия сравнения')
  const diffs = diffComparisonSeries(a, b)
  const hasPatientIssue = diffs.some((d) => d.kind === 'patient_id')
  const summaryLine = `${formatDate(a.studyDate)} · ${a.sliceCount} ср.  ↔  ${formatDate(b.studyDate)} · ${b.sliceCount} ср.`

  const [metaExpanded, setMetaExpanded] = useState(false)
  useEffect(() => {
    if (hasPatientIssue) setMetaExpanded(true)
  }, [hasPatientIssue, primary.seriesInstanceUid, secondary.seriesInstanceUid])

  return (
    <details
      className="comparison-metadata-details"
      open={metaExpanded}
      onToggle={(e) => setMetaExpanded(e.currentTarget.open)}
    >
      <summary
        className="comparison-meta-summary"
        aria-label="Развернуть или свернуть панель сравнения метаданных"
      >
        <span className="comparison-meta-summary-chev" aria-hidden />
        <span className="comparison-meta-summary-title">Сравнение метаданных</span>
        <span className="comparison-meta-summary-line">{summaryLine}</span>
        {hasPatientIssue ? (
          <span className="comparison-meta-summary-badge comparison-meta-summary-badge-warn">
            Patient ID
          </span>
        ) : diffs.length > 0 ? (
          <span className="comparison-meta-summary-badge comparison-meta-summary-badge-note">
            {diffs.length} отлич.
          </span>
        ) : (
          <span className="comparison-meta-summary-badge comparison-meta-summary-badge-ok">OK</span>
        )}
      </summary>
      <div className="comparison-metadata-panel" role="region" aria-label="Детали сравнения серий">
        {diffs.length > 0 ? (
          <ul className={`comparison-meta-alerts${hasPatientIssue ? ' has-patient-warn' : ''}`}>
            {diffs.map((d, i) => (
              <li
                key={`${d.kind}-${i}`}
                className={
                  d.kind === 'patient_id'
                    ? 'comparison-meta-alert comparison-meta-alert-patient'
                    : d.kind === 'study'
                      ? 'comparison-meta-alert comparison-meta-alert-info'
                      : d.kind === 'study_date'
                        ? 'comparison-meta-alert comparison-meta-alert-date'
                        : 'comparison-meta-alert'
                }
              >
                {d.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="comparison-meta-ok">
            Patient ID совпадает, Study UID одинаковый или отличия только ожидаемые; геометрия и FOV
            согласованы в пределах допуска.
          </p>
        )}
        <div className="comparison-meta-columns">
          <MetaColumn snap={a} />
          <MetaColumn snap={b} />
        </div>
        <details className="comparison-meta-methodology">
          <summary>Как считаются FOV и длина Z</summary>
          <p>
            FOV ≈ матрица × pixel spacing; длина Z ≈ число срезов × (0018,0088 или 0018,0050) — ориентир,
            без учёта наклона и переменного шага.
          </p>
        </details>
      </div>
    </details>
  )
}
