/**
 * Количественная оценка долей HU-паттернов в зоне, аппроксимирующей паренхиму лёгких на аксиальных срезах грудной клетки.
 *
 * ВАЖНО: это не гистология и не заключение патолога. Проценты — доля вокселей в грубых диапазонах HU внутри эвристической
 * «лёгочной» маски; они зависят от реконструкции, ядра, контраста, фазы и не заменяют обученную сегментацию (TotalSegmentator,
 * nnU-Net и т.д.) и клиническую валидацию.
 */

export type HuFrame = {
  columns: number
  rows: number
  huPixels: Float32Array
}

/** Внутренние корзины гистограммы (взаимоисключающие по HU). */
export type LungHuBucketId =
  | 'emphysema_like'
  | 'well_aerated'
  | 'ground_glass_like'
  | 'interstitial_like'
  | 'mixed_density'
  | 'consolidation_like'

export type LungQuantCategoryRow = {
  id: LungHuBucketId | 'mediastinal_soft_proxy'
  labelRu: string
  percentOfLungParenchyma: number
  clinicalMeaningRu: string
}

export type LungNotAssessableRow = {
  id: string
  labelRu: string
  reasonRu: string
}

export type LungVolumeQuantReport = {
  /** Локально: lung_hu_histogram_v1; с сервера — произвольный идентификатор модели */
  engineId: string
  slicesTotal: number
  slicesIncluded: number
  slicesSkipped: number
  totalLungVoxels: number
  /** Доли корзин, сумма ≈ 100% по включённым лёгочным вокселям */
  categories: LungQuantCategoryRow[]
  /** То, что по одной аксиальной КТ в лёгочном окне не определяется честно */
  notAssessable: LungNotAssessableRow[]
  /** Доля вокселей 35–95 HU в расширенной зоне средостения/корней (не число и не размер узлов) */
  mediastinalSoftTissueProxyPercent: number | null
  summaryLineRu: string
  disclaimerRu: string
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

/**
 * Средние HU в латеральных полосах (для подписей в скрининге).
 * Полосы с отступом от края — чтобы чёрные поля DICOM не считались «лёгочным воздухом».
 */
export function thoraxLateralMeansForDisplay(hu: Float32Array, w: number, h: number) {
  const y0 = Math.floor(h * 0.06)
  const y1 = h - Math.floor(h * 0.06)
  const xl0 = Math.floor(w * 0.08)
  const xl1 = Math.floor(w * 0.28)
  const xr0 = Math.floor(w * 0.72)
  const xr1 = Math.floor(w * 0.92)
  const leftMean = regionMean(hu, w, h, xl0, xl1, y0, y1)
  const rightMean = regionMean(hu, w, h, xr0, xr1, y0, y1)
  return { leftMean, rightMean, y0, y1, xl1, xr0 }
}

/**
 * Грубая проверка «аксиал грудной клетки»: воздух по бокам + центр не «пустой стол/одна кость».
 * Снижает ложные «лёгочные» метрики на WB внизу тела и на срезах только со столом.
 */
export function sliceLooksLikeThorax(hu: Float32Array, w: number, h: number): boolean {
  const { leftMean, rightMean, y0, y1, xl1, xr0 } = thoraxLateralMeansForDisplay(hu, w, h)
  if (leftMean >= -680 || rightMean >= -680) return false

  const cx0 = Math.floor(w * 0.35)
  const cx1 = Math.floor(w * 0.65)
  const centerMean = regionMean(hu, w, h, cx0, cx1, y0, y1)
  if (centerMean > 380 || centerMean < -970) return false

  let lungish = 0
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    const row = y * w
    for (let x = 0; x < w; x += 1) {
      const lateral = x < xl1 || x >= xr0
      if (!lateral) continue
      n += 1
      const v = hu[row + x]
      if (v > -950 && v < -220) lungish += 1
    }
  }
  if (n === 0) return false
  return lungish / n > 0.1
}

function inMediastinumEllipse(x: number, y: number, w: number, h: number): boolean {
  const cx = w * 0.5
  const cy = h * 0.46
  const rx = Math.max(w * 0.17, 8)
  const ry = Math.max(h * 0.22, 8)
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

/** ROI для «прокси» мягких тканей средостения/корней (не сегментация узлов). */
function inMediastinumWideEllipse(x: number, y: number, w: number, h: number): boolean {
  const cx = w * 0.5
  const cy = h * 0.44
  const rx = Math.max(w * 0.26, 10)
  const ry = Math.max(h * 0.3, 10)
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

/** Эвристическая маска «паренхима лёгких» на аксиале (не сегментация nnU-Net). */
export function isPixelInLungParenchymaMask(x: number, y: number, hu: number, w: number, h: number): boolean {
  const yMargin = h * 0.035
  if (y < yMargin || y >= h - yMargin) return false
  if (hu <= -1024 || hu > 100) return false
  if (hu >= 320) return false
  if (inMediastinumEllipse(x, y, w, h) && hu > -125) return false
  return true
}

function classifyLungHu(hu: number): LungHuBucketId | null {
  if (hu < -920) return 'emphysema_like'
  if (hu < -780) return 'well_aerated'
  if (hu < -450) return 'ground_glass_like'
  if (hu < -320) return 'interstitial_like'
  if (hu < -90) return 'mixed_density'
  if (hu <= 100) return 'consolidation_like'
  return null
}

const BUCKET_META: Record<
  LungHuBucketId,
  { labelRu: string; clinicalMeaningRu: string }
> = {
  emphysema_like: {
    labelRu: 'Очень низкая плотность (эмфиземоподобно)',
    clinicalMeaningRu: 'Воздушность / разрежение паренхимы по HU; дифф. диагноз: эмфизема, бульлы, артефакт, низкая доза.',
  },
  well_aerated: {
    labelRu: 'Нормальная аэрация',
    clinicalMeaningRu: 'Типичный «воздушный» лёгочный паренхима по HU на КТ.',
  },
  ground_glass_like: {
    labelRu: 'Матовое стекло (HU-прокси)',
    clinicalMeaningRu: 'Повышение плотности относительно воздуха без полной консолидации; пересекается с отёком, кровью, инфекцией, ранним фиброзом.',
  },
  interstitial_like: {
    labelRu: 'Интерстициальный HU-паттерн',
    clinicalMeaningRu: 'Средние HU в паренхиме; не равно «фиброз UIP» — для этого нужны HRCT-паттерн и/или модель.',
  },
  mixed_density: {
    labelRu: 'Смешанная плотность',
    clinicalMeaningRu: 'Переходная зона между интерстицием и консолидацией.',
  },
  consolidation_like: {
    labelRu: 'Консолидация / плотный инфильтрат',
    clinicalMeaningRu: 'Пневмония, кровь, коллапс/ателектаз (по одному срезу не различаются); тромб в сосуде здесь не ищется.',
  },
}

function emptyBuckets(): Record<LungHuBucketId, number> {
  return {
    emphysema_like: 0,
    well_aerated: 0,
    ground_glass_like: 0,
    interstitial_like: 0,
    mixed_density: 0,
    consolidation_like: 0,
  }
}

export function analyzeLungSliceQuantification(hu: Float32Array, w: number, h: number) {
  if (!sliceLooksLikeThorax(hu, w, h)) {
    return { thoraxLike: false as const, buckets: emptyBuckets(), lungVoxels: 0, mediastinumSoft: 0, mediastinumRoi: 0 }
  }
  const buckets = emptyBuckets()
  let lungVoxels = 0
  let mediastinumSoft = 0
  let mediastinumRoi = 0
  const y0 = Math.floor(h * 0.035)
  const y1 = h - Math.floor(h * 0.035)
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const v = hu[i]
      if (inMediastinumWideEllipse(x, y, w, h)) {
        mediastinumRoi += 1
        if (v >= 35 && v <= 95) mediastinumSoft += 1
      }
      if (!isPixelInLungParenchymaMask(x, y, v, w, h)) continue
      lungVoxels += 1
      const b = classifyLungHu(v)
      if (b) buckets[b] += 1
    }
  }
  const minLung = Math.max(1200, Math.floor(w * h * 0.012))
  if (lungVoxels < minLung) {
    return { thoraxLike: false as const, buckets: emptyBuckets(), lungVoxels: 0, mediastinumSoft: 0, mediastinumRoi: 0 }
  }
  return { thoraxLike: true as const, buckets, lungVoxels, mediastinumSoft, mediastinumRoi }
}

/**
 * Агрегирует метрики по серии. Учитывает только срезы с признаками грудной клетки.
 */
export function runLungVolumeQuantification(frames: HuFrame[]): LungVolumeQuantReport | null {
  if (frames.length === 0) return null

  const acc = emptyBuckets()
  let totalLung = 0
  let included = 0
  let medSoft = 0
  let medRoi = 0

  for (const fr of frames) {
    const { columns: w, rows: h, huPixels: hu } = fr
    if (w < 16 || h < 16 || hu.length !== w * h) continue
    const slice = analyzeLungSliceQuantification(hu, w, h)
    if (!slice.thoraxLike) continue
    included += 1
    totalLung += slice.lungVoxels
    medSoft += slice.mediastinumSoft
    medRoi += slice.mediastinumRoi
    for (const k of Object.keys(acc) as LungHuBucketId[]) {
      acc[k] += slice.buckets[k]
    }
  }

  const skipped = frames.length - included

  const notAssessable: LungNotAssessableRow[] = [
    {
      id: 'pe',
      labelRu: 'Тромбы / ТЭЛА',
      reasonRu:
        'Требуется КТ-ангиография лёгочных артерий с контрастом и сегментация сосудистого дерева; по лёгочному окну и HU не определяется.',
    },
    {
      id: 'ph',
      labelRu: 'Лёгочная гипертензия',
      reasonRu:
        'Оценивается по калибру главной лёгочной артерии, сердцу, клинике и другим исследованиям; не выводится из гистограммы паренхимы.',
    },
    {
      id: 'fibrosis_definite',
      labelRu: 'Подтверждённый фиброз как диагноз патолога',
      reasonRu: 'Только биопсия/морфология; КТ показывает радиологический паттерн, а не «истину патологанатома».',
    },
    {
      id: 'nodes_count',
      labelRu: 'Число и размеры лимфоузлов',
      reasonRu:
        'Нужна сегментация узлов (модель) или ручная разметка; ниже — лишь грубая доля мягкотканевых HU в зоне средостения.',
    },
  ]

  if (included === 0 || totalLung < 500) {
    return {
      engineId: 'lung_hu_histogram_v1',
      slicesTotal: frames.length,
      slicesIncluded: included,
      slicesSkipped: skipped,
      totalLungVoxels: totalLung,
      categories: [],
      notAssessable,
      mediastinalSoftTissueProxyPercent: null,
      summaryLineRu:
        included === 0
          ? 'В серии не найдено срезов с типичным латеральным «воздухом» лёгких — количественная оценка паренхимы не применялась (вероятно, не грудная аксиальная серия).'
          : 'Слишком мало вокселей в лёгочной маске — проверьте серию, ориентацию и поле обзора.',
      disclaimerRu:
        'Проценты ниже (если появятся) относятся к HU-корзинам в эвристической маске, не к «поражению» в патолого-анатомическом смысле.',
    }
  }

  const categories: LungQuantCategoryRow[] = (Object.keys(acc) as LungHuBucketId[]).map((id) => ({
    id,
    labelRu: BUCKET_META[id].labelRu,
    percentOfLungParenchyma: (acc[id] / totalLung) * 100,
    clinicalMeaningRu: BUCKET_META[id].clinicalMeaningRu,
  }))

  categories.sort((a, b) => b.percentOfLungParenchyma - a.percentOfLungParenchyma)

  const mediastinalSoftTissueProxyPercent =
    medRoi > 0 ? (medSoft / medRoi) * 100 : null

  const dominant = categories[0]
  const summaryLineRu = `Проанализировано срезов грудной клетки: ${included} из ${frames.length}. Доминирующий HU-паттерн: «${dominant.labelRu}» ~${dominant.percentOfLungParenchyma.toFixed(1)}% паренхимы в маске.`

  return {
    engineId: 'lung_hu_histogram_v1',
    slicesTotal: frames.length,
    slicesIncluded: included,
    slicesSkipped: skipped,
    totalLungVoxels: totalLung,
    categories,
    notAssessable,
    mediastinalSoftTissueProxyPercent,
    summaryLineRu,
    disclaimerRu:
      'Это инженерная гистограмма по HU в браузере, не валидированное медицинское изделие. Для стабильных процентов «поражения» по клиническим сущностям подключайте обученную модель сегментации лёгких и заболеваний (серверный инференс).',
  }
}
