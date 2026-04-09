import type { vtkVolumeMapper } from 'vtk.js/Sources/Rendering/Core/VolumeMapper'
import type { vtkVolumeProperty } from 'vtk.js/Sources/Rendering/Core/VolumeProperty'
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction'
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction'

type Mode = 'cta3d' | 'airway3d'

export type CtVolumeBlendMode = 'composite' | 'mip' | 'average'

/** Пресеты объёмного рендера (аналог пунктов VRT в ПАКС). */
export type CtColormapStyle =
  | 'vascular'
  /** DVR: окно контрастных сосудов ~80–480 HU, выше ~520 HU непрозрачность ≈0 (кость скрыта). */
  | 'vascular-isolated'
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
  cfun.removeAllPoints()
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0)
  cfun.addRGBPoint(shiftHu(-780), 0.04, 0.07, 0.11)
  cfun.addRGBPoint(shiftHu(-520), 0.1, 0.14, 0.2)
  cfun.addRGBPoint(shiftHu(-380), 0.08, 0.11, 0.15)
  cfun.addRGBPoint(shiftHu(-200), 0.03, 0.03, 0.04)
  cfun.addRGBPoint(shiftHu(35), 0.22, 0.18, 0.15)
  cfun.addRGBPoint(shiftHu(95), 0.52, 0.4, 0.3)
  cfun.addRGBPoint(shiftHu(160), 0.78, 0.62, 0.44)
  cfun.addRGBPoint(shiftHu(240), 0.92, 0.76, 0.52)
  cfun.addRGBPoint(shiftHu(320), 0.97, 0.86, 0.66)
  cfun.addRGBPoint(shiftHu(420), 0.99, 0.92, 0.8)
  cfun.addRGBPoint(shiftHu(520), 0.98, 0.95, 0.9)
  cfun.addRGBPoint(shiftHu(900), 0.96, 0.96, 0.94)
  cfun.addRGBPoint(shiftHu(3000), 1, 1, 0.99)
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
  cfun.addRGBPoint(shiftHu(-500), 0.04, 0.04, 0.045)
  cfun.addRGBPoint(shiftHu(-200), 0.08, 0.075, 0.07)
  cfun.addRGBPoint(shiftHu(0), 0.32, 0.28, 0.25)
  cfun.addRGBPoint(shiftHu(100), 0.48, 0.42, 0.36)
  cfun.addRGBPoint(shiftHu(220), 0.78, 0.72, 0.62)
  cfun.addRGBPoint(shiftHu(450), 0.9, 0.86, 0.78)
  cfun.addRGBPoint(shiftHu(900), 0.96, 0.93, 0.86)
  cfun.addRGBPoint(shiftHu(1800), 0.99, 0.97, 0.92)
  cfun.addRGBPoint(shiftHu(3000), 1, 1, 0.98)
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
  cfun.addRGBPoint(shiftHu(-1000), 0, 0, 0.04)
  cfun.addRGBPoint(shiftHu(-880), 0.04, 0.28, 0.42)
  cfun.addRGBPoint(shiftHu(-720), 0.12, 0.82, 0.95)
  cfun.addRGBPoint(shiftHu(-520), 0.18, 0.72, 0.88)
  cfun.addRGBPoint(shiftHu(-380), 0.1, 0.38, 0.48)
  cfun.addRGBPoint(shiftHu(-120), 0.08, 0.14, 0.18)
  cfun.addRGBPoint(shiftHu(40), 0.1, 0.14, 0.17)
  cfun.addRGBPoint(shiftHu(180), 0.22, 0.22, 0.22)
  cfun.addRGBPoint(shiftHu(500), 0.38, 0.36, 0.34)
  cfun.addRGBPoint(shiftHu(1200), 0.48, 0.46, 0.44)
  cfun.addRGBPoint(shiftHu(3000), 0.55, 0.53, 0.5)
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

/**
 * Ангиографический DVR без кости: пик видимости в диапазоне контрастных сосудов,
 * плавный спад и нулевая непрозрачность для кортикальной кости (типично >500 HU).
 */
function applyVascularIsolatedCompositeOpacity(
  ofun: ReturnType<typeof vtkPiecewiseFunction.newInstance>,
  hx: (x: number) => number,
  oy: (y: number) => number,
  vScale: number,
) {
  // Мягкие ткани — 0; лёгкие — слабый «контекст»; йод — основной вклад; кортикальная кость — 0.
  ofun.addPoint(hx(-1000), oy(0))
  ofun.addPoint(hx(-720), oy(0.035 * vScale))
  ofun.addPoint(hx(-480), oy(0.055 * vScale))
  ofun.addPoint(hx(-360), oy(0.04 * vScale))
  ofun.addPoint(hx(-200), oy(0))
  ofun.addPoint(hx(-80), oy(0))
  ofun.addPoint(hx(0), oy(0))
  ofun.addPoint(hx(70), oy(0.02 * vScale))
  ofun.addPoint(hx(110), oy(0.14 * vScale))
  ofun.addPoint(hx(170), oy(0.32 * vScale))
  ofun.addPoint(hx(240), oy(0.44 * vScale))
  ofun.addPoint(hx(320), oy(0.5 * vScale))
  ofun.addPoint(hx(400), oy(0.38 * vScale))
  ofun.addPoint(hx(480), oy(0.12 * vScale))
  ofun.addPoint(hx(540), oy(0.02 * vScale))
  ofun.addPoint(hx(600), oy(0))
  ofun.addPoint(hx(3000), oy(0))
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
  ofun.addPoint(hx(-300), oy(0.015))
  ofun.addPoint(hx(-100), oy(rich ? 0.06 : 0.03))
  // Bones preset should not show "body shell": keep soft tissue at ~0.
  ofun.addPoint(hx(0), oy(0))
  ofun.addPoint(hx(120), oy(0))
  ofun.addPoint(hx(200), oy(0))
  ofun.addPoint(hx(260), oy(0.02))
  ofun.addPoint(hx(300), oy(0.14))
  ofun.addPoint(hx(380), oy(0.46))
  ofun.addPoint(hx(400), oy(0.55 * boneMul))
  ofun.addPoint(hx(700), oy(0.52 * boneMul))
  ofun.addPoint(hx(1200), oy(0.45 * boneMul))
  ofun.addPoint(hx(2000), oy(0.35 * boneMul))
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
  ofun.addPoint(hx(-920), oy(0.02))
  ofun.addPoint(hx(-780), oy(0.55 * airBoost))
  ofun.addPoint(hx(-600), oy(0.92 * airBoost))
  ofun.addPoint(hx(-450), oy(0.88 * airBoost))
  ofun.addPoint(hx(-320), oy(0.35 * airBoost))
  ofun.addPoint(hx(-150), oy(0.06))
  ofun.addPoint(hx(0), oy(0.035))
  ofun.addPoint(hx(60), oy(0.05))
  ofun.addPoint(hx(150), oy(0.08))
  ofun.addPoint(hx(400), oy(0.14 * boneMul))
  ofun.addPoint(hx(900), oy(0.12 * boneMul))
  ofun.addPoint(hx(1800), oy(0.08 * boneMul))
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
  const opGain = Math.max(0.25, Math.min(2.5, options?.opacityGain ?? 1))
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
    } else if (colormapStyle === 'bones') {
      applyBonesColors(cfun, hx)
    } else if (colormapStyle === 'bones-rich') {
      applyBonesRichColors(cfun, hx)
    } else if (colormapStyle === 'bronchi') {
      applyBronchiPresetColors(cfun, hx)
    } else {
      applyVascularColors(cfun, hx)
    }

    const vScale = lerp(0.72, 1.35, vb)
    const boneMul =
      colormapStyle === 'vascular-isolated'
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
        applyVascularIsolatedCompositeOpacity(ofun, hx, oy, vScale)
      } else {
        applyVascularCompositeOpacity(ofun, hx, oy, vScale, boneMul)
      }
      property.setScalarOpacityUnitDistance(
        0,
        colormapStyle === 'bronchi'
          ? lerp(1.05, 0.65, vb)
          : colormapStyle === 'vascular-isolated'
            ? lerp(0.92, 0.48, vb)
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
    } else {
      applyVascularColors(cfun, hx)
    }

    const vScale = lerp(0.72, 1.35, vb)
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
        applyVascularIsolatedCompositeOpacity(ofun, hx, oy, vScale)
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
    // Мягкий объёмный свет без «пластикового» блика (ближе к клиническому VRT).
    property.setAmbient(0.22)
    property.setDiffuse(0.66)
    property.setSpecular(0.08)
    property.setSpecularPower(12)
  }

  const lao = mode === 'cta3d' && quality.localAmbientOcclusion
  property.setLocalAmbientOcclusion(lao)
  if (lao) {
    property.setLAOKernelSize(11)
    property.setLAOKernelRadius(5)
  }
}
