/**
 * Оценка числа нижних строк аксиального среза, занятых столом/ложементом (высокая плотность снизу).
 * Используется в 2D-проекциях и при сборке объёма для vtk.
 */

export type CtSliceLike = {
  rows: number
  columns: number
  huPixels: Float32Array
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/** Доля «столовых» пикселей в строке y (аксиал: rows × columns). */
function rowTableLikeFraction(frame: CtSliceLike, y: number): { fh: number; fe: number } {
  const { columns, huPixels } = frame
  let high = 0
  let elevated = 0
  for (let x = 0; x < columns; x += 1) {
    const v = huPixels[y * columns + x]
    if (v > 200) high += 1
    else if (v > 85) elevated += 1
  }
  return { fh: high / columns, fe: elevated / columns }
}

/**
 * Центральная полоса (~70% ширины): лёгкие/воздух по бокам не размывают долю стола,
 * как на whole-body и грудных аксиалах.
 */
function rowTableLikeFractionCenter(frame: CtSliceLike, y: number): { fh: number; fe: number } {
  const { columns, huPixels } = frame
  const x0 = Math.max(0, Math.floor(columns * 0.14))
  const x1 = Math.min(columns, Math.ceil(columns * 0.86))
  if (x1 <= x0) return { fh: 0, fe: 0 }
  let high = 0
  let elevated = 0
  const w = x1 - x0
  for (let x = x0; x < x1; x += 1) {
    const v = huPixels[y * columns + x]
    if (v > 200) high += 1
    else if (v > 85) elevated += 1
  }
  return { fh: high / w, fe: elevated / w }
}

function rowIsTableLike(frame: CtSliceLike, y: number): boolean {
  const { fh, fe } = rowTableLikeFraction(frame, y)
  if (fh > 0.26 || (fh > 0.1 && fe > 0.38) || (fh > 0.06 && fh + fe * 0.4 > 0.42)) {
    return true
  }
  const c = rowTableLikeFractionCenter(frame, y)
  return (
    c.fh > 0.18 ||
    (c.fh > 0.07 && c.fe > 0.32) ||
    (c.fh > 0.05 && c.fh + c.fe * 0.45 > 0.38)
  )
}

function bottomCenterBandStats(
  frame: CtSliceLike,
  bandRows: number,
): { mean: number; maxV: number } {
  const { rows, columns, huPixels } = frame
  const x0 = Math.max(0, Math.floor(columns * 0.15))
  const x1 = Math.min(columns, Math.ceil(columns * 0.85))
  let sum = 0
  let n = 0
  let maxV = -10000
  const y0 = Math.max(0, rows - bandRows)
  for (let y = y0; y < rows; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = huPixels[y * columns + x]
      sum += v
      n += 1
      if (v > maxV) maxV = v
    }
  }
  return { mean: n > 0 ? sum / n : -1000, maxV }
}

function topCenterBandStats(
  frame: CtSliceLike,
  bandRows: number,
): { mean: number; maxV: number } {
  const { rows, columns, huPixels } = frame
  const x0 = Math.max(0, Math.floor(columns * 0.15))
  const x1 = Math.min(columns, Math.ceil(columns * 0.85))
  let sum = 0
  let n = 0
  let maxV = -10000
  const y1 = Math.min(rows, bandRows)
  for (let y = 0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = huPixels[y * columns + x]
      sum += v
      n += 1
      if (v > maxV) maxV = v
    }
  }
  return { mean: n > 0 ? sum / n : -1000, maxV }
}

/** Оценка числа строк снизу аксиала, занятых столом (для одного среза). */
export function estimateTableCutRowsSingle(frame: CtSliceLike): number {
  const { rows, columns } = frame
  if (rows < 8 || columns < 8) return 0

  const startRow = Math.floor(rows * 0.5)
  let run = 0
  let cutFromBottom = 0

  for (let y = rows - 1; y >= startRow; y -= 1) {
    if (rowIsTableLike(frame, y)) {
      run += 1
      if (run >= 3) {
        cutFromBottom = Math.max(cutFromBottom, rows - y + 5)
      }
    } else {
      run = 0
    }
  }

  if (cutFromBottom === 0) {
    const band = Math.max(8, Math.floor(rows * 0.12))
    const { mean, maxV } = bottomCenterBandStats(frame, band)
    if (mean > 165) {
      cutFromBottom = Math.min(band + 8, Math.floor(rows * 0.24))
    } else if (mean > 88 && maxV > 300) {
      cutFromBottom = Math.min(band + 14, Math.floor(rows * 0.3))
    }
  }

  const cap = Math.floor(rows * 0.4)
  return clamp(cutFromBottom, 0, cap)
}

/**
 * Строки сверху аксиала (голова внизу FOV, стол у верхней кромки, «панель» за спиной).
 */
export function estimateTableCutTopRowsSingle(frame: CtSliceLike): number {
  const { rows, columns } = frame
  if (rows < 8 || columns < 8) return 0

  const endRow = Math.floor(rows * 0.48)
  let run = 0
  let cutFromTop = 0

  for (let y = 0; y < endRow; y += 1) {
    if (rowIsTableLike(frame, y)) {
      run += 1
      if (run >= 3) {
        cutFromTop = Math.max(cutFromTop, y + 1 + 4)
      }
    } else {
      run = 0
    }
  }

  if (cutFromTop === 0) {
    const band = Math.max(8, Math.floor(rows * 0.12))
    const { mean, maxV } = topCenterBandStats(frame, band)
    if (mean > 165) {
      cutFromTop = Math.min(band + 6, Math.floor(rows * 0.22))
    } else if (mean > 88 && maxV > 300) {
      cutFromTop = Math.min(band + 12, Math.floor(rows * 0.28))
    }
  }

  const cap = Math.floor(rows * 0.35)
  return clamp(cutFromTop, 0, cap)
}

function columnCouchLike(frame: CtSliceLike, x: number): boolean {
  const { rows, columns, huPixels } = frame
  const y0 = Math.floor(rows * 0.22)
  const y1 = Math.floor(rows * 0.8)
  let high = 0
  let cnt = 0
  for (let y = y0; y < y1; y += 1) {
    const v = huPixels[y * columns + x]
    if (v > 200) high += 1
    cnt += 1
  }
  return cnt > 0 && high / cnt > 0.4
}

/** Узкие вертикальные полосы ложа слева/справа (вид «стола сзади» на коронале). */
export function estimateTableSideCutsSingle(frame: CtSliceLike): { left: number; right: number } {
  const { columns } = frame
  if (columns < 16) return { left: 0, right: 0 }

  const maxBand = Math.min(Math.floor(columns * 0.22), 48)
  let left = 0
  for (let x = 0; x < maxBand; x += 1) {
    if (!columnCouchLike(frame, x)) break
    left = x + 1
  }
  let right = 0
  for (let x = columns - 1; x > columns - 1 - maxBand; x -= 1) {
    if (!columnCouchLike(frame, x)) break
    right = columns - x
  }

  const pad = 2
  left = clamp(left + pad, 0, Math.floor(columns * 0.28))
  right = clamp(right + pad, 0, Math.floor(columns * 0.28))

  if (left + right > Math.floor(columns * 0.42)) {
    const scale = (Math.floor(columns * 0.42) - 1) / (left + right)
    left = Math.floor(left * scale)
    right = Math.floor(right * scale)
  }

  return { left, right }
}

export type TableCouchCropV1 = {
  top: number
  bottom: number
  left: number
  right: number
}

/** Агрегат по серии: максимум обрезок со всех опорных срезов. */
export function estimateTableCouchCropForSlices(slices: CtSliceLike[]): TableCouchCropV1 {
  if (slices.length === 0) {
    return { top: 0, bottom: 0, left: 0, right: 0 }
  }
  const n = slices.length
  const seen = new Set<number>()
  seen.add(0)
  seen.add(n - 1)
  seen.add(Math.floor(n * 0.5))
  const step = Math.max(1, Math.min(8, Math.floor(n / 28)))
  for (let i = 0; i < n; i += step) seen.add(i)
  for (const p of [0.06, 0.12, 0.18, 0.25, 0.32, 0.4, 0.48, 0.55, 0.62, 0.7, 0.78, 0.85, 0.92]) {
    const j = Math.floor(n * p)
    if (j >= 0 && j < n) seen.add(j)
  }
  let top = 0
  let bottom = 0
  let left = 0
  let right = 0
  for (const i of seen) {
    const s = slices[i]
    bottom = Math.max(bottom, estimateTableCutRowsSingle(s))
    top = Math.max(top, estimateTableCutTopRowsSingle(s))
    const side = estimateTableSideCutsSingle(s)
    left = Math.max(left, side.left)
    right = Math.max(right, side.right)
  }
  return { top, bottom, left, right }
}

/** Несколько опорных срезов — стол может по-разному попадать в крайние срезы серии. */
export function estimateTableCutRowsForSlices(slices: CtSliceLike[]): number {
  return estimateTableCouchCropForSlices(slices).bottom
}
