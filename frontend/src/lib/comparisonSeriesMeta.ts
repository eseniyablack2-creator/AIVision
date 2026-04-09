import type { DicomSeries } from './dicom'
import { formatDate } from './dicom'

export type ComparisonSeriesSnapshot = {
  label: string
  patientName: string
  patientId: string
  studyInstanceUid: string
  seriesInstanceUid: string
  modality: string
  studyDate: string
  sliceCount: number
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  sliceThicknessMm: number | null
  spacingBetweenSlicesMm: number | null
  /** FOV в плоскости изображения: columns×Δcol, rows×Δrow (мм). */
  fovWidthMm: number | null
  fovHeightMm: number | null
  /** Грубая длина покрытия по Z: N срезов × шаг (или толщина), мм. */
  extentZApproxMm: number | null
}

export function seriesToComparisonSnapshot(
  series: DicomSeries,
  label: string,
): ComparisonSeriesSnapshot {
  const f0 = series.files[0]
  const cols = f0?.columns ?? 0
  const rows = f0?.rows ?? 0
  const psx = f0?.pixelSpacingX ?? 1
  const psy = f0?.pixelSpacingY ?? 1
  const fovW =
    cols > 0 && rows > 0 && Number.isFinite(psx) && Number.isFinite(psy) ? cols * psx : null
  const fovH =
    cols > 0 && rows > 0 && Number.isFinite(psx) && Number.isFinite(psy) ? rows * psy : null
  const spZ = f0?.spacingBetweenSlicesMm ?? f0?.sliceThicknessMm
  const n = series.files.length
  const extentZ =
    n > 0 && spZ != null && Number.isFinite(spZ) && spZ > 0 ? n * spZ : null

  return {
    label,
    patientName: series.patientName,
    patientId: series.patientId?.trim() ?? '',
    studyInstanceUid: series.studyInstanceUid,
    seriesInstanceUid: series.seriesInstanceUid,
    modality: series.modality,
    studyDate: series.studyDate,
    sliceCount: n,
    rows,
    columns: cols,
    pixelSpacingX: psx,
    pixelSpacingY: psy,
    sliceThicknessMm: f0?.sliceThicknessMm ?? null,
    spacingBetweenSlicesMm: f0?.spacingBetweenSlicesMm ?? null,
    fovWidthMm: fovW,
    fovHeightMm: fovH,
    extentZApproxMm: extentZ,
  }
}

function normPatientId(id: string) {
  return id.trim().toUpperCase()
}

function dicomStudyDateToUtcMs(d: string): number | null {
  const t = d.trim()
  if (t.length !== 8) return null
  const y = Number(t.slice(0, 4))
  const mo = Number(t.slice(4, 6)) - 1
  const day = Number(t.slice(6, 8))
  if (![y, mo, day].every(Number.isFinite) || mo < 0 || mo > 11 || day < 1 || day > 31) {
    return null
  }
  const ms = Date.UTC(y, mo, day)
  return Number.isNaN(ms) ? null : ms
}

function russianDaysWord(n: number): string {
  const abs = Math.abs(Math.trunc(n))
  const m100 = abs % 100
  const m10 = abs % 10
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 > 20)) return 'дня'
  return 'дней'
}

/** Разница в календарных днях между датами DICOM (YYYYMMDD): secondary − primary. */
export function studyDateIntervalDescription(
  primaryDate: string,
  secondaryDate: string,
): string | null {
  const ta = dicomStudyDateToUtcMs(primaryDate)
  const tb = dicomStudyDateToUtcMs(secondaryDate)
  if (ta == null || tb == null) return null
  const diffDays = Math.round((tb - ta) / 86400000)
  if (diffDays === 0) return null
  const n = Math.abs(diffDays)
  const w = russianDaysWord(n)
  if (diffDays > 0) return `Серия сравнения на ${n} ${w} позже текущей.`
  return `Серия сравнения на ${n} ${w} раньше текущей.`
}

function approxEq(a: number, b: number, eps: number) {
  return Math.abs(a - b) <= eps
}

export type ComparisonDiffKind =
  | 'patient_id'
  | 'study'
  | 'study_date'
  | 'matrix'
  | 'spacing'
  | 'fov'
  | 'extent_z'
  | 'slice_count'
  | 'modality'

export type ComparisonDiff = {
  kind: ComparisonDiffKind
  message: string
}

export function diffComparisonSeries(
  a: ComparisonSeriesSnapshot,
  b: ComparisonSeriesSnapshot,
): ComparisonDiff[] {
  const out: ComparisonDiff[] = []
  const idA = normPatientId(a.patientId)
  const idB = normPatientId(b.patientId)

  if (idA && idB && idA !== idB) {
    out.push({
      kind: 'patient_id',
      message: `Разные Patient ID: «${a.patientId}» и «${b.patientId}» — убедитесь, что это один пациент.`,
    })
  } else if (idA && !idB) {
    out.push({
      kind: 'patient_id',
      message: 'У серии сравнения нет Patient ID — сопоставление пациента по ID невозможно.',
    })
  } else if (!idA && idB) {
    out.push({
      kind: 'patient_id',
      message: 'У текущей серии нет Patient ID — сопоставление пациента по ID невозможно.',
    })
  }

  const samePatient = Boolean(idA && idB && idA === idB)
  if (
    samePatient &&
    a.studyInstanceUid.trim() &&
    b.studyInstanceUid.trim() &&
    a.studyInstanceUid !== b.studyInstanceUid
  ) {
    out.push({
      kind: 'study',
      message:
        'Разные Study Instance UID при совпадающем Patient ID — обычно два исследования одного пациента (динамика).',
    })
  }

  const dateA = a.studyDate.trim()
  const dateB = b.studyDate.trim()
  if (dateA.length === 8 && dateB.length === 8 && dateA !== dateB) {
    const interval = studyDateIntervalDescription(dateA, dateB)
    out.push({
      kind: 'study_date',
      message: `Разные даты исследования (Study Date): ${formatDate(dateA)} и ${formatDate(dateB)}.${
        interval ? ` ${interval}` : ''
      }`,
    })
  }

  if (a.modality.trim() !== b.modality.trim()) {
    out.push({
      kind: 'modality',
      message: `Разная модальность: ${a.modality} и ${b.modality}.`,
    })
  }

  if (a.rows !== b.rows || a.columns !== b.columns) {
    out.push({
      kind: 'matrix',
      message: `Разный размер матрицы: ${a.columns}×${a.rows} и ${b.columns}×${b.rows} — FOV при том же шаге может отличаться.`,
    })
  }

  if (!approxEq(a.pixelSpacingX, b.pixelSpacingX, 0.005) || !approxEq(a.pixelSpacingY, b.pixelSpacingY, 0.005)) {
    out.push({
      kind: 'spacing',
      message: `Разный pixel spacing: ${a.pixelSpacingX.toFixed(3)}×${a.pixelSpacingY.toFixed(3)} мм и ${b.pixelSpacingX.toFixed(3)}×${b.pixelSpacingY.toFixed(3)} мм.`,
    })
  }

  const fovEpsMm = 2
  const fwA = a.fovWidthMm
  const fhA = a.fovHeightMm
  const fwB = b.fovWidthMm
  const fhB = b.fovHeightMm
  if (
    fwA != null &&
    fhA != null &&
    fwB != null &&
    fhB != null &&
    (!approxEq(fwA, fwB, fovEpsMm) || !approxEq(fhA, fhB, fovEpsMm))
  ) {
    out.push({
      kind: 'fov',
      message: `Разный расчётный FOV в плоскости: ${fwA.toFixed(0)}×${fhA.toFixed(0)} мм и ${fwB.toFixed(0)}×${fhB.toFixed(0)} мм (матрица × pixel spacing).`,
    })
  }

  const ezA = a.extentZApproxMm
  const ezB = b.extentZApproxMm
  if (ezA != null && ezB != null && Number.isFinite(ezA) && Number.isFinite(ezB)) {
    const tol = Math.max(8, 0.12 * Math.max(ezA, ezB))
    if (!approxEq(ezA, ezB, tol)) {
      out.push({
        kind: 'extent_z',
        message: `Разная оценка длины стека по Z (срезы × шаг): ≈${ezA.toFixed(0)} мм и ≈${ezB.toFixed(0)} мм.`,
      })
    }
  }

  if (a.sliceCount !== b.sliceCount) {
    out.push({
      kind: 'slice_count',
      message: `Разное число срезов: ${a.sliceCount} и ${b.sliceCount} — синхронный скролл ограничен меньшей серией.`,
    })
  }

  const thA = a.sliceThicknessMm
  const thB = b.sliceThicknessMm
  if (thA != null && thB != null && !approxEq(thA, thB, 0.05)) {
    out.push({
      kind: 'spacing',
      message: `Разная номинальная толщина среза: ${thA.toFixed(2)} и ${thB.toFixed(2)} мм.`,
    })
  }

  const spA = a.spacingBetweenSlicesMm
  const spB = b.spacingBetweenSlicesMm
  if (spA != null && spB != null && !approxEq(spA, spB, 0.05)) {
    out.push({
      kind: 'spacing',
      message: `Разный шаг между срезами: ${spA.toFixed(2)} и ${spB.toFixed(2)} мм.`,
    })
  }

  return out
}

/** Короткая подпись UID для подписи в UI (не анонимизация). */
export function shortUid(uid: string, tail = 12) {
  const t = uid.trim()
  if (t.length <= tail + 4) return t || '—'
  return `…${t.slice(-tail)}`
}

export function formatMmOptional(v: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)} мм`
}

export function formatFovMm(w: number | null, h: number | null) {
  if (w == null || h == null || !Number.isFinite(w) || !Number.isFinite(h)) return '—'
  return `${w.toFixed(0)} × ${h.toFixed(0)} мм`
}

/** Оба ID непустые и отличаются — для модального предупреждения перед сравнением. */
export function patientIdsMismatch(primary: DicomSeries, secondary: DicomSeries): boolean {
  const idA = (primary.patientId ?? '').trim().toUpperCase()
  const idB = (secondary.patientId ?? '').trim().toUpperCase()
  if (!idA || !idB) return false
  return idA !== idB
}
