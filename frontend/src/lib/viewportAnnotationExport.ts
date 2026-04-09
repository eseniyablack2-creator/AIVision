/** Подпись аннотаций для DICOM ImageComments / отчётов (текущий срез). */

import { computeHuPolygonRoiStats, computeHuRoiStats } from './huRoiStats'

export type Point2 = { x: number; y: number }

export type LengthAnnotation = { start: Point2; end: Point2; sliceZ: number }

export type AngleAnnotation = { a: Point2; b: Point2; c: Point2; sliceZ: number }

export type HuRoiRectAnnotation = { start: Point2; end: Point2; sliceZ: number }

export type HuRoiPolyAnnotation = { points: Point2[]; sliceZ: number }

export type AxialAnnotationExportOptions = {
  huRoiRect?: HuRoiRectAnnotation | null
  huRoiPoly?: HuRoiPolyAnnotation | null
  /** HU текущего аксиального кадра — для среднего HU в ROI в подписи SC */
  frameHu?: { huPixels: Float32Array; columns: number; rows: number } | null
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function angleAtVertexDeg(a: Point2, b: Point2, c: Point2): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const len1 = Math.hypot(v1x, v1y)
  const len2 = Math.hypot(v2x, v2y)
  if (len1 < 1e-9 || len2 < 1e-9) return Number.NaN
  const cos = clamp((v1x * v2x + v1y * v2y) / (len1 * len2), -1, 1)
  return (Math.acos(cos) * 180) / Math.PI
}

function appendRoiExportLine(
  parts: string[],
  kind: 'rect' | 'poly',
  sliceZ: number,
  stats: ReturnType<typeof computeHuRoiStats> | null,
) {
  const sliceNote = `срез ${sliceZ + 1}`
  const label = kind === 'poly' ? 'ROI poly' : 'ROI'
  if (stats && stats.count > 0) {
    parts.push(`AIVision: ${label} Ø ${stats.mean.toFixed(1)} HU · n=${stats.count} (${sliceNote})`)
  } else {
    parts.push(`AIVision: ${label} (${sliceNote})`)
  }
}

/**
 * Краткое текстовое описание линейки, угла и HU-ROI на заданном аксиальном индексе (для SC / отчёта).
 */
export function formatAxialAnnotationSummary(
  sliceZ: number,
  measurement: LengthAnnotation | null,
  angle: AngleAnnotation | null,
  pixelSpacingX: number,
  pixelSpacingY: number,
  options?: AxialAnnotationExportOptions | null,
): string {
  const parts: string[] = []
  if (measurement && measurement.sliceZ === sliceZ) {
    const dx = (measurement.end.x - measurement.start.x) * pixelSpacingX
    const dy = (measurement.end.y - measurement.start.y) * pixelSpacingY
    const len = Math.sqrt(dx * dx + dy * dy)
    if (Number.isFinite(len)) {
      parts.push(`AIVision: L ${len.toFixed(1)} mm (срез ${sliceZ + 1})`)
    }
  }
  if (angle && angle.sliceZ === sliceZ) {
    const deg = angleAtVertexDeg(angle.a, angle.b, angle.c)
    if (Number.isFinite(deg)) {
      parts.push(`AIVision: ∠ ${deg.toFixed(1)}° @ срез ${sliceZ + 1}`)
    }
  }

  const opt = options ?? undefined
  if (opt) {
    const { huRoiRect, huRoiPoly, frameHu } = opt
    const canCompute =
      frameHu != null && frameHu.huPixels.length === frameHu.columns * frameHu.rows

    if (huRoiPoly && huRoiPoly.sliceZ === sliceZ && huRoiPoly.points.length >= 3) {
      const stats = canCompute
        ? computeHuPolygonRoiStats(
            frameHu.huPixels,
            frameHu.columns,
            frameHu.rows,
            huRoiPoly.points,
            pixelSpacingX,
            pixelSpacingY,
          )
        : null
      appendRoiExportLine(parts, 'poly', sliceZ, stats)
    } else if (huRoiRect && huRoiRect.sliceZ === sliceZ) {
      const stats = canCompute
        ? computeHuRoiStats(
            frameHu.huPixels,
            frameHu.columns,
            frameHu.rows,
            huRoiRect.start.x,
            huRoiRect.start.y,
            huRoiRect.end.x,
            huRoiRect.end.y,
            pixelSpacingX,
            pixelSpacingY,
          )
        : null
      appendRoiExportLine(parts, 'rect', sliceZ, stats)
    }
  }

  return parts.join(' | ')
}
