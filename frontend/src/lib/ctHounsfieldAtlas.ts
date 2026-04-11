/**
 * Атлас Hounsfield Units (HU) для объёмного VRT/DVR в AIVision.
 *
 * HU — относительная шкала КТ: вода ≈ 0, воздух ≈ −1000 (определение по реконструкции CT).
 * Значения зависят от kVp, алгоритма реконструкции, сканера; для количественной диагностики
 * нужна стандартизация (см. обзор в StatPearls).
 *
 * ## Основные источники (клинические ориентиры, не замена протокола сканера)
 *
 * 1. **StatPearls — Hounsfield Unit** (NCBI Bookshelf NBK547721, PMID 31613501, обновлено 2023):
 *    https://www.ncbi.nlm.nih.gov/books/NBK547721/
 *    — жир ~−50 HU; ЛЖ ~+25; СМ ~+40; кровь +30…+45; верхняя граница кости до ~1000 HU и выше.
 *
 * 2. **Wikipedia — Hounsfield scale** (обзорная таблица тканей):
 *    https://en.wikipedia.org/wiki/Hounsfield_scale
 *
 * 3. **Radlines** (краткая шкала HU):
 *    https://radlines.org/Hounsfield_scale
 *
 * 4. **Контрастная фаза / йод**: усиление мягких тканей и крови после ВК часто **+100…+300 HU**
 *    и выше относительно нативной КТ (общий клинический ориентир в учебниках радиологии;
 *    точные числа зависят от концентрации йода, времени, kVp).
 *
 * Цвета ниже — **соглашение отображения** (как на многих angio-VRT), а не стандарт DICOM;
 * в DICOM Grayscale Presentation State задаётся окно/уровень для 2D, для 3D VRT цвет задаёт ПАКС/вендор.
 */

export const HU_REFERENCES = [
  'StatPearls Hounsfield Unit — https://www.ncbi.nlm.nih.gov/books/NBK547721/ (PMID 31613501)',
  'Wikipedia Hounsfield scale — https://en.wikipedia.org/wiki/Hounsfield_scale',
  'Radlines — https://radlines.org/Hounsfield_scale',
] as const

/** Калибровочные точки шкалы (определение CT). */
export const HU_CALIBRATION = {
  air: -1000,
  water: 0,
} as const

/**
 * Диапазоны по органам / тканям (типичные значения нативной КТ, если не указано иное).
 * Границы — ориентиры для TF, не для диагноза.
 */
export const HU_ORGAN = {
  /** Воздух в кишечнике / трахее вне паренхимы */
  airStrict: { huMin: -1000, huMax: -900 },
  /** Вентилируемое лёгкое (паренхима) */
  lung: { huMin: -900, huMax: -200 },
  /** Подкожный / висцеральный жир (часто −30…−120) */
  fat: { huMin: -120, huMax: -30 },
  /** Вода, простая жидкость */
  water: { huMin: -10, huMax: 10 },
  /** Ликвор (StatPearls: ~+15 HU) */
  csf: { huMin: 0, huMax: 25 },
  /** Белое вещество мозга (обзорно ~20…35 HU) */
  brainWhiteMatter: { huMin: 20, huMax: 35 },
  /** Серое вещество мозга (обзорно ~35…45 HU) */
  brainGreyMatter: { huMin: 35, huMax: 50 },
  /** Неусиленная кровь в сосуде (StatPearls ~+30…+45 HU) */
  bloodUnenhanced: { huMin: 13, huMax: 50 },
  /** Свернувшаяся кровь / гематома (выше плазмы) */
  bloodClotted: { huMin: 50, huMax: 90 },
  /** Скелетная мышца */
  muscle: { huMin: 35, huMax: 55 },
  /** Печень (обзорно 45…65 HU) */
  liver: { huMin: 45, huMax: 65 },
  /** Селезёнка */
  spleen: { huMin: 35, huMax: 55 },
  /** Кора почки */
  kidneyCortex: { huMin: 25, huMax: 45 },
  /** Мозговое вещество почки */
  kidneyMedulla: { huMin: 15, huMax: 35 },
  /** Поджелудочная / «мягкая» паренхима брюшной полости */
  softOrganParenchyma: { huMin: 30, huMax: 55 },
  /** Миокард нативно (в литературе широкий разброс; ориентир 25…85 HU) */
  myocardiumUnenhanced: { huMin: 25, huMax: 85 },
  /** Кровь в аорте нативно (литература MDCT ~40…50 HU среднее, большой разброс) */
  aortaLumenUnenhanced: { huMin: 25, huMax: 90 },
  /**
   * После внутривенного контраста: усиление паренхимы и сосудов (учебниковый ориентир).
   * Пик артериальной фазы в крупных сосудах часто **~150…400 HU**, может быть выше.
   */
  contrastSoftTissue: { huMin: 60, huMax: 180 },
  /** Доминирующий диапазон йодированного артериального просвета на CTA (VRT «сосуды»). */
  ctaIodinatedLumen: { huMin: 100, huMax: 450 },
  /** Губчатая кость / костный мозг (пересекается с контрастом — зона неопределённости). */
  trabecularBone: { huMin: 100, huMax: 400 },
  /** Нижняя граница плотной кортикальной кости (ориентир; кортикис часто >>400 HU). */
  corticalBoneLow: 400,
  /** Типичная кортикальная кость (StatPearls: до ~1000 HU и выше на обычной КТ). */
  corticalBoneMid: 1000,
  /** Для DVR: начать сильное подавление выше этого HU (выше типичного пика йода, ниже плотной кости). */
  vrtBoneSuppressHu: 500,
  /**
   * Жёсткий ноль α при сильном «Скрытие кости» в пресете «Аорта»: типичная кортикаль / рёбра >>900 HU.
   * Ниже этого диапазона по HU остаются видимыми кальцификаты в стенке сосуда (часто ~400–900 HU), что пересекается с костью — без сегментации иначе нельзя.
   */
  vrtAngioCorticalHardZeroHu: 920,
  /** Верхняя граница для «только кость не трогать просвет» в angio-режиме — мягкий ноль. */
  vrtAngioOpacityEndHu: 520,
  /**
   * DVR «Аорта»: нижняя граница зоны доп. подавления α (пересечение рёбер/трабекул с йодом по HU).
   * Только для TF, не клинический порог.
   */
  vrtAortaRibOverlapSuppressHuMin: 330,
  /** Верхняя граница того же dampen (ниже не задеваем типичные бляшки ~400+ HU). */
  vrtAortaRibOverlapDampenHuMax: 480,
} as const

/**
 * Соглашение RGB [0..1] для пресетов VRT (визуализация, не стандарт DICOM).
 * Привязка к HU_ORGAN — в комментариях в vtkCtTransferFunctions.
 */
export const VRT_RGB = {
  background: [0, 0, 0] as const,
  lungField: [0.04, 0.08, 0.12] as const,
  fatTint: [0.07, 0.07, 0.08] as const,
  waterTint: [0.1, 0.11, 0.12] as const,
  softTissueRose: [0.4, 0.14, 0.12] as const,
  liverSpleenGold: [0.82, 0.58, 0.2] as const,
  iodineLumenCool: [0.72, 0.82, 0.96] as const,
  iodineLumenBright: [0.93, 0.94, 0.99] as const,
  calciumWarm: [0.98, 0.8, 0.28] as const,
  corticalMuted: [0.09, 0.09, 0.1] as const,
  /** Просвет CTA — тёплый оранжево-красный (отделение от бляшки по цвету). */
  angioLumenWarm: [0.9, 0.36, 0.22] as const,
  /** Кальцификат / плотная бляшка — почти белый с тёплым оттенком. */
  plaqueCalciumBright: [0.99, 0.97, 0.94] as const,
  /** Очень плотный кальций — холодноватый белый (всё ещё отличим от сосуда). */
  plaqueCalciumCool: [0.92, 0.93, 0.98] as const,
  bronchiAir: [0.2, 0.75, 0.92] as const,
  bronchiParenchyma: [0.22, 0.55, 0.65] as const,
  bodyShell: [0.2, 0.24, 0.28] as const,
} as const

/** Узлы выборки HU для кусочно-линейной α в пресете «Аорта» (покрытие + стабильность интерполяции). */
/** Строго по возрастанию HU (интерполяция vtk PiecewiseFunction). */
export const AORTA_OPA_HU_SAMPLES: readonly number[] = [
  -1000,
  -760,
  -720,
  -520,
  -480,
  -380,
  -240,
  -220,
  HU_ORGAN.lung.huMax,
  HU_ORGAN.fat.huMin,
  -80,
  -50,
  HU_ORGAN.fat.huMax,
  0,
  HU_ORGAN.bloodUnenhanced.huMin,
  HU_ORGAN.muscle.huMin,
  46,
  52,
  75,
  HU_ORGAN.bloodUnenhanced.huMax,
  95,
  100,
  110,
  HU_ORGAN.liver.huMin,
  140,
  145,
  150,
  HU_ORGAN.ctaIodinatedLumen.huMin,
  175,
  180,
  195,
  210,
  225,
  228,
  252,
  262,
  275,
  280,
  288,
  292,
  312,
  325,
  328,
  330,
  340,
  342,
  346,
  354,
  362,
  375,
  378,
  380,
  392,
  HU_ORGAN.corticalBoneLow,
  425,
  460,
  485,
  HU_ORGAN.vrtBoneSuppressHu,
  HU_ORGAN.vrtAngioOpacityEndHu,
  580,
  650,
  720,
  780,
  HU_ORGAN.vrtAngioCorticalHardZeroHu,
  1100,
  1500,
  3000,
]

export const ISOLATED_OPA_HU_SAMPLES: readonly number[] = [
  -1000,
  -760,
  -520,
  -380,
  -240,
  -40,
  0,
  60,
  HU_ORGAN.bloodUnenhanced.huMax,
  100,
  150,
  HU_ORGAN.contrastSoftTissue.huMax,
  210,
  280,
  340,
  380,
  420,
  440,
  460,
  520,
  680,
  900,
  3000,
]
