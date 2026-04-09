/**
 * Упрощённые текстурные и морфологические метрики по HU в лёгочной маске — без обучения и без настоящей сегментации органов.
 * Полезно как дополнение к корзинам HU: «неровность», резкие переходы, островки отклонения от медианы среза.
 */

import {
  analyzeLungSliceQuantification,
  isPixelInLungParenchymaMask,
} from './ctLungQuantification'

const HIST_LO = -1024
const HIST_HI = 120
const HIST_BINS = 256

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function localStd3x3(hu: Float32Array, w: number, h: number, x: number, y: number): number {
  const vals: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
      vals.push(hu[yy * w + xx])
    }
  }
  if (vals.length < 5) return 0
  let m = 0
  for (const v of vals) m += v
  m /= vals.length
  let s2 = 0
  for (const v of vals) {
    const d = v - m
    s2 += d * d
  }
  return Math.sqrt(s2 / vals.length)
}

function maxGrad4n(hu: Float32Array, w: number, h: number, x: number, y: number): number {
  const i = y * w + x
  const v = hu[i]
  let g = 0
  if (x > 0) g = Math.max(g, Math.abs(v - hu[i - 1]))
  if (x + 1 < w) g = Math.max(g, Math.abs(v - hu[i + 1]))
  if (y > 0) g = Math.max(g, Math.abs(v - hu[i - w]))
  if (y + 1 < h) g = Math.max(g, Math.abs(v - hu[i + w]))
  return g
}

function lungMedianHu(hu: Float32Array, w: number, h: number): number | null {
  const hist = new Uint32Array(HIST_BINS)
  let n = 0
  const y0 = Math.floor(h * 0.035)
  const y1 = h - Math.floor(h * 0.035)
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = hu[y * w + x]
      if (!isPixelInLungParenchymaMask(x, y, v, w, h)) continue
      n += 1
      const span = HIST_HI - HIST_LO + 1e-6
      let b = Math.floor(((v - HIST_LO) / span) * HIST_BINS)
      b = clamp(b, 0, HIST_BINS - 1)
      hist[b] += 1
    }
  }
  if (n < 400) return null
  const target = n * 0.5
  let acc = 0
  for (let i = 0; i < HIST_BINS; i += 1) {
    acc += hist[i]
    if (acc >= target) {
      return HIST_LO + ((i + 0.5) / HIST_BINS) * (HIST_HI - HIST_LO)
    }
  }
  return HIST_LO
}

export type SliceRadiomicsLite = {
  medianLungHu: number
  meanLocalStd3x3: number
  maxGradient4n: number
  focalHighClusters: number
  focalLowClusters: number
  lungSamplesForTexture: number
}

/**
 * Островки: связные компоненты в маске, где |HU − медиана| > порога; размер ограничен, чтобы отсечь «всё срез» и шум.
 */
function countFocalDeviationClusters(
  hu: Float32Array,
  w: number,
  h: number,
  median: number,
  devThreshold: number,
  minArea: number,
  maxArea: number,
): { high: number; low: number } {
  const t = w * h
  const dev = new Uint8Array(t)
  const y0 = Math.floor(h * 0.035)
  const y1 = h - Math.floor(h * 0.035)
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const v = hu[i]
      if (!isPixelInLungParenchymaMask(x, y, v, w, h)) continue
      if (Math.abs(v - median) > devThreshold) dev[i] = 1
    }
  }

  const visited = new Uint8Array(t)
  let high = 0
  let low = 0
  const qx = new Int32Array(t)
  const qy = new Int32Array(t)

  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      if (dev[i] === 0 || visited[i]) continue

      let qh = 0
      let qt = 0
      qx[qt] = x
      qy[qt] = y
      qt += 1
      visited[i] = 1
      let sumHu = 0
      let count = 0

      while (qh < qt) {
        const cx = qx[qh]
        const cy = qy[qh]
        qh += 1
        const ci = cy * w + cx
        sumHu += hu[ci]
        count += 1
        const nbs = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const
        for (const [nx, ny] of nbs) {
          if (nx < 0 || nx >= w || ny < y0 || ny >= y1) continue
          const ni = ny * w + nx
          if (dev[ni] === 0 || visited[ni]) continue
          visited[ni] = 1
          qx[qt] = nx
          qy[qt] = ny
          qt += 1
        }
      }

      if (count < minArea || count > maxArea) continue
      const mean = sumHu / count
      if (mean > median + devThreshold * 0.35) high += 1
      else if (mean < median - devThreshold * 0.35) low += 1
    }
  }

  return { high, low }
}

const MIN_LUNG_VOXELS = 120
const TEXTURE_STRIDE = 2

export function analyzeSliceRadiomicsLite(
  hu: Float32Array,
  w: number,
  h: number,
): SliceRadiomicsLite | null {
  const lung = analyzeLungSliceQuantification(hu, w, h)
  if (!lung.thoraxLike || lung.lungVoxels < MIN_LUNG_VOXELS) return null

  const median = lungMedianHu(hu, w, h)
  if (median === null) return null

  let sumStd = 0
  let nStd = 0
  let maxG = 0
  const y0 = Math.max(1, Math.floor(h * 0.035))
  const y1 = Math.min(h - 1, h - Math.floor(h * 0.035))
  for (let y = y0; y < y1; y += TEXTURE_STRIDE) {
    for (let x = 1; x < w - 1; x += TEXTURE_STRIDE) {
      const v = hu[y * w + x]
      if (!isPixelInLungParenchymaMask(x, y, v, w, h)) continue
      sumStd += localStd3x3(hu, w, h, x, y)
      maxG = Math.max(maxG, maxGrad4n(hu, w, h, x, y))
      nStd += 1
    }
  }

  const focal = countFocalDeviationClusters(hu, w, h, median, 130, 40, 9000)

  return {
    medianLungHu: median,
    meanLocalStd3x3: nStd > 0 ? sumStd / nStd : 0,
    maxGradient4n: maxG,
    focalHighClusters: focal.high,
    focalLowClusters: focal.low,
    lungSamplesForTexture: nStd,
  }
}
