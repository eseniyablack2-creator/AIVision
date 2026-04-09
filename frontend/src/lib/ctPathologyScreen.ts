/**
 * Вспомогательный скрининг КТ по правилам HU / регионов (эвристики).
 *
 * Не является сертифицированным средством диагностики: не заменяет заключение врача.
 * Для «реальной» классификации нужны размеченные данные + валидированная модель или серверный инференс.
 *
 * Опирается на типичные диапазоны HU в КТ (воздух, мягкие ткани, кровь, кальций) — см. учебные источники по HU.
 *
 * Сопоставление с iAorta (ZJU + Alibaba DAMO, Nature Medicine 2025): там — обученная модель для
 * острой аортальной патологии по **нативной** КТ (вероятность ОАС, сегментация стенки/просвета, карты активации).
 * Здесь **нет** той же нейросети и весов; UX сознательно смещён к **узкой центральной ROI** на грудных срезах
 * и подавлению костной окрестности, чтобы уменьшить ложные срабатывания на стенке и рёбрах (не имитация точности iAorta).
 */

import {
  analyzeLungSliceQuantification,
  sliceLooksLikeThorax,
  thoraxLateralMeansForDisplay,
  type LungHuBucketId,
} from './ctLungQuantification'
import { CT_SCREEN_SCHEMA_VERSION, type CtScreenPayloadV1 } from './ctInferenceTypes'
import { analyzeSliceRadiomicsLite } from './ctRadiomicsLite'
import { estimateTableCutRowsSingle } from './ctTableMask'

export type CtSliceInput = {
  columns: number
  rows: number
  huPixels: Float32Array
}

/** Класс находки для маски и тултипа (приоритет при наложении: меньше = важнее). */
export const PathologyClass = {
  none: 0,
  hyperdenseAcute: 1, // гиперденсивный очаг (дифф. диагноз кровь на НКТ и т.п.)
  consolidation: 2, // повышение плотности в лёгочной зоне
  lowAttenuationLung: 3, // низкая плотность (эмфиземоподобный паттерн)
  calcification: 4,
  /** Участки повышенной плотности в «мягком» диапазоне (тело / контраст — грубая эвристика) */
  softTissueFoci: 5,
} as const

export type PathologyClassId = (typeof PathologyClass)[keyof typeof PathologyClass]

export type PathologyFinding = {
  id: string
  classId: PathologyClassId
  label: string
  confidence: number
  summary: string
  details: string
  clinicalNote: string
  sliceIndices: number[]
}

/** Связная область маски на срезе (для подписей «островков»). */
export type PathologyBlob = {
  classId: PathologyClassId
  label: string
  /** Грубая привязка к органу / системе по типу правила (не анатомическая сегментация). */
  organSystem: string
  cx: number
  cy: number
  area: number
}

export type SlicePathologyAnalysis = {
  width: number
  height: number
  pickIds: Uint8Array
  highlightRgba: Uint8ClampedArray
  findings: PathologyFinding[]
  blobs: PathologyBlob[]
}

export type PathologyEngineInfo = {
  id:
    | 'heuristic_hu_v1'
    | 'heuristic_hu_v2_volume'
    | 'remote_model'
    | 'remote_hybrid'
  labelRu: string
  /** Юридически/клинически корректное ограничение: без валидированной модели это не изделие-диагност */
  regulatoryNoteRu: string
}

export type VolumePathologyResult = {
  /** Репрезентативный срез с максимальным «интересом» для перехода кнопкой */
  focusSliceIndex: number
  findings: PathologyFinding[]
  phaseNote: string
  rationale: string
  engine: PathologyEngineInfo
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/** Убрать класс с маски (если доля пикселей слишком велика — это не «очаг», а почти весь срез). */
function clearPathologyClassFromMask(
  classId: PathologyClassId,
  pickIds: Uint8Array,
  highlightRgba: Uint8ClampedArray,
  len: number,
) {
  for (let i = 0; i < len; i += 1) {
    if (pickIds[i] !== classId) continue
    pickIds[i] = PathologyClass.none
    const o = i * 4
    highlightRgba[o] = 0
    highlightRgba[o + 1] = 0
    highlightRgba[o + 2] = 0
    highlightRgba[o + 3] = 0
  }
}

/**
 * Нижняя граница строк (exclusive) для правил патологии: без зоны стола/ложемента.
 * Совпадает с логикой «убрать стол» в 3D; если отрез слишком сильный — откат к только margin.
 */
function pathologyRowExclusiveEnd(
  h: number,
  ySkipTop: number,
  ySkipBot: number,
  hu: Float32Array,
  w: number,
): number {
  const tableCut = estimateTableCutRowsSingle({ rows: h, columns: w, huPixels: hu })
  const end = h - ySkipBot - tableCut
  if (end <= ySkipTop + 4) return h - ySkipBot
  return end
}

/** Эвристика контрастной фазы: яркий сосудистый центр (без нижней полосы стола, если задан rowExclusiveEnd). */
function estimateContrastPhase(
  hu: Float32Array,
  w: number,
  h: number,
  rowExclusiveEnd?: number,
) {
  const cx0 = Math.floor(w * 0.38)
  const cx1 = Math.floor(w * 0.62)
  const cy0 = Math.floor(h * 0.22)
  let cy1 = Math.floor(h * 0.78)
  if (rowExclusiveEnd !== undefined && rowExclusiveEnd > cy0 + 6) {
    cy1 = Math.min(cy1, rowExclusiveEnd)
  }
  let sum = 0
  let n = 0
  for (let y = cy0; y < cy1; y += 1) {
    for (let x = cx0; x < cx1; x += 1) {
      sum += hu[y * w + x]
      n += 1
    }
  }
  const mean = n > 0 ? sum / n : 0
  let mx = -4000
  for (let i = 0; i < hu.length; i += 1) mx = Math.max(mx, hu[i])
  return { likelyContrast: mean > 88 || mx > 220, centerMean: mean, maxHu: mx }
}

function regionMean(
  hu: Float32Array,
  w: number,
  _h: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  let s = 0
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      s += hu[y * w + x]
      n += 1
    }
  }
  return n > 0 ? s / n : 0
}

type MetaEntry = {
  label: string
  summary: string
  details: string
  clinicalNote: string
  organSystem: string
}

const META: Record<PathologyClassId, MetaEntry | null> = {
  [PathologyClass.none]: null,
  [PathologyClass.hyperdenseAcute]: {
    label: 'Гиперденсивный очаг',
    summary:
      'Локально повышенная плотность в диапазоне, близком к острой крови и плотным мягким структурам (ориентир ~40–100 HU на нативной КТ; при контрасте порог смещается выше).',
    details:
      'Органы: головной мозг (внутричерепное кровоизлияние, гиперденсивный инфаркт), паренхима при кровотечении. Дифф. диагноз: сгусток крови, контраст в сосуде рядом, кальцинат, металлический артефакт.',
    clinicalNote: '',
    organSystem: 'Средостение / центр тела (эвристика, не сегментация аорты)',
  },
  [PathologyClass.consolidation]: {
    label: 'Повышенная плотность в лёгочных зонах',
    summary:
      'Периферийные поля лёгких плотнее «воздушного» паренхимы, но обычно ниже средостения и мягких тканей (типичный диапазон правила примерно −520…−120 HU).',
    details:
      'Лёгкие: консолидация, «матовое стекло», ателектаз, альвеолярная кровь; часть картин пересекается с опухолевым обсеменением и отёком.',
    clinicalNote: '',
    organSystem: 'Лёгочная система',
  },
  [PathologyClass.lowAttenuationLung]: {
    label: 'Зоны сниженной плотности лёгких',
    summary:
      'Выраженное снижение HU в боковых зонах лёгких (правило опирается на пиксели примерно < −880 HU в латеральных областях).',
    details:
      'Лёгкие: эмфизема, бульлы, астматический «воздушный» паттерн; также возможны артефакты низкой дозы и дыхания.',
    clinicalNote: '',
    organSystem: 'Лёгочная система',
  },
  [PathologyClass.calcification]: {
    label: 'Высокая плотность (кальций / плотная кость)',
    summary:
      'Значимая доля пикселей в диапазоне кальция и кортикала (ориентир примерно 185–420 HU в маске правила).',
    details:
      'Сосуды и сердце (атеросклероз, кальцинаты клапанов), плевра/паренхима (гранулёмы, старые очаги), лимфоузлы. Кортикальная кость отличается по форме и сопутствующему медуллярному каналу на серии.',
    clinicalNote: '',
    organSystem: 'Сосуды / кость / средостение',
  },
  [PathologyClass.softTissueFoci]: {
    label: 'Мягкие ткани (общий скрининг)',
    summary:
      'Скопления в диапазоне мягких тканей на срезах, где по ROI преобладает «тело», а не чисто лёгочный воздух (правило ~35–120 HU, при контрасте шире).',
    details:
      'Печень, селезёнка, почки, лимфоузлы, мышцы, сосуды с контрастом, воспалительные и опухолевые массы — по форме, динамике и всей серии; высокая доля ложных срабатываний при контрасте.',
    clinicalNote: '',
    organSystem: 'Брюшная полость / тело',
  },
}

/** RGBA оверлея по классу: красные/тёплые тона, только очаги (не вся площадь среза). */
function writePathologyHighlightPixel(
  highlightRgba: Uint8ClampedArray,
  pixelIndex: number,
  classId: PathologyClassId,
) {
  if (classId === PathologyClass.none) return
  const o = pixelIndex * 4
  switch (classId) {
    case PathologyClass.hyperdenseAcute:
      highlightRgba[o] = 255
      highlightRgba[o + 1] = 42
      highlightRgba[o + 2] = 48
      highlightRgba[o + 3] = 148
      break
    case PathologyClass.consolidation:
      highlightRgba[o] = 255
      highlightRgba[o + 1] = 78
      highlightRgba[o + 2] = 62
      highlightRgba[o + 3] = 132
      break
    case PathologyClass.lowAttenuationLung:
      highlightRgba[o] = 255
      highlightRgba[o + 1] = 105
      highlightRgba[o + 2] = 88
      highlightRgba[o + 3] = 118
      break
    case PathologyClass.calcification:
      highlightRgba[o] = 255
      highlightRgba[o + 1] = 165
      highlightRgba[o + 2] = 105
      highlightRgba[o + 3] = 108
      break
    case PathologyClass.softTissueFoci:
      highlightRgba[o] = 255
      highlightRgba[o + 1] = 62
      highlightRgba[o + 2] = 72
      highlightRgba[o + 3] = 128
      break
    default:
      break
  }
}

/** Нижняя граница площади связной области (шум). */
function minPixelsForPathologyClass(c: PathologyClassId): number {
  switch (c) {
    case PathologyClass.lowAttenuationLung:
      return 80
    case PathologyClass.consolidation:
      return 120
    case PathologyClass.calcification:
      return 64
    case PathologyClass.softTissueFoci:
    case PathologyClass.hyperdenseAcute:
      return 48
    default:
      return 40
  }
}

/**
 * Верхняя граница площади одной связной области: больше — диффузная «заливка», убираем с отображения.
 * Жёсткие лимиты (~2–3% кадра для лёгких), чтобы не краснел весь срез при матовом стекле / эмфиземе.
 */
function maxPixelsForPathologyClass(c: PathologyClassId, total: number): number {
  switch (c) {
    case PathologyClass.lowAttenuationLung:
      return Math.floor(total * 0.026)
    case PathologyClass.consolidation:
      return Math.floor(total * 0.019)
    case PathologyClass.calcification:
      return Math.floor(total * 0.022)
    case PathologyClass.softTissueFoci:
    case PathologyClass.hyperdenseAcute:
      return Math.floor(total * 0.0032)
    default:
      return Math.floor(total * 0.0035)
  }
}

/** Оставить на маске только компактные очаги; убрать «заливку» всего среза. */
function prunePathologyMaskToFocalBlobs(
  pickIds: Uint8Array,
  highlightRgba: Uint8ClampedArray,
  w: number,
  h: number,
) {
  const total = w * h
  const seen = new Uint8Array(total)

  for (let idx = 0; idx < total; idx += 1) {
    const cid = pickIds[idx]
    if (cid === PathologyClass.none || seen[idx]) continue
    const classId = cid as PathologyClassId
    const members: number[] = []
    const stack: number[] = [idx]
    seen[idx] = 1

    while (stack.length > 0) {
      const cur = stack.pop()!
      members.push(cur)
      const x = cur % w
      const y = (cur / w) | 0
      const push = (ni: number) => {
        if (ni < 0 || ni >= total || seen[ni] || pickIds[ni] !== classId) return
        seen[ni] = 1
        stack.push(ni)
      }
      if (x > 0) push(cur - 1)
      if (x + 1 < w) push(cur + 1)
      if (y > 0) push(cur - w)
      if (y + 1 < h) push(cur + w)
    }

    const n = members.length
    const minP = minPixelsForPathologyClass(classId)
    const maxP = maxPixelsForPathologyClass(classId, total)
    if (n >= minP && n <= maxP) continue

    for (const i of members) {
      pickIds[i] = PathologyClass.none
      const o = i * 4
      highlightRgba[o] = 0
      highlightRgba[o + 1] = 0
      highlightRgba[o + 2] = 0
      highlightRgba[o + 3] = 0
    }
  }
}

/**
 * Если после prune не осталось пикселей класса, но эвристика всё ещё даёт находку —
 * рисуем один компактный диск у центроида исходной маски (не вся плоскость среза).
 */
function addFallbackFocalDisksForClearedClasses(
  findings: PathologyFinding[],
  prePrunePick: Uint8Array,
  pickIds: Uint8Array,
  highlightRgba: Uint8ClampedArray,
  w: number,
  h: number,
) {
  const total = w * h
  const seenClass = new Set<PathologyClassId>()
  for (const f of findings) {
    const cid = f.classId
    if (cid === PathologyClass.none || seenClass.has(cid)) continue
    seenClass.add(cid)

    let hasAfter = false
    for (let i = 0; i < total; i += 1) {
      if (pickIds[i] === cid) {
        hasAfter = true
        break
      }
    }
    if (hasAfter) continue

    let sx = 0
    let sy = 0
    let nPre = 0
    for (let i = 0; i < total; i += 1) {
      if (prePrunePick[i] !== cid) continue
      sx += i % w
      sy += (i / w) | 0
      nPre += 1
    }
    const minP = minPixelsForPathologyClass(cid)
    if (nPre < minP) continue

    const cx = sx / nPre
    const cy = sy / nPre
    const rEst = Math.sqrt(nPre / Math.PI)
    const R = Math.max(11, Math.min(30, Math.round(rEst * 0.26)))

    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        if (dx * dx + dy * dy > R * R) continue
        const x = Math.round(cx + dx)
        const y = Math.round(cy + dy)
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const i = y * w + x
        if (pickIds[i] !== PathologyClass.none) continue
        pickIds[i] = cid
        writePathologyHighlightPixel(highlightRgba, i, cid)
      }
    }
  }
}

function filterFindingsWithRemainingMask(
  findings: PathologyFinding[],
  pickIds: Uint8Array,
): PathologyFinding[] {
  return findings.filter((f) => {
    for (let i = 0; i < pickIds.length; i += 1) {
      if (pickIds[i] === f.classId) return true
    }
    return false
  })
}

function extractPathologyBlobs(pickIds: Uint8Array, w: number, h: number): PathologyBlob[] {
  const total = w * h
  const seen = new Uint8Array(total)
  const out: PathologyBlob[] = []

  for (let idx = 0; idx < total; idx += 1) {
    const cid = pickIds[idx]
    if (cid === PathologyClass.none || seen[idx]) continue
    const classId = cid as PathologyClassId
    const stack: number[] = [idx]
    seen[idx] = 1
    let sumx = 0
    let sumy = 0
    let n = 0

    while (stack.length > 0) {
      const cur = stack.pop()!
      const x = cur % w
      const y = (cur / w) | 0
      sumx += x
      sumy += y
      n += 1
      const push = (ni: number) => {
        if (ni < 0 || ni >= total || seen[ni] || pickIds[ni] !== classId) return
        seen[ni] = 1
        stack.push(ni)
      }
      if (x > 0) push(cur - 1)
      if (x + 1 < w) push(cur + 1)
      if (y > 0) push(cur - w)
      if (y + 1 < h) push(cur + w)
    }

    const minP = minPixelsForPathologyClass(classId)
    const maxP = maxPixelsForPathologyClass(classId, total)
    if (n < minP || n > maxP) continue
    const m = META[classId]
    if (!m) continue
    out.push({
      classId,
      label: m.label,
      organSystem: m.organSystem,
      cx: sumx / n,
      cy: sumy / n,
      area: n,
    })
  }

  out.sort((a, b) => b.area - a.area)
  return out.slice(0, 10)
}

/** Максимум HU в квадратном окне (исключение рёберного кортикала рядом с «мягким» пикселем). */
function localMaxHu(
  hu: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rad: number,
): number {
  let mx = -10000
  const x0 = Math.max(0, x - rad)
  const x1 = Math.min(w - 1, x + rad)
  const y0 = Math.max(0, y - rad)
  const y1 = Math.min(h - 1, y + rad)
  for (let yy = y0; yy <= y1; yy += 1) {
    const row = yy * w
    for (let xx = x0; xx <= x1; xx += 1) {
      const v = hu[row + xx]
      if (v > mx) mx = v
    }
  }
  return mx
}

/**
 * Где допустима маска «гиперденсивный очаг»: на груди — узкая центральная зона (средостение),
 * не передняя/латеральная стенка; иначе — без периферийной «рамки» из мышц/рёбер.
 */
function pixelInHyperdenseRoi(
  x: number,
  y: number,
  w: number,
  h: number,
  thoraxLike: boolean,
): boolean {
  const fx = x / w
  const fy = y / h
  if (thoraxLike) {
    return fx >= 0.3 && fx <= 0.7 && fy >= 0.1 && fy <= 0.9
  }
  return fx >= 0.14 && fx <= 0.86 && fy >= 0.08 && fy <= 0.92
}

const BONE_NEIGHBORHOOD_MAX_HU = 292

/** Одна подпись на класс в близких точках — как единый «алерт», а не шесть одинаковых строк. */
function dedupeSpatialPathologyBlobs(blobs: PathologyBlob[], w: number, h: number): PathologyBlob[] {
  const minD = Math.max(32, Math.min(w, h) * 0.11)
  const minDSq = minD * minD
  const sorted = [...blobs].sort((a, b) => b.area - a.area)
  const out: PathologyBlob[] = []
  for (const b of sorted) {
    const nearSameClass = out.some((k) => {
      if (k.classId !== b.classId) return false
      const dx = k.cx - b.cx
      const dy = k.cy - b.cy
      return dx * dx + dy * dy < minDSq
    })
    if (!nearSameClass) out.push(b)
  }
  return out.slice(0, 5)
}

/**
 * Полный анализ одного среза: маски + локальные находки (до слияния по объёму).
 */
export function analyzeSlicePathology(hu: Float32Array, w: number, h: number): SlicePathologyAnalysis {
  const pickIds = new Uint8Array(w * h)
  const highlightRgba = new Uint8ClampedArray(w * h * 4)
  const findings: PathologyFinding[] = []
  const total = w * h

  const ySkipTop = Math.floor(h * 0.06)
  const ySkipBot = Math.floor(h * 0.06)
  const rowEnd = pathologyRowExclusiveEnd(h, ySkipTop, ySkipBot, hu, w)

  const { likelyContrast, maxHu } = estimateContrastPhase(hu, w, h, rowEnd)

  const { leftMean, rightMean } = thoraxLateralMeansForDisplay(hu, w, h)
  const thoraxLike = sliceLooksLikeThorax(hu, w, h)
  const hyperdenseDetailExtra = thoraxLike
    ? ' На срезах с лёгочным латеральным паттерном маска гиперденсивности ограничена центральной зоной (средостение); пиксели у кортикала рёбер исключены; нижние строки с типичной картиной стола/ложемента не анализируются — это снижает ложные срабатывания на стенке груди и столе и не является сегментацией аорты (в отличие от специализированных DL-систем).'
    : ' Нижняя зона стола/ложемента по эвристике плотности строк исключена из анализа гиперденсивности.'

  // --- 3 Low attenuation lung (эмфиземоподобный)
  if (!likelyContrast && (leftMean < -800 || rightMean < -800)) {
    let cnt = 0
    for (let y = ySkipTop; y < rowEnd; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const lateral = x < w * 0.32 || x > w * 0.68
        if (!lateral) continue
        const i = y * w + x
        const v = hu[i]
        if (v < -880) {
          pickIds[i] = PathologyClass.lowAttenuationLung
          writePathologyHighlightPixel(highlightRgba, i, PathologyClass.lowAttenuationLung)
          cnt += 1
        }
      }
    }
    const frac = cnt / total
    if (frac > 0.004) {
      const conf = clamp(0.35 + frac * 8 + (leftMean < -850 ? 0.12 : 0) + (rightMean < -850 ? 0.12 : 0), 0.35, 0.92)
      const m = META[PathologyClass.lowAttenuationLung]!
      findings.push({
        id: 'low_attenuation_lung',
        classId: PathologyClass.lowAttenuationLung,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: `${m.details} Срез: латеральные средние HU слева/справа ~${leftMean.toFixed(0)} / ${rightMean.toFixed(0)}.`,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  // --- 2 Consolidation / ground-glass-like (периферия)
  if (!likelyContrast) {
    let cnt = 0
    for (let y = ySkipTop; y < rowEnd; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const lateral = x < w * 0.35 || x > w * 0.65
        if (!lateral) continue
        const i = y * w + x
        const v = hu[i]
        if (v >= -520 && v <= -130 && pickIds[i] === PathologyClass.none) {
          pickIds[i] = PathologyClass.consolidation
          writePathologyHighlightPixel(highlightRgba, i, PathologyClass.consolidation)
          cnt += 1
        }
      }
    }
    const frac = cnt / total
    if (frac > 0.006) {
      const conf = clamp(0.32 + frac * 6, 0.32, 0.88)
      const m = META[PathologyClass.consolidation]!
      findings.push({
        id: 'lung_consolidation_pattern',
        classId: PathologyClass.consolidation,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: m.details,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  // --- 1 Hyperdense foci (кровь / гиперденсивный очаг на НКТ — грубо)
  if (!likelyContrast && maxHu < 2100) {
    let cnt = 0
    for (let y = ySkipTop; y < rowEnd; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!pixelInHyperdenseRoi(x, y, w, h, thoraxLike)) continue
        if (localMaxHu(hu, w, h, x, y, 2) >= BONE_NEIGHBORHOOD_MAX_HU) continue
        const i = y * w + x
        const v = hu[i]
        if (v >= 52 && v <= 105) {
          const canPaint =
            pickIds[i] === PathologyClass.none ||
            pickIds[i] === PathologyClass.lowAttenuationLung
          if (canPaint) {
            pickIds[i] = PathologyClass.hyperdenseAcute
            writePathologyHighlightPixel(highlightRgba, i, PathologyClass.hyperdenseAcute)
            cnt += 1
          }
        }
      }
    }
    const frac = cnt / total
    const maxHyperFrac = 0.012
    if (frac > maxHyperFrac) {
      clearPathologyClassFromMask(PathologyClass.hyperdenseAcute, pickIds, highlightRgba, total)
    } else if (frac > 0.00075) {
      const conf = clamp(0.28 + Math.min(frac * 25, 0.55), 0.28, 0.9)
      const m = META[PathologyClass.hyperdenseAcute]!
      findings.push({
        id: 'hyperdense_foci',
        classId: PathologyClass.hyperdenseAcute,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: `${m.details}${hyperdenseDetailExtra}`,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  // --- 1b Гиперденсивные зоны при эвристике контраста (сосуды / усиление паренхимы)
  if (likelyContrast && maxHu < 2100) {
    let cnt = 0
    for (let y = ySkipTop; y < rowEnd; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!pixelInHyperdenseRoi(x, y, w, h, thoraxLike)) continue
        if (localMaxHu(hu, w, h, x, y, 2) >= BONE_NEIGHBORHOOD_MAX_HU) continue
        const i = y * w + x
        const v = hu[i]
        if (v >= 62 && v <= 158) {
          const canPaint =
            pickIds[i] === PathologyClass.none ||
            pickIds[i] === PathologyClass.lowAttenuationLung
          if (canPaint) {
            pickIds[i] = PathologyClass.hyperdenseAcute
            writePathologyHighlightPixel(highlightRgba, i, PathologyClass.hyperdenseAcute)
            cnt += 1
          }
        }
      }
    }
    const frac = cnt / total
    const maxHyperContrastFrac = 0.018
    if (frac > maxHyperContrastFrac) {
      clearPathologyClassFromMask(PathologyClass.hyperdenseAcute, pickIds, highlightRgba, total)
    } else if (frac > 0.00065) {
      const conf = clamp(0.26 + Math.min(frac * 22, 0.52), 0.26, 0.88)
      const m = META[PathologyClass.hyperdenseAcute]!
      findings.push({
        id: 'hyperdense_foci',
        classId: PathologyClass.hyperdenseAcute,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: `${m.details} Эвристика «контраст»: пороги HU для этой маски расширены.${hyperdenseDetailExtra}`,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  // --- 4 Calcification (не вся кость — доля высоких HU в «мягкой» колонке)
  if (!likelyContrast) {
    let hi = 0
    for (let i = 0; i < total; i += 1) {
      if (hu[i] > 185 && hu[i] < 350) hi += 1
    }
    const frac = hi / total
    if (frac > 0.02 && frac < 0.35) {
      for (let y = ySkipTop; y < rowEnd; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = y * w + x
          const v = hu[i]
          if (v > 185 && v < 420 && pickIds[i] === PathologyClass.none) {
            pickIds[i] = PathologyClass.calcification
            writePathologyHighlightPixel(highlightRgba, i, PathologyClass.calcification)
          }
        }
      }
      const conf = clamp(0.3 + frac * 2, 0.3, 0.85)
      const m = META[PathologyClass.calcification]!
      findings.push({
        id: 'calcification_burden',
        classId: PathologyClass.calcification,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: `${m.details} Доля пикселей 185–350 HU ≈ ${(frac * 100).toFixed(1)}%.`,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  // --- 5 Мягкие ткани / «тело» и контраст (общий скрининг, много ложных срабатываний)
  const roiMean = regionMean(
    hu,
    w,
    h,
    Math.floor(w * 0.28),
    Math.floor(w * 0.72),
    ySkipTop,
    rowEnd,
  )
  const bodyLike =
    roiMean > -100 ||
    likelyContrast ||
    (roiMean > -220 && leftMean > -400 && rightMean > -400)
  // На типичной КТ грудной клетки «общий» soft-tissue скрининг даёт шум на стенке и контуре тела.
  if (bodyLike && !thoraxLike) {
    const x0 = Math.floor(w * 0.12)
    const x1 = Math.floor(w * 0.88)
    let cnt = 0
    for (let y = ySkipTop; y < rowEnd; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * w + x
        const v = hu[i]
        const inSoft = likelyContrast ? v >= 42 && v <= 140 : v >= 35 && v <= 120
        if (inSoft && pickIds[i] === PathologyClass.none) {
          pickIds[i] = PathologyClass.softTissueFoci
          writePathologyHighlightPixel(highlightRgba, i, PathologyClass.softTissueFoci)
          cnt += 1
        }
      }
    }
    const frac = cnt / total
    const thr = likelyContrast ? 0.0006 : 0.001
    const maxSoftFrac = 0.018
    if (frac >= maxSoftFrac) {
      clearPathologyClassFromMask(PathologyClass.softTissueFoci, pickIds, highlightRgba, total)
    } else if (frac > thr) {
      const conf = clamp(0.22 + Math.min(frac * 12, 0.45), 0.22, 0.75)
      const m = META[PathologyClass.softTissueFoci]!
      findings.push({
        id: 'soft_tissue_foci_screen',
        classId: PathologyClass.softTissueFoci,
        label: m.label,
        confidence: conf,
        summary: m.summary,
        details: `${m.details} ROI центр ~${roiMean.toFixed(0)} HU; доля выделенных пикселей ≈ ${(frac * 100).toFixed(2)}%.`,
        clinicalNote: m.clinicalNote,
        sliceIndices: [],
      })
    }
  }

  const prePrunePick = new Uint8Array(pickIds)
  prunePathologyMaskToFocalBlobs(pickIds, highlightRgba, w, h)
  addFallbackFocalDisksForClearedClasses(findings, prePrunePick, pickIds, highlightRgba, w, h)
  const findingsVisible = filterFindingsWithRemainingMask(findings, pickIds)
  const blobs = dedupeSpatialPathologyBlobs(extractPathologyBlobs(pickIds, w, h), w, h)
  return {
    width: w,
    height: h,
    pickIds,
    highlightRgba,
    findings: findingsVisible,
    blobs,
  }
}

/**
 * Одна точка на срезе для перехода к находке (центроид компактного островка маски),
 * вместо подсветки всего поля зрения.
 */
export function focalPointForPathologyEmphasis(
  analysis: SlicePathologyAnalysis,
  options?: { preferClassId?: PathologyClassId },
): { col: number; row: number } | null {
  const { pickIds, width: w, height: h, blobs } = analysis
  const prefer = options?.preferClassId

  let hyperDensePx = 0
  for (let i = 0; i < pickIds.length; i += 1) {
    if (pickIds[i] === PathologyClass.hyperdenseAcute) hyperDensePx += 1
  }
  const hyperFrac = pickIds.length > 0 ? hyperDensePx / pickIds.length : 0

  const useRedForClass = (c: PathologyClassId) => {
    if (c === PathologyClass.none) return false
    if (c === PathologyClass.softTissueFoci) return false
    if (c === PathologyClass.hyperdenseAcute && hyperFrac > 0.011) return false
    return true
  }

  const candidBlobs = blobs.filter((b) => useRedForClass(b.classId))
  if (prefer && candidBlobs.some((b) => b.classId === prefer)) {
    const matched = candidBlobs.filter((b) => b.classId === prefer)
    matched.sort((a, b) => b.area - a.area)
    const b = matched[0]!
    return { col: Math.round(b.cx), row: Math.round(b.cy) }
  }
  if (candidBlobs.length > 0) {
    const sorted = [...candidBlobs].sort((a, b) => b.area - a.area)
    const b = sorted[0]!
    return { col: Math.round(b.cx), row: Math.round(b.cy) }
  }

  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = pickIds[y * w + x] as PathologyClassId
      if (!useRedForClass(c)) continue
      sx += x
      sy += y
      n += 1
    }
  }
  if (n > 0) {
    return { col: Math.round(sx / n), row: Math.round(sy / n) }
  }

  sx = 0
  sy = 0
  n = 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = pickIds[y * w + x] as PathologyClassId
      if (c === PathologyClass.none) continue
      sx += x
      sy += y
      n += 1
    }
  }
  if (n > 0) {
    return { col: Math.round(sx / n), row: Math.round(sy / n) }
  }

  return null
}

const LUNG_BUCKET_KEYS: LungHuBucketId[] = [
  'emphysema_like',
  'well_aerated',
  'ground_glass_like',
  'interstitial_like',
  'mixed_density',
  'consolidation_like',
]

function emptyLungBucketAgg(): Record<LungHuBucketId, number> {
  return {
    emphysema_like: 0,
    well_aerated: 0,
    ground_glass_like: 0,
    interstitial_like: 0,
    mixed_density: 0,
    consolidation_like: 0,
  }
}

function sliceCalcificationFrac(hu: Float32Array, w: number, h: number): number {
  const t = w * h
  if (t <= 0) return 0
  let n = 0
  for (let i = 0; i < hu.length; i += 1) {
    const v = hu[i]
    if (v > 188 && v < 375) n += 1
  }
  return n / t
}

function sliceAbdomenSoftFrac(hu: Float32Array, w: number, h: number): number {
  const x0 = Math.floor(w * 0.18)
  const x1 = Math.floor(w * 0.82)
  const y0 = Math.floor(h * 0.07)
  const y1 = Math.floor(h * 0.93)
  let n = 0
  let d = 0
  for (let y = y0; y < y1; y += 1) {
    const row = y * w
    for (let x = x0; x < x1; x += 1) {
      const v = hu[row + x]
      d += 1
      if (v >= 38 && v <= 118) n += 1
    }
  }
  return d > 0 ? n / d : 0
}

function sliceHyperdenseCentralFrac(hu: Float32Array, w: number, h: number, thoraxLike: boolean): number {
  if (!thoraxLike) return 0
  const ySkipTop = Math.floor(h * 0.06)
  const ySkipBot = Math.floor(h * 0.06)
  const rowEnd = pathologyRowExclusiveEnd(h, ySkipTop, ySkipBot, hu, w)
  let num = 0
  let den = 0
  for (let y = ySkipTop; y < rowEnd; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!pixelInHyperdenseRoi(x, y, w, h, true)) continue
      if (localMaxHu(hu, w, h, x, y, 2) >= BONE_NEIGHBORHOOD_MAX_HU) continue
      den += 1
      const v = hu[y * w + x]
      if (v >= 52 && v <= 100) num += 1
    }
  }
  return den > 0 ? num / den : 0
}

type VolumeSliceStatRow = {
  z: number
  thoraxLike: boolean
  lungVoxels: number
  buckets: Record<LungHuBucketId, number>
  hyperCentralFrac: number
  calcFrac: number
  abdomenSoftFrac: number
  interestScore: number
  radiomicsMeanLocalStd: number
  radiomicsMaxGradient: number
  radiomicsFocalHigh: number
  radiomicsFocalLow: number
}

function collectVolumeSliceStats(frames: CtSliceInput[]): VolumeSliceStatRow[] {
  const out: VolumeSliceStatRow[] = []
  for (let z = 0; z < frames.length; z += 1) {
    const fr = frames[z]
    const { columns: w, rows: h, huPixels: hu } = fr
    if (w < 16 || h < 16 || hu.length !== w * h) continue
    const lung = analyzeLungSliceQuantification(hu, w, h)
    const thoraxLike = lung.thoraxLike
    const hyperCentralFrac = sliceHyperdenseCentralFrac(hu, w, h, thoraxLike)
    const calcFrac = sliceCalcificationFrac(hu, w, h)
    const abdomenSoftFrac = thoraxLike ? 0 : sliceAbdomenSoftFrac(hu, w, h)

    const rad = thoraxLike && lung.lungVoxels >= 120 ? analyzeSliceRadiomicsLite(hu, w, h) : null
    const radiomicsMeanLocalStd = rad?.meanLocalStd3x3 ?? 0
    const radiomicsMaxGradient = rad?.maxGradient4n ?? 0
    const radiomicsFocalHigh = rad?.focalHighClusters ?? 0
    const radiomicsFocalLow = rad?.focalLowClusters ?? 0

    let interestScore = 0
    if (thoraxLike && lung.lungVoxels > 80) {
      const lv = lung.lungVoxels
      interestScore =
        (lung.buckets.consolidation_like / lv) * 4 +
        (lung.buckets.ground_glass_like / lv) * 2.8 +
        (lung.buckets.interstitial_like / lv) * 2 +
        (lung.buckets.mixed_density / lv) * 2.2 +
        (lung.buckets.emphysema_like / lv) * 1.2 +
        hyperCentralFrac * 420 +
        radiomicsMeanLocalStd * 0.045 +
        radiomicsMaxGradient * 0.0012 +
        radiomicsFocalHigh * 0.35 +
        radiomicsFocalLow * 0.22
    } else {
      interestScore = abdomenSoftFrac * 1.5 + calcFrac * 2
    }

    out.push({
      z,
      thoraxLike,
      lungVoxels: lung.lungVoxels,
      buckets: { ...lung.buckets },
      hyperCentralFrac,
      calcFrac,
      abdomenSoftFrac,
      interestScore,
      radiomicsMeanLocalStd,
      radiomicsMaxGradient,
      radiomicsFocalHigh,
      radiomicsFocalLow,
    })
  }
  return out
}

function volumeAggregates(stats: VolumeSliceStatRow[]) {
  const acc = emptyLungBucketAgg()
  let totalLung = 0
  let thoraxCount = 0
  let hyperSum = 0
  let calcSum = 0
  let abdSum = 0
  let abdCount = 0
  let radStdSum = 0
  let radGradSum = 0
  let radSlicesWithTexture = 0
  let totalFocalHigh = 0
  let totalFocalLow = 0
  for (const s of stats) {
    if (s.thoraxLike) {
      thoraxCount += 1
      totalLung += s.lungVoxels
      hyperSum += s.hyperCentralFrac
      for (const k of LUNG_BUCKET_KEYS) {
        acc[k] += s.buckets[k]
      }
      if (s.lungVoxels >= 120 && s.radiomicsMeanLocalStd > 0) {
        radStdSum += s.radiomicsMeanLocalStd
        radGradSum += s.radiomicsMaxGradient
        radSlicesWithTexture += 1
      }
      totalFocalHigh += s.radiomicsFocalHigh
      totalFocalLow += s.radiomicsFocalLow
    }
    calcSum += s.calcFrac
    if (!s.thoraxLike) {
      abdSum += s.abdomenSoftFrac
      abdCount += 1
    }
  }
  const nFrames = stats.length
  return {
    acc,
    totalLung,
    thoraxCount,
    meanHyper: thoraxCount > 0 ? hyperSum / thoraxCount : 0,
    meanCalc: nFrames > 0 ? calcSum / nFrames : 0,
    meanAbdSoft: abdCount > 0 ? abdSum / abdCount : 0,
    abdCount,
    meanRadiomicsLocalStd: radSlicesWithTexture > 0 ? radStdSum / radSlicesWithTexture : 0,
    meanRadiomicsMaxGradient: radSlicesWithTexture > 0 ? radGradSum / radSlicesWithTexture : 0,
    radiomicsSliceCount: radSlicesWithTexture,
    totalFocalHigh,
    totalFocalLow,
  }
}

function slicesWhereBucketRatio(
  stats: VolumeSliceStatRow[],
  key: LungHuBucketId,
  minRatio: number,
): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (!s.thoraxLike || s.lungVoxels < 120) continue
    if (s.buckets[key] / s.lungVoxels >= minRatio) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

function slicesWhereHyper(stats: VolumeSliceStatRow[], minF: number): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (s.thoraxLike && s.hyperCentralFrac >= minF) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

function slicesWhereCalc(stats: VolumeSliceStatRow[], minF: number): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (s.calcFrac >= minF) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

function slicesWhereAbdomen(stats: VolumeSliceStatRow[], minF: number): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (!s.thoraxLike && s.abdomenSoftFrac >= minF) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

function slicesWhereRadiomicsHeterogeneity(stats: VolumeSliceStatRow[], minStd: number): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (s.thoraxLike && s.lungVoxels >= 120 && s.radiomicsMeanLocalStd >= minStd) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

function slicesWhereRadiomicsFocal(stats: VolumeSliceStatRow[]): number[] {
  const out: number[] = []
  for (const s of stats) {
    if (s.thoraxLike && s.radiomicsFocalHigh + s.radiomicsFocalLow >= 2) out.push(s.z)
  }
  return out.sort((a, b) => a - b)
}

/** Находки по текстуре HU и островкам отклонения от медианы (без обучения). */
function buildRadiomicsVolumeFindings(
  stats: VolumeSliceStatRow[],
  agg: ReturnType<typeof volumeAggregates>,
): PathologyFinding[] {
  const out: PathologyFinding[] = []
  const {
    thoraxCount,
    meanRadiomicsLocalStd,
    radiomicsSliceCount,
    totalFocalHigh,
    totalFocalLow,
    totalLung,
  } = agg

  const push = (
    id: string,
    classId: PathologyClassId,
    confidence: number,
    summary: string,
    details: string,
    sliceIndices: number[],
  ) => {
    const m = META[classId]
    if (!m) return
    out.push({
      id,
      classId,
      label: m.label,
      confidence,
      summary,
      details,
      clinicalNote: m.clinicalNote,
      sliceIndices,
    })
  }

  if (
    totalLung > 800 &&
    thoraxCount >= 4 &&
    radiomicsSliceCount >= 3 &&
    meanRadiomicsLocalStd >= 36
  ) {
    const conf = clamp(0.26 + (meanRadiomicsLocalStd - 34) * 0.028, 0.26, 0.82)
    push(
      'vol_radiomics_heterogeneity',
      PathologyClass.consolidation,
      conf,
      `Повышенная локальная неоднородность HU в лёгочной маске (среднее СКО 3×3 по срезам ≈ ${meanRadiomicsLocalStd.toFixed(1)} HU).`,
      `${META[PathologyClass.consolidation]!.details} Метрика отражает «неровность» интенсивности внутри маски, а не гистологию; сосуды, движение и реконструкция дают ложные срабатывания.`,
      slicesWhereRadiomicsHeterogeneity(stats, Math.max(38, meanRadiomicsLocalStd * 0.92)),
    )
  }

  const focalSum = totalFocalHigh + totalFocalLow
  if (totalLung > 800 && thoraxCount >= 3 && focalSum >= 5) {
    const conf = clamp(0.24 + focalSum * 0.055, 0.24, 0.8)
    push(
      'vol_radiomics_focal_deviation',
      PathologyClass.consolidation,
      conf,
      `Многочисленные локальные участки с HU, заметно отличающимися от медианы паренхимы на срезе (островков: «плотнее» ≈ ${totalFocalHigh}, «разреженнее» ≈ ${totalFocalLow} по серии).`,
      'Эвристика по связным компонентам в маске; дифф. диагноз широкий (очаг, сосуд, частичный объём, артефакт). Без сегментации органов нельзя надёжно сказать «не соответствует органу».',
      slicesWhereRadiomicsFocal(stats),
    )
  }

  return out
}

function buildVolumeGroupedFindings(
  stats: VolumeSliceStatRow[],
  agg: ReturnType<typeof volumeAggregates>,
): PathologyFinding[] {
  const findings: PathologyFinding[] = []
  const { acc, totalLung, thoraxCount, meanHyper, meanCalc, meanAbdSoft, abdCount } = agg

  const p = (k: LungHuBucketId) => (totalLung > 0 ? acc[k] / totalLung : 0)

  const push = (
    id: string,
    classId: PathologyClassId,
    confidence: number,
    summary: string,
    details: string,
    sliceIndices: number[],
  ) => {
    const m = META[classId]
    if (!m) return
    findings.push({
      id,
      classId,
      label: m.label,
      confidence,
      summary,
      details,
      clinicalNote: m.clinicalNote,
      sliceIndices,
    })
  }

  if (totalLung > 600 && thoraxCount >= 3) {
    const pE = p('emphysema_like')
    if (pE >= 0.015) {
      const conf = clamp(0.27 + pE * 4.2, 0.27, 0.9)
      push(
        'vol_emphysema_like',
        PathologyClass.lowAttenuationLung,
        conf,
        `Доля очень низких HU в лёгочной маске по серии ≈ ${(pE * 100).toFixed(1)}% (объёмный подсчёт).`,
        `${META[PathologyClass.lowAttenuationLung]!.details} Агрегат по ${thoraxCount} срезам грудной клетки.`,
        slicesWhereBucketRatio(stats, 'emphysema_like', 0.014),
      )
    }

    const pG = p('ground_glass_like')
    if (pG >= 0.028) {
      const conf = clamp(0.28 + pG * 5, 0.28, 0.88)
      push(
        'vol_ground_glass_like',
        PathologyClass.consolidation,
        conf,
        `Матовое стекло (HU-прокси) ≈ ${(pG * 100).toFixed(1)}% паренхимы в маске по серии.`,
        `${META[PathologyClass.consolidation]!.details} Оценка по объёму, не нейросеть.`,
        slicesWhereBucketRatio(stats, 'ground_glass_like', 0.022),
      )
    }

    const pI = p('interstitial_like')
    if (pI >= 0.038) {
      const conf = clamp(0.26 + pI * 4.2, 0.26, 0.85)
      push(
        'vol_interstitial_like',
        PathologyClass.consolidation,
        conf,
        `Интерстициальный HU-паттерн ≈ ${(pI * 100).toFixed(1)}% паренхимы по серии.`,
        `${META[PathologyClass.consolidation]!.details} Не специфичность UIP/IPF.`,
        slicesWhereBucketRatio(stats, 'interstitial_like', 0.028),
      )
    }

    const pM = p('mixed_density')
    if (pM >= 0.032) {
      const conf = clamp(0.25 + pM * 4.5, 0.25, 0.84)
      push(
        'vol_mixed_density',
        PathologyClass.consolidation,
        conf,
        `Смешанная плотность ≈ ${(pM * 100).toFixed(1)}% по серии.`,
        META[PathologyClass.consolidation]!.details,
        slicesWhereBucketRatio(stats, 'mixed_density', 0.024),
      )
    }

    const pC = p('consolidation_like')
    if (pC >= 0.02) {
      const conf = clamp(0.3 + pC * 5.5, 0.3, 0.91)
      push(
        'vol_consolidation_like',
        PathologyClass.consolidation,
        conf,
        `Консолидация / плотный инфильтрат ≈ ${(pC * 100).toFixed(1)}% паренхимы по серии.`,
        META[PathologyClass.consolidation]!.details,
        slicesWhereBucketRatio(stats, 'consolidation_like', 0.018),
      )
    }
  }

  if (meanCalc >= 0.014) {
    const conf = clamp(0.28 + meanCalc * 8, 0.28, 0.86)
    push(
      'vol_calcification_burden',
      PathologyClass.calcification,
      conf,
      `Средняя доля пикселей 188–375 HU по срезам ≈ ${(meanCalc * 100).toFixed(1)}%.`,
      META[PathologyClass.calcification]!.details,
      slicesWhereCalc(stats, 0.02),
    )
  }

  if (abdCount >= 3 && meanAbdSoft >= 0.055) {
    const conf = clamp(0.24 + (meanAbdSoft - 0.05) * 8, 0.24, 0.76)
    push(
      'vol_abdomen_soft_tissue',
      PathologyClass.softTissueFoci,
      conf,
      `На внесредостных срезах в центральной ROI повышена доля мягких HU (${(meanAbdSoft * 100).toFixed(1)}% в среднем).`,
      META[PathologyClass.softTissueFoci]!.details,
      slicesWhereAbdomen(stats, 0.06),
    )
  }

  const pCons = p('consolidation_like')
  const pGgo = p('ground_glass_like')
  const pInt = p('interstitial_like')
  const hyperAllowed =
    thoraxCount >= 4 &&
    meanHyper >= 0.000035 &&
    meanHyper <= 0.00038 &&
    pCons < 0.065 &&
    pGgo < 0.1 &&
    pInt < 0.11

  if (hyperAllowed) {
    const conf = clamp(0.34 + meanHyper * 920, 0.34, 0.79)
    push(
      'vol_hyperdense_central_suspect',
      PathologyClass.hyperdenseAcute,
      conf,
      `Средняя доля 52–100 HU в центральной зоне груди ≈ ${(meanHyper * 100).toFixed(3)}% при умеренном паренхиматозном паттерне.`,
      `${META[PathologyClass.hyperdenseAcute]!.details} Порог v2 снижает ложные срабатывания «у всех подряд».`,
      slicesWhereHyper(stats, 0.00005),
    )
  }

  findings.sort((a, b) => b.confidence - a.confidence)
  return findings
}

/**
 * Сканирование всей серии: список находок из **объёмных** долей HU (v2), чтобы вывод зависел от данных исследования.
 * Оверлей на отдельном срезе по-прежнему строится через analyzeSlicePathology (локальные правила).
 */
export function runVolumePathologyScan(frames: CtSliceInput[]): VolumePathologyResult | null {
  if (frames.length === 0) return null

  let firstValidZ = -1
  for (let z = 0; z < frames.length; z += 1) {
    const fr = frames[z]
    if (fr.columns >= 16 && fr.rows >= 16 && fr.huPixels.length === fr.columns * fr.rows) {
      firstValidZ = z
      break
    }
  }
  if (firstValidZ < 0) return null

  const stats = collectVolumeSliceStats(frames)
  const agg = volumeAggregates(stats)
  let findings = buildVolumeGroupedFindings(stats, agg)
  findings = findings.concat(buildRadiomicsVolumeFindings(stats, agg))
  findings.sort((a, b) => b.confidence - a.confidence)
  findings = findings.slice(0, 8)

  let bestZ = firstValidZ
  let bestInterest = -1
  for (const s of stats) {
    if (s.interestScore > bestInterest) {
      bestInterest = s.interestScore
      bestZ = s.z
    }
  }

  findings = findings.map((f) => ({
    ...f,
    sliceIndices: f.sliceIndices.length > 0 ? f.sliceIndices : [bestZ],
  }))

  const phaseFrame = frames[bestZ]
  const ph = phaseFrame.rows
  const pw = phaseFrame.columns
  const yst = Math.floor(ph * 0.06)
  const ysb = Math.floor(ph * 0.06)
  const rowEndPhase = pathologyRowExclusiveEnd(ph, yst, ysb, phaseFrame.huPixels, pw)
  const { likelyContrast, centerMean } = estimateContrastPhase(
    phaseFrame.huPixels,
    pw,
    ph,
    rowEndPhase,
  )

  const phaseNote = likelyContrast
    ? `Серия: по центру среза похоже на контраст (среднее ~${centerMean.toFixed(0)} HU) — гиперденсивные зоны могут включать сосуды с контрастом.`
    : `Серия: центральная ROI ближе к нативной картине (среднее ~${centerMean.toFixed(0)} HU).`

  const rationale =
    findings.length === 0
      ? 'По объёмным порогам v2 устойчивые паттерны не выделены (или мало грудных срезов в маске). Окно W/L на просмотр не влияет на эти подсчёты — они идут по HU кадра.'
      : `КТ-скрининг v2 + лёгкая радиомика: до ${findings.length} категорий по долям HU, текстуре (локальное СКО) и островкам отклонения от медианы по ${frames.length} срезам. Фокус-срез ${bestZ + 1} — максимальный «интерес». Без сегментации органов и без обученной модели это остаётся эвристикой.`

  const engine: PathologyEngineInfo = {
    id: 'heuristic_hu_v2_volume',
    labelRu: 'Объёмный HU (v2) + лёгкая радиомика, без нейросети',
    regulatoryNoteRu:
      'Не зарегистрированное изделие. Не заменяет врача. Список находок — объёмные доли HU, плюс лёгкие текстурные метрики в той же маске. При настроенном VITE_PATHOLOGY_API_URL клиент после сканирования вызывает POST /v1/ct-screen и может заменить или дополнить этот список ответом сервера.',
  }

  return {
    focusSliceIndex: bestZ,
    findings,
    phaseNote,
    rationale,
    engine,
  }
}

/**
 * Тело POST /v1/ct-screen: сводка по серии без передачи сырого HU (экономия трафика).
 * Сервер может донатчить nnU-Net / MONAI на своём хранилище DICOM или на этом JSON.
 */
export function buildCtScreenPayload(
  frames: CtSliceInput[],
  meta: {
    seriesInstanceUid: string | null
    zSpacingMm: number
    pixelSpacingRowMm?: number | null
    pixelSpacingColMm?: number | null
    requestAorticSyndromeScreening?: boolean
  },
): CtScreenPayloadV1 | null {
  if (frames.length === 0) return null
  const first = frames.find(
    (fr) => fr.columns >= 16 && fr.rows >= 16 && fr.huPixels.length === fr.columns * fr.rows,
  )
  if (!first) return null

  const stats = collectVolumeSliceStats(frames)
  const agg = volumeAggregates(stats)
  const perSlice = stats.map((s) => ({
    zIndex: s.z,
    thoraxLike: s.thoraxLike,
    lungVoxels: s.lungVoxels,
    lungBuckets: { ...s.buckets },
    hyperCentralFrac: s.hyperCentralFrac,
    calcFrac: s.calcFrac,
    abdomenSoftFrac: s.abdomenSoftFrac,
    interestScore: s.interestScore,
    radiomicsMeanLocalStd:
      s.thoraxLike && s.lungVoxels >= 120 && s.radiomicsMeanLocalStd > 0
        ? s.radiomicsMeanLocalStd
        : null,
    radiomicsMaxGradient:
      s.thoraxLike && s.lungVoxels >= 120 && s.radiomicsMaxGradient > 0
        ? s.radiomicsMaxGradient
        : null,
    radiomicsFocalHighClusters: s.thoraxLike ? s.radiomicsFocalHigh : null,
    radiomicsFocalLowClusters: s.thoraxLike ? s.radiomicsFocalLow : null,
  }))

  return {
    schemaVersion: CT_SCREEN_SCHEMA_VERSION,
    payloadType: 'volume_summary_v1',
    seriesInstanceUid: meta.seriesInstanceUid,
    shape: { slices: frames.length, rows: first.rows, cols: first.columns },
    spacingMm: {
      z: Number.isFinite(meta.zSpacingMm) ? meta.zSpacingMm : null,
      row: meta.pixelSpacingRowMm ?? null,
      col: meta.pixelSpacingColMm ?? null,
    },
    perSlice,
    aggregate: {
      totalLungVoxels: agg.totalLung,
      thoraxSliceCount: agg.thoraxCount,
      meanHyperCentralFrac: agg.meanHyper,
      meanCalcFrac: agg.meanCalc,
      meanAbdomenSoftFrac: agg.meanAbdSoft,
      abdomenSliceCount: agg.abdCount,
      lungBucketTotals: { ...agg.acc },
      meanRadiomicsLocalStd: agg.radiomicsSliceCount > 0 ? agg.meanRadiomicsLocalStd : null,
      meanRadiomicsMaxGradient: agg.radiomicsSliceCount > 0 ? agg.meanRadiomicsMaxGradient : null,
      totalFocalHighClusters: agg.thoraxCount > 0 ? agg.totalFocalHigh : null,
      totalFocalLowClusters: agg.thoraxCount > 0 ? agg.totalFocalLow : null,
    },
    ...(meta.requestAorticSyndromeScreening ? { requestAorticSyndromeScreening: true } : {}),
  }
}

export function getFindingMetaForClass(classId: PathologyClassId) {
  return META[classId]
}
