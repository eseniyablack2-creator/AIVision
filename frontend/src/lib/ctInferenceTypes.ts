/**
 * JSON-контракт POST /v1/ct-screen между фронтендом и Python-инференсом.
 * Версии согласованы с inference/app/schemas.py
 */

export const CT_SCREEN_SCHEMA_VERSION = '1.0' as const

/** Клиент шлёт сводку по серии (без сырого HU), чтобы не гонять гигабайты в браузере. */
export type CtScreenPayloadV1 = {
  schemaVersion: typeof CT_SCREEN_SCHEMA_VERSION
  payloadType: 'volume_summary_v1'
  seriesInstanceUid: string | null
  shape: {
    slices: number
    rows: number
    cols: number
  }
  spacingMm: {
    z: number | null
    row: number | null
    col: number | null
  }
  perSlice: CtScreenPerSliceV1[]
  aggregate: CtScreenAggregateV1
  /**
   * Только если инференс на своей машине: абсолютный путь к NIfTI на сервере uvicorn.
   * Требует AIVISION_ALLOW_LOCAL_NIFTI_PATH=1 на сервере. Браузер обычно это не шлёт.
   */
  volumeNiftiPath?: string | null
  totalSegmentatorFast?: boolean
  /** "gpu" | "cpu" | "mps" — см. TotalSegmentator */
  totalSegmentatorDevice?: string
  /**
   * Запросить на сервере скрининг ОАС по неконтрастному КТ (если модель подключена).
   * Пока может игнорироваться; демо: AIVISION_DEMO_AORTIC_SCREENING на inference.
   */
  requestAorticSyndromeScreening?: boolean
}


export type CtScreenPerSliceV1 = {
  zIndex: number
  thoraxLike: boolean
  lungVoxels: number
  lungBuckets: Record<string, number>
  hyperCentralFrac: number
  calcFrac: number
  abdomenSoftFrac: number
  interestScore: number
  /** Опционально: лёгкая радиомика в браузере (локальное СКО HU, градиент, островки отклонения от медианы). */
  radiomicsMeanLocalStd?: number | null
  radiomicsMaxGradient?: number | null
  radiomicsFocalHighClusters?: number | null
  radiomicsFocalLowClusters?: number | null
}

export type CtScreenAggregateV1 = {
  totalLungVoxels: number
  thoraxSliceCount: number
  meanHyperCentralFrac: number
  meanCalcFrac: number
  meanAbdomenSoftFrac: number
  abdomenSliceCount: number
  lungBucketTotals: Record<string, number>
  meanRadiomicsLocalStd?: number | null
  meanRadiomicsMaxGradient?: number | null
  totalFocalHighClusters?: number | null
  totalFocalLowClusters?: number | null
}

/** Находка в ответе API (classId = числовой PathologyClass). */
export type CtScreenFindingDto = {
  id: string
  classId: number
  label: string
  confidence: number
  summary: string
  details: string
  clinicalNote?: string
  sliceIndices: number[]
}

/** Упрощённая копия LungVolumeQuantReport для JSON (сервер может вернуть полный отчёт). */
export type LungQuantApiV1 = {
  engineId: string
  slicesTotal: number
  slicesIncluded: number
  slicesSkipped: number
  totalLungVoxels: number
  categories: Array<{
    id: string
    labelRu: string
    percentOfLungParenchyma: number
    clinicalMeaningRu: string
  }>
  notAssessable: Array<{ id: string; labelRu: string; reasonRu: string }>
  mediastinalSoftTissueProxyPercent: number | null
  summaryLineRu: string
  disclaimerRu: string
}

/** Размер сетки выходного NIfTI (оси как в файле: dim0, dim1, dim2). */
export type CtScreenMaskOutputGridV1 = {
  dim0: number
  dim1: number
  dim2: number
}

export type CtScreenMasksV1 = {
  format: 'nifti_url'
  url: string
  /** Например totalsegmentator */
  engineId?: string
  outputGrid?: CtScreenMaskOutputGridV1
  /** Подсказка для UI / клинициста */
  hintRu?: string
  /**
   * Ориентация осей «мира» вокселя (nibabel aff2axcodes), напр. RAS / LPS / unknown.
   * Клиент: при lps_ipp viewer и convention === LPS точка не переводится LPS→RAS перед inv(affine).
   */
  coordinateConvention?: string
  /**
   * Affine 4×4 воксель→мир, 16 чисел row-major (строка за строкой), как NIfTI/nibabel.
   * Если задано, клиент может ресэмплить без qform/sform в файле и сверить с заголовком.
   */
  affineVoxelToWorldRowMajor?: number[]
}

/** Подмножество masks для пропса vtk-слоя (без url). */
export type CtScreenMaskSpatialV1 = Pick<
  CtScreenMasksV1,
  'coordinateConvention' | 'affineVoxelToWorldRowMajor'
>

/** Скрининг острого аортального синдрома по неконтрастному КТ (контракт под двухэтапный DL, как iAorta). */
export type AasSubtypeV1 = 'TAAD' | 'TBAD' | 'IMH' | 'PAU' | 'none' | 'indeterminate'

/** Постобработка TotalSegmentator: HU и объём в вокселях класса aorta (multilabel). */
export type TotalsegAortaHuStatsV1 = {
  ok: boolean
  maskEmpty: boolean
  engineId?: string
  reason?: string | null
  aortaLabelId?: number | null
  voxelCount?: number | null
  volumeMm3?: number | null
  voxelSpacingMm?: number[] | null
  huMean?: number | null
  huStd?: number | null
  huMin?: number | null
  huMax?: number | null
  huP5?: number | null
  huP50?: number | null
  huP95?: number | null
  summaryLineRu?: string | null
  disclaimerRu?: string | null
}

export type AorticSyndromeScreeningV1 = {
  /** Идентификатор модели / версии на сервере */
  modelId?: string
  /** Вероятность ОАС (AAS) на уровне исследования, 0…1 */
  aasProbability: number
  /** Двухпороговая логика: исключение / пересмотр / тревога */
  alertLevel: 'rule_out' | 'review' | 'alert'
  thresholdRuleOut: number
  thresholdAlert: number
  predictedSubtype: AasSubtypeV1 | null
  focusSliceIndex: number | null
  /** Опционально: NIfTI теплокарты (тот же контракт загрузки, что masks) */
  heatmapNiftiUrl?: string | null
  summaryLineRu: string
  disclaimerRu: string
}

export type CtScreenResponseV1 = {
  schemaVersion: typeof CT_SCREEN_SCHEMA_VERSION
  engine: {
    id: string
    labelRu: string
    regulatoryNoteRu: string
  }
  /** true: полностью заменить локальные находки v2 ответом сервера */
  replaceLocalFindings: boolean
  /** true: заменить runLungVolumeQuantification на lungQuant из ответа */
  replaceLocalLungQuant: boolean
  findings: CtScreenFindingDto[]
  focusSliceIndex: number | null
  lungQuant: LungQuantApiV1 | null
  /**
   * Ссылка на multilabel NIfTI + опциональные метаданные (см. inference/app/schemas.py).
   * Viewer: сначала выравнивание по индексам (crop/stride), иначе nearest по qform/sform + IPP/IOP (LPS→RAS).
   */
  masks: CtScreenMasksV1 | null
  /** Результат скрининга ОАС (модель на сервере); отсутствие поля = не считалось */
  aorticSyndromeScreening?: AorticSyndromeScreeningV1 | null
  /** Статистики HU в маске аорты после TotalSegmentator (если сегментация была на сервере) */
  totalsegAortaHuStats?: TotalsegAortaHuStatsV1 | null
  warnings: string[]
}
