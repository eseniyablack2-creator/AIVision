/** Статистика HU в прямоугольной ROI по сырому буферу HU (результат rescale slope/intercept). */

export type HuRoiStats = {
  count: number
  mean: number
  min: number
  max: number
  std: number
  /** Площадь: для прямоугольника — сетка пикселей; для полигона — шнурок в мм² */
  areaMm2?: number
  /** Как интерпретировать areaMm2 в HUD */
  areaKind?: 'grid' | 'contour'
}

export type RoiVertex = { x: number; y: number }

/** Чётно-нечётное правило; (px,py) — обычно центр пикселя. */
export function pointInPolygon(px: number, py: number, poly: ReadonlyArray<RoiVertex>): boolean {
  const n = poly.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-14) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** Площадь многоугольника в мм²: вершины в координатах столбец/строка → масштаб по PixelSpacing. */
export function polygonAreaMm2FromVertices(
  vertices: ReadonlyArray<RoiVertex>,
  pixelSpacingX: number,
  pixelSpacingY: number,
): number | null {
  if (vertices.length < 3) return null
  if (
    !Number.isFinite(pixelSpacingX) ||
    !Number.isFinite(pixelSpacingY) ||
    pixelSpacingX <= 0 ||
    pixelSpacingY <= 0
  ) {
    return null
  }
  let sum = 0
  const n = vertices.length
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n
    const xi = vertices[i].x * pixelSpacingX
    const yi = vertices[i].y * pixelSpacingY
    const xj = vertices[j].x * pixelSpacingX
    const yj = vertices[j].y * pixelSpacingY
    sum += xi * yj - xj * yi
  }
  return Math.abs(sum) / 2
}

function clampInt(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * @param ax0, ay0, ax1, ay1 — координаты в системе изображения (колонка, строка), как у креста/линейки
 * @param pixelSpacingX/Y — мм на пиксель (0028,0030 / 0028,0031)
 */
export function computeHuRoiStats(
  huPixels: Float32Array,
  columns: number,
  rows: number,
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  pixelSpacingX?: number,
  pixelSpacingY?: number,
): HuRoiStats | null {
  if (huPixels.length !== columns * rows) return null

  const x0 = clampInt(Math.floor(Math.min(ax0, ax1)), 0, columns - 1)
  const x1 = clampInt(Math.floor(Math.max(ax0, ax1)), 0, columns - 1)
  const y0 = clampInt(Math.floor(Math.min(ay0, ay1)), 0, rows - 1)
  const y1 = clampInt(Math.floor(Math.max(ay0, ay1)), 0, rows - 1)

  const nx = x1 - x0 + 1
  const ny = y1 - y0 + 1
  let areaMm2: number | undefined
  if (
    pixelSpacingX != null &&
    pixelSpacingY != null &&
    Number.isFinite(pixelSpacingX) &&
    Number.isFinite(pixelSpacingY) &&
    pixelSpacingX > 0 &&
    pixelSpacingY > 0
  ) {
    areaMm2 = nx * pixelSpacingX * ny * pixelSpacingY
  }

  let sum = 0
  let sumSq = 0
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let y = y0; y <= y1; y += 1) {
    const row = y * columns
    for (let x = x0; x <= x1; x += 1) {
      const v = huPixels[row + x]
      if (!Number.isFinite(v)) continue
      sum += v
      sumSq += v * v
      count += 1
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  if (count === 0) return null

  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return {
    count,
    mean,
    min,
    max,
    std: Math.sqrt(variance),
    ...(areaMm2 !== undefined ? { areaMm2, areaKind: 'grid' as const } : {}),
  }
}

/**
 * HU внутри замкнутого полигона (центры пикселей внутри контура).
 * Площадь контура — шнурок в плоскости с шагами sx/sy (приближение для аксиального среза).
 */
export function computeHuPolygonRoiStats(
  huPixels: Float32Array,
  columns: number,
  rows: number,
  vertices: ReadonlyArray<RoiVertex>,
  pixelSpacingX?: number,
  pixelSpacingY?: number,
): HuRoiStats | null {
  if (vertices.length < 3 || huPixels.length !== columns * rows) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of vertices) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  const x0 = clampInt(Math.floor(minX), 0, columns - 1)
  const x1 = clampInt(Math.ceil(maxX), 0, columns - 1)
  const y0 = clampInt(Math.floor(minY), 0, rows - 1)
  const y1 = clampInt(Math.ceil(maxY), 0, rows - 1)

  let areaMm2: number | undefined
  if (pixelSpacingX != null && pixelSpacingY != null) {
    const a = polygonAreaMm2FromVertices(vertices, pixelSpacingX, pixelSpacingY)
    if (a != null) areaMm2 = a
  }

  let sum = 0
  let sumSq = 0
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let y = y0; y <= y1; y += 1) {
    const row = y * columns
    for (let x = x0; x <= x1; x += 1) {
      if (!pointInPolygon(x + 0.5, y + 0.5, vertices)) continue
      const v = huPixels[row + x]
      if (!Number.isFinite(v)) continue
      sum += v
      sumSq += v * v
      count += 1
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  if (count === 0) return null

  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return {
    count,
    mean,
    min,
    max,
    std: Math.sqrt(variance),
    ...(areaMm2 !== undefined ? { areaMm2, areaKind: 'contour' as const } : {}),
  }
}
