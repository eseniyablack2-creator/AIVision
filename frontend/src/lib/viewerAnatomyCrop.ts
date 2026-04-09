/**
 * Обрезка «пустого» воздуха вокруг тела на аксиале/реформатах для центрирования в окне просмотра.
 * Не влияет на HU — только на отрисовку (drawImage source rect).
 */

export type AnatomyCropRect = {
  x0: number
  y0: number
  x1: number
  y1: number
}

function rowMean(hu: Float32Array, w: number, y: number): number {
  const row = y * w
  let s = 0
  for (let x = 0; x < w; x += 1) s += hu[row + x]
  return s / w
}

function colMean(hu: Float32Array, w: number, x: number, y0: number, y1: number): number {
  let s = 0
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    s += hu[y * w + x]
    n += 1
  }
  return n > 0 ? s / n : -1024
}

/**
 * Возвращает ROI с мягкими границами по HU (воздух ~ −1000); если срез почти весь «тело» — null (без кропа).
 */
export function estimateAnatomyCropRect(
  hu: Float32Array,
  w: number,
  h: number,
  airMeanThreshold = -820,
): AnatomyCropRect | null {
  if (w < 32 || h < 32 || hu.length !== w * h) return null

  let y0 = 0
  for (let y = 0; y < h; y += 1) {
    if (rowMean(hu, w, y) > airMeanThreshold) {
      y0 = y
      break
    }
  }
  let y1 = h
  for (let y = h - 1; y >= 0; y -= 1) {
    if (rowMean(hu, w, y) > airMeanThreshold) {
      y1 = y + 1
      break
    }
  }

  if (y1 - y0 < Math.max(24, Math.floor(h * 0.12))) return null

  let x0 = 0
  for (let x = 0; x < w; x += 1) {
    if (colMean(hu, w, x, y0, y1) > airMeanThreshold) {
      x0 = x
      break
    }
  }
  let x1 = w
  for (let x = w - 1; x >= 0; x -= 1) {
    if (colMean(hu, w, x, y0, y1) > airMeanThreshold) {
      x1 = x + 1
      break
    }
  }

  const padY = Math.min(16, Math.floor((y1 - y0) * 0.04))
  const padX = Math.min(16, Math.floor((x1 - x0) * 0.03))
  y0 = Math.max(0, y0 - padY)
  y1 = Math.min(h, y1 + padY)
  x0 = Math.max(0, x0 - padX)
  x1 = Math.min(w, x1 + padX)

  const frac = ((x1 - x0) * (y1 - y0)) / (w * h)
  if (frac < 0.22 || frac > 0.98) return null

  return { x0, y0, x1, y1 }
}
