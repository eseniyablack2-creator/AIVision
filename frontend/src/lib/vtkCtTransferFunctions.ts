import type { vtkVolumeMapper } from 'vtk.js/Sources/Rendering/Core/VolumeMapper'
import type { vtkVolumeProperty } from 'vtk.js/Sources/Rendering/Core/VolumeProperty'
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction'
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction'

import {
  AORTA_OPA_HU_SAMPLES,
  HU_ORGAN,
  ISOLATED_OPA_HU_SAMPLES,
  VRT_RGB,
} from './ctHounsfieldAtlas'

type Mode = 'cta3d' | 'airway3d'

export type CtVolumeBlendMode = 'composite' | 'mip' | 'average'

/** Пресеты объёмного рендера (аналог пунктов VRT в ПАКС). */
export type CtColormapStyle =
  | 'vascular'
  /** DVR: контрастный просвет (см. HU_ORGAN.ctaIodinatedLumen); выше HU_ORGAN.vrtAngioOpacityEndHu α→0. */
  | 'vascular-isolated'
  /**
   * CTA аорты: многоцветный VRT (мягкие ткани / йод / кальций бляшки / плотная кость) в духе syngo/Vitrea.
   */
  | 'vascular-aorta'
  | 'density-heatmap'
  /** Кости + приглушённый фон */
  | 'bones'
  /** Кости с большей контрастностью мягких тканей (грубая HU-окраска) */
  | 'bones-rich'
  /** Дыхательные пути / лёгочный воздух — циан, «оболочка» тела полупрозрачная */
  | 'bronchi'

/** Допустимые значения пресета 3D (валидация localStorage). */
export const CT_VOLUME_COLORMAP_IDS: readonly CtColormapStyle[] = [
  'vascular',
  'vascular-isolated',
  'vascular-aorta',
  'density-heatmap',
  'bones',
  'bones-rich',
  'bronchi',
]

export function normalizeCtColormapStyle(value: string | undefined): CtColormapStyle {
  if (value && (CT_VOLUME_COLORMAP_IDS as readonly string[]).includes(value)) {
    return value as CtColormapStyle
  }
  return 'vascular'
}

export type CtVolumeQuality = {
  /** Модель Фонга (диффузное + зеркальное) на градиенте скаляра */
  phongShade: boolean
  /** Локальное затенение углублений (vtk.js LAO — упрощённый аналог SSAO для объёма) */
  localAmbientOcclusion: boolean
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t))
}

/** Кусочно-линейная интерполяция по узлам [x, y], x по возрастанию. */
function piecewiseLin(x: number, pts: readonly [number, number][]): number {
  if (pts.length === 0) return 0
  if (x <= pts[0]![0]) return pts[0]![1]
  const last = pts[pts.length - 1]!
  if (x >= last[0]) return last[1]
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return last[1]
}

/**
 * Пресет «Аорта»: скрытие кортикали / кальция вне просвета (ориентиры HU_ORGAN.ctaIodinatedLumen,
 * corticalBoneLow, vrtAngioOpacityEndHu — см. ctHounsfieldAtlas + NBK547721).
 */
function vascularAortaBoneFreeAlphaUnscaled(hu: number, vScale: number): number {
  const bone0 = Math.min(HU_ORGAN.corticalBoneLow - 8, HU_ORGAN.vrtAngioOpacityEndHu - 128)
  const tbl: [number, number][] = [
    [-1000, 0],
    [-760, 0.007],
    [-520, 0.012],
    [-380, 0.008],
    [-240, 0],
    [-40, 0],
    [0, 0],
    [52, 0.034],
    [95, 0.26],
    [140, 0.45],
    [195, 0.57],
    [252, 0.52],
    [288, 0.4],
    [312, 0.22],
    [330, 0.09],
    [346, 0.028],
    [362, 0.008],
    [378, 0.0015],
    [bone0, 0],
    [HU_ORGAN.vrtAngioOpacityEndHu, 0],
    [3000, 0],
  ]
  return piecewiseLin(hu, tbl) * vScale
}

/** Усиленное скрытие кости: пик в зоне HU_ORGAN.ctaIodinatedLumen, ноль к HU_ORGAN.vrtAngioOpacityEndHu. */
function vascularAortaUltraBoneFreeAlphaUnscaled(hu: number, vScale: number): number {
  const { ctaIodinatedLumen, trabecularBone, vrtAngioOpacityEndHu } = HU_ORGAN
  const trabOverlap = Math.min(trabecularBone.huMax, ctaIodinatedLumen.huMax + 40)
  const tbl: [number, number][] = [
    [-1000, 0],
    [-760, 0.006],
    [-520, 0.01],
    [-380, 0.006],
    [-240, 0],
    [-40, 0],
    [0, 0],
    [46, 0.03],
    [85, 0.21],
    [125, 0.4],
    [175, 0.52],
    [228, 0.4],
    [262, 0.2],
    [285, 0.055],
    [310, 0.017],
    [335, 0.0045],
    [360, 0.00085],
    [trabOverlap, 0.00025],
    [vrtAngioOpacityEndHu, 0],
    [3000, 0],
  ]
  return piecewiseLin(hu, tbl) * vScale
}

/**
 * Расширенная α(HU) для «показать кость» (ползунок Кость → 0): мягкие ткани + сосуды,
 * хвост по кости слабее, чем раньше, чтобы не забивать композит.
 */
function vascularAortaFullAlphaUnscaled(hu: number, vScale: number): number {
  const tbl: [number, number][] = [
    [-1000, 0],
    [-720, 0.005],
    [-480, 0.01],
    [-220, 0.018],
    [-50, 0],
    [0, 0.02],
    [40, 0.085],
    [75, 0.125],
    [110, 0.135],
    [145, 0.11],
    [180, 0.2],
    [225, 0.45],
    [275, 0.54],
    [325, 0.44],
    [375, 0.26],
    [425, 0.1],
    [485, 0.035],
    [580, 0.012],
    [850, 0.004],
    [3000, 0],
  ]
  return piecewiseLin(hu, tbl) * vScale
}

function applyVascularColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0)
  cfun.addRGBPoint(shiftHu(-400), 0.15, 0.12, 0.12)
  cfun.addRGBPoint(shiftHu(0), 0.55, 0.5, 0.48)
  cfun.addRGBPoint(shiftHu(120), 0.75, 0.45, 0.38)
  cfun.addRGBPoint(shiftHu(250), 0.95, 0.35, 0.22)
  cfun.addRGBPoint(shiftHu(400), 1, 0.22, 0.12)
  cfun.addRGBPoint(shiftHu(700), 0.92, 0.88, 0.82)
  cfun.addRGBPoint(shiftHu(1500), 0.98, 0.96, 0.92)
  cfun.addRGBPoint(shiftHu(3000), 1, 1, 1)
}

/**
 * Ангио-VRT в духе рабочих станций (Siemens syngo / Inobitec / Vidar «Сосуды»):
 * тёплый тан/золото для контрастного просвета, лёгкое «дымчато-синее» лёгочное поле для контекста.
 */
function applyVascularIsolatedColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  const [pbR, pbG, pbB] = VRT_RGB.plaqueCalciumBright
  const [pcR, pcG, pcB] = VRT_RGB.plaqueCalciumCool
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0)
  cfun.addRGBPoint(shiftHu(-820), 0.02, 0.05, 0.1)
  cfun.addRGBPoint(shiftHu(-560), 0.05, 0.1, 0.17)
  cfun.addRGBPoint(shiftHu(-360), 0.04, 0.06, 0.09)
  cfun.addRGBPoint(shiftHu(-160), 0.02, 0.025, 0.03)
  cfun.addRGBPoint(shiftHu(20), 0.32, 0.2, 0.16)
  cfun.addRGBPoint(shiftHu(75), 0.72, 0.42, 0.26)
  cfun.addRGBPoint(shiftHu(135), 0.9, 0.55, 0.22)
  cfun.addRGBPoint(shiftHu(205), 0.96, 0.72, 0.32)
  cfun.addRGBPoint(shiftHu(265), 0.92, 0.82, 0.42)
  cfun.addRGBPoint(shiftHu(300), 0.94, 0.85, 0.55)
  cfun.addRGBPoint(shiftHu(340), VRT_RGB.calciumWarm[0], VRT_RGB.calciumWarm[1], VRT_RGB.calciumWarm[2])
  cfun.addRGBPoint(shiftHu(400), pbR, pbG, pbB)
  cfun.addRGBPoint(shiftHu(520), pcR * 0.98, pcG * 0.99, pcB)
  cfun.addRGBPoint(shiftHu(680), pcR, pcG, pcB)
  cfun.addRGBPoint(shiftHu(900), 0.06, 0.06, 0.07)
  cfun.addRGBPoint(shiftHu(3000), 0.03, 0.03, 0.035)
}

/**
 * CTA аорты: чёткое разделение просвета (тёплый оранжево-красный) и бляшки/кальция (белый / холодный белый),
 * как на angio-VRT; кортикаль выше ~900 HU гасится по α отдельно.
 */
function applyVascularAortaColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  const [bgR, bgG, bgB] = VRT_RGB.background
  const [lfR, lfG, lfB] = VRT_RGB.lungField
  const [srR, srG, srB] = VRT_RGB.softTissueRose
  const [lgR, lgG, lgB] = VRT_RGB.liverSpleenGold
  const [icR, icG, icB] = VRT_RGB.iodineLumenCool
  const [alR, alG, alB] = VRT_RGB.angioLumenWarm
  const [pbR, pbG, pbB] = VRT_RGB.plaqueCalciumBright
  const [pcR, pcG, pcB] = VRT_RGB.plaqueCalciumCool
  const [cwR, cwG, cwB] = VRT_RGB.calciumWarm
  const [cmR, cmG, cmB] = VRT_RGB.corticalMuted

  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), bgR, bgG, bgB)
  cfun.addRGBPoint(shiftHu(-780), lfR * 0.5, lfG * 0.5, lfB * 0.75)
  cfun.addRGBPoint(shiftHu(-520), lfR * 1.25, lfG * 1.25, lfB * 1.25)
  cfun.addRGBPoint(shiftHu(-280), lfR * 2, lfG * 1.1, lfB * 0.85)
  cfun.addRGBPoint(shiftHu(-80), ...VRT_RGB.waterTint)
  cfun.addRGBPoint(shiftHu(15), srR * 0.95, srG * 0.85, srB * 0.9)
  cfun.addRGBPoint(shiftHu(45), srR * 1.45, srG * 1.3, srB * 1.15)
  cfun.addRGBPoint(shiftHu(72), srR * 1.55, srG * 1.55, srB * 1.25)
  cfun.addRGBPoint(shiftHu(98), lgR, lgG, lgB)
  cfun.addRGBPoint(shiftHu(128), Math.min(1, lgR + 0.08), Math.min(1, lgG + 0.12), Math.min(1, lgB + 0.04))
  cfun.addRGBPoint(shiftHu(158), 0.42, 0.48, 0.58)
  cfun.addRGBPoint(shiftHu(175), icR * 0.88, icG * 0.92, icB * 0.96)
  cfun.addRGBPoint(shiftHu(200), alR * 0.92, alG * 0.95, alB * 0.98)
  cfun.addRGBPoint(shiftHu(235), alR, alG, alB)
  cfun.addRGBPoint(shiftHu(275), Math.min(1, alR + 0.04), Math.min(1, alG + 0.06), alB)
  /**
   * 300–360 HU: пересечение рёбер/трабекул с контрастом — без раннего «жёлтого кальция»,
   * иначе кость визуально сливается с сосудами и выглядит «шумной».
   */
  cfun.addRGBPoint(shiftHu(302), icR * 0.38, icG * 0.52, icB * 0.78)
  cfun.addRGBPoint(shiftHu(328), 0.48, 0.55, 0.68)
  // Переход к бляшке / кальцию в стенке (типично выше ~350–400 HU)
  cfun.addRGBPoint(shiftHu(352), cwR * 0.95, cwG * 0.82, cwB * 0.55)
  cfun.addRGBPoint(shiftHu(360), pbR * 0.98, pbG * 0.9, pbB * 0.72)
  cfun.addRGBPoint(shiftHu(420), pbR, pbG, pbB)
  cfun.addRGBPoint(shiftHu(520), Math.min(1, pbR + 0.01), pbG, Math.min(1, pbB + 0.04))
  cfun.addRGBPoint(shiftHu(640), pcR, pcG, pcB)
  cfun.addRGBPoint(shiftHu(780), pcR * 0.96, pcG * 0.97, pcB * 1)
  // Остаточная кортикаль (если α > 0 до жёсткого нуля)
  cfun.addRGBPoint(shiftHu(880), cmR * 1.05, cmG * 1.05, cmB * 1.08)
  cfun.addRGBPoint(shiftHu(HU_ORGAN.vrtAngioCorticalHardZeroHu), cmR * 0.82, cmG * 0.82, cmB * 0.85)
  cfun.addRGBPoint(shiftHu(1400), cmR * 0.5, cmG * 0.5, cmB * 0.55)
  cfun.addRGBPoint(shiftHu(3000), cmR * 0.38, cmG * 0.38, cmB * 0.42)
}

/**
 * DVR: boneTame 1 → ultra angio; 0 → «full» с хвостом по кости.
 * Смешивание с «full» через ease-out: уже ~80–90% ползунка даёт почти полное angio-скрытие кости
 * (линейный lerp оставлял 10–15% «костного» хвоста от full до bt≈0.9).
 * При высоком boneTame жёстко α=0 от HU_ORGAN.vrtBoneSuppressHu (кортикаль).
 */
/** Доп. гашение в зоне рёбер (330–480 HU), не трогая типичные бляшки 400+ по всей ширине. */
function aortaRibOverlapDampenAlpha(raw: number, hu: number, towardHide: number): number {
  if (towardHide < 0.97) return raw
  const lo = HU_ORGAN.vrtAortaRibOverlapSuppressHuMin
  const hi = HU_ORGAN.vrtAortaRibOverlapDampenHuMax
  if (hu < lo || hu >= hi) return raw
  const u = (hu - lo) / (hi - lo)
  const factor = 1 - u * u * 0.94
  return raw * Math.max(0.05, factor)
}

function applyVascularAortaCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  vScale: number,
  boneTame: number,
) {
  const bt = clamp01(boneTame)
  const boneHardZero = HU_ORGAN.vrtAngioCorticalHardZeroHu
  /** 0→0, 1→1; на середине ближе к hide (меньше «хвоста» кости от full). */
  const towardHide = 1 - (1 - bt) * (1 - bt)
  for (const hu of AORTA_OPA_HU_SAMPLES) {
    const full = vascularAortaFullAlphaUnscaled(hu, vScale)
    const stdHide = vascularAortaBoneFreeAlphaUnscaled(hu, vScale)
    const ultraHide = vascularAortaUltraBoneFreeAlphaUnscaled(hu, vScale)
    const hideBlend = lerp(stdHide, ultraHide, clamp01((bt - 0.88) / 0.12))
    let raw = lerp(full, hideBlend, towardHide)
    raw = aortaRibOverlapDampenAlpha(raw, hu, towardHide)
    if (towardHide >= 0.86 && hu >= boneHardZero) {
      raw = 0
    }
    ofun.addPoint(hx(hu), oy(raw))
  }
}

/** Псевдо «jet»: низкие HU — синие, высокие — красные (оценка плотности по шкале) */
function applyDensityHeatmapColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0.02, 0.02, 0.12)
  cfun.addRGBPoint(shiftHu(-400), 0, 0, 0.55)
  cfun.addRGBPoint(shiftHu(-100), 0, 0.45, 0.95)
  cfun.addRGBPoint(shiftHu(0), 0, 0.85, 0.85)
  cfun.addRGBPoint(shiftHu(80), 0, 0.9, 0.35)
  cfun.addRGBPoint(shiftHu(200), 0.35, 0.95, 0.2)
  cfun.addRGBPoint(shiftHu(400), 0.95, 0.85, 0.1)
  cfun.addRGBPoint(shiftHu(800), 0.98, 0.35, 0.08)
  cfun.addRGBPoint(shiftHu(1500), 0.95, 0.05, 0.05)
  cfun.addRGBPoint(shiftHu(3000), 0.55, 0.02, 0.35)
}

function applyBonesColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0)
  cfun.addRGBPoint(shiftHu(-600), 0.03, 0.03, 0.032)
  cfun.addRGBPoint(shiftHu(-350), 0.06, 0.055, 0.05)
  cfun.addRGBPoint(shiftHu(-120), 0.12, 0.1, 0.09)
  /* Мягкие ткани и йодированная кровь: тёмные тона, не «кость». */
  cfun.addRGBPoint(shiftHu(40), 0.09, 0.07, 0.06)
  cfun.addRGBPoint(shiftHu(120), 0.11, 0.085, 0.07)
  cfun.addRGBPoint(shiftHu(200), 0.38, 0.33, 0.28)
  cfun.addRGBPoint(shiftHu(320), 0.78, 0.72, 0.62)
  cfun.addRGBPoint(shiftHu(400), 0.94, 0.91, 0.84)
  cfun.addRGBPoint(shiftHu(700), 0.98, 0.96, 0.9)
  cfun.addRGBPoint(shiftHu(1200), 0.995, 0.99, 0.94)
  cfun.addRGBPoint(shiftHu(3000), 1, 1, 0.99)
}

function applyBonesRichColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0)
  cfun.addRGBPoint(shiftHu(-450), 0.06, 0.08, 0.1)
  cfun.addRGBPoint(shiftHu(-150), 0.12, 0.22, 0.32)
  cfun.addRGBPoint(shiftHu(35), 0.22, 0.42, 0.78)
  cfun.addRGBPoint(shiftHu(90), 0.38, 0.34, 0.36)
  cfun.addRGBPoint(shiftHu(180), 0.55, 0.38, 0.32)
  cfun.addRGBPoint(shiftHu(320), 0.82, 0.58, 0.42)
  cfun.addRGBPoint(shiftHu(650), 0.92, 0.82, 0.72)
  cfun.addRGBPoint(shiftHu(1400), 0.98, 0.94, 0.88)
  cfun.addRGBPoint(shiftHu(3000), 1, 0.99, 0.95)
}

function applyBronchiPresetColors(
  cfun: ReturnType<typeof vtkColorTransferFunction.newInstance>,
  shiftHu: (x: number) => number,
) {
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0.02, 0.06, 0.1)
  cfun.addRGBPoint(shiftHu(-880), 0.12, 0.62, 0.88)
  cfun.addRGBPoint(shiftHu(-740), 0.35, 0.88, 0.98)
  cfun.addRGBPoint(shiftHu(-620), 0.22, 0.58, 0.68)
  /* «Оболочка» тела и мягкие ткани — серо-голубые, не тот же циан, что лёгкие. */
  cfun.addRGBPoint(shiftHu(-420), 0.14, 0.2, 0.26)
  cfun.addRGBPoint(shiftHu(-220), 0.22, 0.26, 0.3)
  cfun.addRGBPoint(shiftHu(-60), 0.28, 0.3, 0.32)
  cfun.addRGBPoint(shiftHu(80), 0.34, 0.32, 0.3)
  cfun.addRGBPoint(shiftHu(220), 0.42, 0.38, 0.34)
  cfun.addRGBPoint(shiftHu(500), 0.5, 0.46, 0.42)
  cfun.addRGBPoint(shiftHu(1200), 0.52, 0.48, 0.44)
  cfun.addRGBPoint(shiftHu(3000), 0.45, 0.42, 0.38)
}

function applyVascularCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  vScale: number,
  boneMul: number,
) {
  ofun.addPoint(hx(-1000), oy(0))
  ofun.addPoint(hx(-700), oy(0))
  ofun.addPoint(hx(-400), oy(0.02))
  ofun.addPoint(hx(-100), oy(0.04))
  ofun.addPoint(hx(0), oy(0.06))
  ofun.addPoint(hx(80), oy(0.1))
  ofun.addPoint(hx(120), oy(0.16 * vScale))
  ofun.addPoint(hx(180), oy(0.24 * vScale))
  ofun.addPoint(hx(250), oy(0.34 * vScale))
  ofun.addPoint(hx(350), oy(0.52 * vScale))
  ofun.addPoint(hx(450), oy(0.44 * vScale))
  ofun.addPoint(hx(600), oy(0.35 * boneMul))
  ofun.addPoint(hx(900), oy(0.42 * boneMul))
  ofun.addPoint(hx(1300), oy(0.38 * boneMul))
  ofun.addPoint(hx(2000), oy(0.32 * boneMul))
  ofun.addPoint(hx(3000), oy(0))
}

function vascularIsolatedStrictAlphaUnscaled(hu: number, vScale: number): number {
  const tbl: [number, number][] = [
    [-1000, 0],
    [-760, 0.012],
    [-520, 0.018],
    [-380, 0.01],
    [-240, 0],
    [-40, 0],
    [0, 0],
    [60, 0.04],
    [100, 0.22],
    [150, 0.42],
    [210, 0.55],
    [280, 0.52],
    [340, 0.32],
    [380, 0.12],
    [420, 0.02],
    [460, 0],
    [3000, 0],
  ]
  return piecewiseLin(hu, tbl) * vScale
}

/** Сосуды с «ориентиром» по кости — слабый хвост >380 HU (ползунок Кость → 0). */
function vascularIsolatedBonePeekAlphaUnscaled(hu: number, vScale: number): number {
  const tbl: [number, number][] = [
    [-1000, 0],
    [-760, 0.012],
    [-520, 0.018],
    [-380, 0.01],
    [-240, 0],
    [-40, 0],
    [0, 0],
    [60, 0.04],
    [100, 0.22],
    [150, 0.42],
    [210, 0.55],
    [280, 0.52],
    [340, 0.36],
    [380, 0.24],
    [440, 0.15],
    [520, 0.11],
    [680, 0.075],
    [900, 0.04],
    [3000, 0],
  ]
  return piecewiseLin(hu, tbl) * vScale
}

/**
 * Ангио «Сосуды»: boneTame 1 — кость скрыта (как классический isolated); 0 — слабая кость в кадре.
 */
function applyVascularIsolatedCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  vScale: number,
  boneTame: number,
) {
  const bt = clamp01(boneTame)
  for (const hu of ISOLATED_OPA_HU_SAMPLES) {
    const peek = vascularIsolatedBonePeekAlphaUnscaled(hu, vScale)
    const strict = vascularIsolatedStrictAlphaUnscaled(hu, vScale)
    const raw = lerp(peek, strict, bt)
    ofun.addPoint(hx(hu), oy(raw))
  }
}

function applyBonesCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  boneMul: number,
  rich: boolean,
) {
  void rich
  ofun.addPoint(hx(-1000), oy(0))
  ofun.addPoint(hx(-600), oy(0))
  ofun.addPoint(hx(-350), oy(0.006))
  ofun.addPoint(hx(-150), oy(rich ? 0.028 : 0.012))
  ofun.addPoint(hx(-40), oy(0))
  /* Подавить мягкие ткани и сосудистый контраст (~40–260 HU), оставить кортикаль. */
  ofun.addPoint(hx(50), oy(0))
  ofun.addPoint(hx(120), oy(0))
  ofun.addPoint(hx(200), oy(0.004))
  ofun.addPoint(hx(280), oy(0.14))
  ofun.addPoint(hx(360), oy(0.48 * boneMul))
  ofun.addPoint(hx(480), oy(0.72 * boneMul))
  ofun.addPoint(hx(700), oy(0.62 * boneMul))
  ofun.addPoint(hx(1100), oy(0.5 * boneMul))
  ofun.addPoint(hx(2000), oy(0.26 * boneMul))
  ofun.addPoint(hx(3000), oy(0))
}

function applyBronchiCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  airBoost: number,
  boneMul: number,
) {
  ofun.addPoint(hx(-1000), oy(0))
  ofun.addPoint(hx(-930), oy(0.03))
  ofun.addPoint(hx(-820), oy(0.82 * airBoost))
  ofun.addPoint(hx(-700), oy(0.58 * airBoost))
  ofun.addPoint(hx(-560), oy(0.2 * airBoost))
  ofun.addPoint(hx(-380), oy(0.07 * airBoost))
  ofun.addPoint(hx(-200), oy(0.035))
  ofun.addPoint(hx(-40), oy(0.028))
  ofun.addPoint(hx(60), oy(0.024))
  ofun.addPoint(hx(180), oy(0.032 * boneMul))
  ofun.addPoint(hx(400), oy(0.038 * boneMul))
  ofun.addPoint(hx(900), oy(0.028 * boneMul))
  ofun.addPoint(hx(1800), oy(0.018 * boneMul))
  ofun.addPoint(hx(3000), oy(0))
}

/**
 * @param vesselBoost 0…1 — усиление непрозрачности в диапазоне сосудистого контраста (~200–500 HU)
 * @param boneTame 0…1 — дополнительное приглушение плотной кости (умножитель к HU 550–1600)
 *
 * Режимы vtk.js: composite = классический DVR (front-to-back), MIP = max HU вдоль луча,
 * average = усреднение вдоль луча (грубый аналог «толстого slab» без отдельной геометрии слоя).
 */
export function configureVolumeRendering(
  property: vtkVolumeProperty,
  mapper: vtkVolumeMapper,
  mode: Mode,
  suppressBone: boolean,
  vesselBoost: number,
  boneTame: number,
  options?: {
    blendMode?: CtVolumeBlendMode
    colormapStyle?: CtColormapStyle
    quality?: CtVolumeQuality
    /** Сдвиг опорных точек TF по оси HU (аналог «сдвига окна» для DVR). */
    scalarShift?: number
    /** Множитель непрозрачности (яркость/насыщенность объёма в композитном режиме). */
    opacityGain?: number
  },
) {
  const blendMode = options?.blendMode ?? 'composite'
  const colormapStyle = options?.colormapStyle ?? 'vascular'
  const quality: CtVolumeQuality = options?.quality ?? {
    phongShade: false,
    localAmbientOcclusion: false,
  }
  const huShift = options?.scalarShift ?? 0
  const opGain = Math.max(0.22, Math.min(2.75, options?.opacityGain ?? 1))
  const hx = (x: number) => x + huShift
  const oy = (y: number) => Math.max(0, Math.min(1, y * opGain))

  const ofun = vtkPiecewiseFunction.newInstance()
  const cfun = vtkColorTransferFunction.newInstance()
  const vb = vesselBoost
  const bt = boneTame

  if (mode === 'cta3d') {
    if (blendMode === 'mip') {
      mapper.setBlendModeToMaximumIntensity()
    } else if (blendMode === 'average') {
      mapper.setBlendModeToAverageIntensity()
    } else {
      mapper.setBlendModeToComposite()
    }

    ofun.removeAllPoints()
    if (colormapStyle === 'density-heatmap') {
      applyDensityHeatmapColors(cfun, hx)
    } else if (colormapStyle === 'vascular-isolated') {
      applyVascularIsolatedColors(cfun, hx)
    } else if (colormapStyle === 'vascular-aorta') {
      applyVascularAortaColors(cfun, hx)
    } else if (colormapStyle === 'bones') {
      applyBonesColors(cfun, hx)
    } else if (colormapStyle === 'bones-rich') {
      applyBonesRichColors(cfun, hx)
    } else if (colormapStyle === 'bronchi') {
      applyBronchiPresetColors(cfun, hx)
    } else {
      applyVascularColors(cfun, hx)
    }

    const vScale =
      colormapStyle === 'vascular-aorta'
        ? lerp(0.94, 1.42, vb)
        : colormapStyle === 'vascular-isolated'
          ? lerp(0.84, 1.38, vb)
          : lerp(0.72, 1.35, vb)
    const boneMul =
      colormapStyle === 'vascular-isolated' || colormapStyle === 'vascular-aorta'
        ? 0
        : suppressBone
          ? lerp(0.35, 0.08, bt)
          : lerp(0.85, 0.45, bt)
    const airBoost = lerp(0.88, 1.12, vb)

    if (blendMode === 'mip') {
      ofun.addPoint(hx(-10000), 1)
      ofun.addPoint(hx(10000), 1)
      property.setScalarOpacityUnitDistance(0, 1.0)
    } else {
      if (colormapStyle === 'bones') {
        applyBonesCompositeOpacity(ofun, hx, oy, boneMul, false)
      } else if (colormapStyle === 'bones-rich') {
        applyBonesCompositeOpacity(ofun, hx, oy, boneMul, true)
      } else if (colormapStyle === 'bronchi') {
        applyBronchiCompositeOpacity(ofun, hx, oy, airBoost, boneMul)
      } else if (colormapStyle === 'vascular-isolated') {
        applyVascularIsolatedCompositeOpacity(ofun, hx, oy, vScale, bt)
      } else if (colormapStyle === 'vascular-aorta') {
        applyVascularAortaCompositeOpacity(ofun, hx, oy, vScale, bt)
      } else {
        applyVascularCompositeOpacity(ofun, hx, oy, vScale, boneMul)
      }
      property.setScalarOpacityUnitDistance(
        0,
        colormapStyle === 'bronchi'
          ? lerp(0.95, 0.58, vb)
          : colormapStyle === 'vascular-isolated' || colormapStyle === 'vascular-aorta'
            ? lerp(0.72, 0.38, vb)
            : lerp(1.0, 0.55, vb),
      )
    }
  } else {
    if (blendMode === 'mip') {
      mapper.setBlendModeToMaximumIntensity()
    } else if (blendMode === 'average') {
      mapper.setBlendModeToAverageIntensity()
    } else {
      mapper.setBlendModeToComposite()
    }
    ofun.removeAllPoints()
    cfun.removeAllPoints()

    if (colormapStyle === 'bronchi') {
      applyBronchiPresetColors(cfun, hx)
    } else if (colormapStyle === 'density-heatmap') {
      applyDensityHeatmapColors(cfun, hx)
    } else if (colormapStyle === 'bones') {
      applyBonesColors(cfun, hx)
    } else if (colormapStyle === 'bones-rich') {
      applyBonesRichColors(cfun, hx)
    } else if (colormapStyle === 'vascular-isolated') {
      applyVascularIsolatedColors(cfun, hx)
    } else if (colormapStyle === 'vascular-aorta') {
      applyVascularAortaColors(cfun, hx)
    } else {
      applyVascularColors(cfun, hx)
    }

    const vScale =
      colormapStyle === 'vascular-aorta'
        ? lerp(0.94, 1.42, vb)
        : colormapStyle === 'vascular-isolated'
          ? lerp(0.84, 1.38, vb)
          : lerp(0.72, 1.35, vb)
    const boneMul = suppressBone ? lerp(0.28, 0.04, bt) : lerp(0.82, 0.42, bt)
    const airBoost = lerp(0.95, 1.25, vb)

    if (blendMode === 'mip') {
      ofun.addPoint(hx(-10000), 1)
      ofun.addPoint(hx(10000), 1)
      property.setScalarOpacityUnitDistance(0, 1.0)
    } else {
      if (colormapStyle === 'bones') {
        applyBonesCompositeOpacity(ofun, hx, oy, boneMul, false)
      } else if (colormapStyle === 'bones-rich') {
        applyBonesCompositeOpacity(ofun, hx, oy, boneMul, true)
      } else if (colormapStyle === 'density-heatmap') {
        applyVascularCompositeOpacity(ofun, hx, oy, vScale, boneMul)
      } else if (colormapStyle === 'vascular-isolated') {
        applyVascularIsolatedCompositeOpacity(ofun, hx, oy, vScale, bt)
      } else if (colormapStyle === 'vascular-aorta') {
        applyVascularAortaCompositeOpacity(ofun, hx, oy, vScale, bt)
      } else {
        applyBronchiCompositeOpacity(ofun, hx, oy, airBoost, boneMul)
      }
      property.setScalarOpacityUnitDistance(0, lerp(1.1, 0.56, vb))
    }
  }

  property.setRGBTransferFunction(0, cfun)
  property.setScalarOpacity(0, ofun)
  property.setInterpolationTypeToLinear()
  property.setUseGradientOpacity(0, false)

  const shadeOn = mode === 'cta3d' && quality.phongShade
  property.setShade(shadeOn)
  if (shadeOn) {
    const angioTf =
      colormapStyle === 'vascular-aorta' ||
      colormapStyle === 'vascular-isolated' ||
      colormapStyle === 'vascular'
    if (angioTf) {
      // Без зеркала — иначе кортикальная кость выглядит как пластик.
      property.setAmbient(0.3)
      property.setDiffuse(0.62)
      property.setSpecular(0)
      property.setSpecularPower(1)
    } else if (colormapStyle === 'bones' || colormapStyle === 'bones-rich') {
      property.setAmbient(0.36)
      property.setDiffuse(0.54)
      property.setSpecular(0.03)
      property.setSpecularPower(10)
    } else if (colormapStyle === 'bronchi') {
      property.setAmbient(0.28)
      property.setDiffuse(0.58)
      property.setSpecular(0)
      property.setSpecularPower(1)
    } else {
      property.setAmbient(0.22)
      property.setDiffuse(0.66)
      property.setSpecular(0.08)
      property.setSpecularPower(12)
    }
  }

  const lao = mode === 'cta3d' && quality.localAmbientOcclusion
  property.setLocalAmbientOcclusion(lao)
  if (lao) {
    property.setLAOKernelSize(11)
    property.setLAOKernelRadius(5)
  }
}
