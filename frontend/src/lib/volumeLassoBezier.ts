/** Нормализованные координаты 0–1 (как на оверлее над 3D-видом). */
export type NormPoint = { x: number; y: number }

/** Одна точка на кривой Catmull–Rom (t ∈ [0,1]). */
function catmullRom2D(p0: NormPoint, p1: NormPoint, p2: NormPoint, p3: NormPoint, t: number): NormPoint {
  const t2 = t * t
  const t3 = t2 * t
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  return { x, y }
}

/**
 * Замкнутая гладкая линия по опорным точкам (Catmull–Rom → плотная полилиния).
 * Минимум 3 опорных точки; при меньшем возвращает копию исходника.
 */
export function smoothClosedLassoPolyline(anchors: NormPoint[], samplesPerSegment = 14): NormPoint[] {
  const n = anchors.length
  if (n < 3) return anchors.map((p) => ({ ...p }))
  const k = Math.max(4, Math.min(24, samplesPerSegment))
  const out: NormPoint[] = []
  for (let i = 0; i < n; i += 1) {
    const p0 = anchors[(i - 1 + n) % n]!
    const p1 = anchors[i]!
    const p2 = anchors[(i + 1) % n]!
    const p3 = anchors[(i + 2) % n]!
    for (let s = 0; s < k; s += 1) {
      const t = s / k
      out.push(catmullRom2D(p0, p1, p2, p3, t))
    }
  }
  return out
}

/** Равномерная выборка по дуге (длина в пикселях-нормали ~ квадрат расстояния). */
export function resamplePolylineByCount(pts: NormPoint[], targetCount: number): NormPoint[] {
  if (pts.length <= 2 || targetCount < 3) return pts.map((p) => ({ ...p }))
  let total = 0
  const segLen: number[] = []
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    segLen.push(d)
    total += d
  }
  if (total < 1e-9) return [pts[0]!, pts[Math.floor(pts.length / 2)]!, pts[pts.length - 1]!]
  const out: NormPoint[] = []
  for (let j = 0; j < targetCount; j += 1) {
    let u = (j / targetCount) * total
    let i = 0
    while (i < segLen.length && u > segLen[i]!) {
      u -= segLen[i]!
      i += 1
    }
    const a = pts[i]!
    const b = pts[Math.min(i + 1, pts.length - 1)]!
    const len = segLen[i] ?? 1e-9
    const t = len > 0 ? u / len : 0
    out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
  }
  return out
}

/**
 * Цепочка: прореживание ручного штриха → опорные узлы → замкнутый Catmull–Rom.
 */
export function buildSmoothLassoFromStroke(stroke: NormPoint[], anchorCount = 28): NormPoint[] {
  if (stroke.length < 3) return []
  const anchors = resamplePolylineByCount(stroke, Math.min(anchorCount, Math.max(8, Math.floor(stroke.length / 4))))
  return smoothClosedLassoPolyline(anchors, 16)
}

/** Сглаживание открытой линии (Цайкин) — для предпросмотра штриха до замыкания. */
export function chaikinOpen(pts: NormPoint[], iterations = 2): NormPoint[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }))
  let cur = pts.map((p) => ({ ...p }))
  for (let k = 0; k < iterations; k += 1) {
    if (cur.length < 2) break
    const next: NormPoint[] = []
    next.push({ ...cur[0]! })
    for (let i = 0; i < cur.length - 1; i += 1) {
      const p = cur[i]!
      const q = cur[i + 1]!
      next.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y })
      next.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y })
    }
    next.push({ ...cur[cur.length - 1]! })
    cur = next
  }
  return cur
}

/** Точка внутри замкнутого многоугольника (луч вправо). */
export function pointInPolygonNorm(x: number, y: number, poly: NormPoint[]): boolean {
  const n = poly.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const pi = poly[i]!
    const pj = poly[j]!
    const intersect =
      pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x
    if (intersect) inside = !inside
  }
  return inside
}
