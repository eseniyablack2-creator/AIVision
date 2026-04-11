import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
// VTK.js requires importing a rendering profile to register WebGL implementations.
// Without this, GenericRenderWindow may crash at runtime (undefined passes).
import 'vtk.js/Sources/Rendering/Profiles/Volume'
import vtkGenericRenderWindow from 'vtk.js/Sources/Rendering/Misc/GenericRenderWindow'
import vtkInteractorStyleManipulator from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator'
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets'
import vtkVolume from 'vtk.js/Sources/Rendering/Core/Volume'
import vtkVolumeMapper from 'vtk.js/Sources/Rendering/Core/VolumeMapper'
import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData'
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray'
import vtkVolumeProperty from 'vtk.js/Sources/Rendering/Core/VolumeProperty'
import type { DicomSeries } from '../lib/dicom'
import type { CtColormapStyle, CtVolumeBlendMode } from '../lib/vtkCtTransferFunctions'
import { configureVolumeRendering } from '../lib/vtkCtTransferFunctions'
import { configureVolumeMapperSampling, type VolRenderQualityTier } from '../lib/vtkVolumeMapperQuality'
import type { CtVolumeResult } from '../lib/ctVolume'
import { buildCtVolumeFromSeries } from '../lib/ctVolume'
import { pointInPolygonNorm, type NormPoint } from '../lib/volumeLassoBezier'
import {
  ENTERPRISE_LASSO_BONE_HU_MAX,
  ENTERPRISE_LASSO_BONE_HU_MIN,
} from '../lib/sessionPrefs'
import type { ViewCubeFace } from './ViewCubeSvg'

export type EnterpriseVolumePresetId = 'aorta' | 'vessels_general' | 'bones' | 'lungs'
export type VolumeNavigationMode = 'rotate' | 'pan'

export type LassoRemoveResult = { ok: true; removed: number } | { ok: false; removed: number; message: string }

/** Режим лассо: «всё в контуре» или только воксели с HU ≥ порога (ручное удаление кости, как в angio-станциях). */
export type LassoRemoveOptions = {
  mode?: 'all' | 'boneOnly'
  /** Для boneOnly: минимальный HU для удаления (по умолчанию 320). */
  boneHuMin?: number
}

export type EnterpriseVolume3DViewportHandle = {
  /**
   * Внутри контура в экранных координатах (оверлей 0–1) — выбранные воксели → воздух (−1024).
   * `boneOnly` удаляет только плотные воксели (кость), не трогая сосуды/мягкие ткани в том же контуре.
   */
  applyLassoRemoveInterior: (
    polygonDomNorm: NormPoint[],
    options?: LassoRemoveOptions,
  ) => Promise<LassoRemoveResult>
  /** Быстрый ортогональный ракурс в координатах пациента (LPS для DICOM-объёмов). */
  snapToPatientView: (face: ViewCubeFace) => void
}

export type EnterpriseVolumeRenderParams = {
  colormapStyle: CtColormapStyle
  blendMode: CtVolumeBlendMode
  suppressBone: boolean
  vesselBoost: number
  boneTame: number
  scalarShift: number
  opacityGain: number
}

type VolumeParams = EnterpriseVolumeRenderParams

function volumeParamsForPreset(presetId: EnterpriseVolumePresetId): VolumeParams {
  if (presetId === 'bones') {
    return {
      colormapStyle: 'bones',
      blendMode: 'composite',
      suppressBone: false,
      vesselBoost: 0.5,
      boneTame: 0.15,
      scalarShift: 0,
      opacityGain: 1.05,
    }
  }
  if (presetId === 'lungs') {
    return {
      colormapStyle: 'bronchi',
      blendMode: 'composite',
      suppressBone: true,
      vesselBoost: 0.78,
      boneTame: 0.82,
      scalarShift: 0,
      opacityGain: 1.08,
    }
  }
  if (presetId === 'aorta') {
    return {
      colormapStyle: 'vascular-aorta',
      blendMode: 'composite',
      suppressBone: true,
      vesselBoost: 0.9,
      boneTame: 1,
      scalarShift: 0,
      opacityGain: 1.15,
    }
  }
  return {
    colormapStyle: 'vascular-isolated',
    blendMode: 'composite',
    suppressBone: true,
    vesselBoost: 0.75,
    boneTame: 0.96,
    scalarShift: 0,
    opacityGain: 1.15,
  }
}

/** Базовые TF/слайдеры для пресета — при смене кнопки «Аорта/Кости/…» нужно подставлять целиком, иначе остаются числа от прошлого пресета. */
export function getEnterpriseVolumeDefaultParams(presetId: EnterpriseVolumePresetId): EnterpriseVolumeRenderParams {
  return volumeParamsForPreset(presetId)
}

type VtkVolumeBundle = {
  grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>
  volume: ReturnType<typeof vtkVolume.newInstance>
  mapper: ReturnType<typeof vtkVolumeMapper.newInstance>
  property: ReturnType<typeof vtkVolumeProperty.newInstance>
  navStyle: ReturnType<typeof vtkInteractorStyleManipulator.newInstance>
}

const ROTATE_MANIP_OPTS = {
  useFocalPointAsCenterOfRotation: true,
  rotationFactor: 1.34,
} as const

/** Общие зум/скролл как в пресете «3D» vtk.js; основной жест — вращение или панорама. */
const ENTERPRISE_NAV_AUX: ReadonlyArray<{ type: string; options?: Record<string, unknown> }> = [
  { type: 'zoom', options: { control: true } },
  { type: 'zoom', options: { alt: true } },
  { type: 'zoom', options: { dragEnabled: false, scrollEnabled: true } },
  { type: 'zoom', options: { button: 3 } },
  { type: 'roll', options: { shift: true, control: true } },
  { type: 'roll', options: { shift: true, alt: true } },
  { type: 'roll', options: { shift: true, button: 3 } },
]

function applyEnterpriseNavigationToStyle(
  style: ReturnType<typeof vtkInteractorStyleManipulator.newInstance>,
  mode: VolumeNavigationMode,
) {
  const primary =
    mode === 'pan'
      ? ([
          { type: 'pan' },
          { type: 'rotate', options: { ...ROTATE_MANIP_OPTS, shift: true } },
        ] as const)
      : ([
          { type: 'rotate', options: { ...ROTATE_MANIP_OPTS } },
          { type: 'pan', options: { shift: true } },
        ] as const)
  InteractionPresets.applyDefinitions([...primary, ...ENTERPRISE_NAV_AUX] as never, style)
}

/** Направление от центра пациента к камере (мм LPS) и view-up для vtkCamera. */
function patientViewCameraLps(face: ViewCubeFace): {
  dirFromPatient: readonly [number, number, number]
  viewUp: readonly [number, number, number]
} {
  switch (face) {
    case 'anterior':
      return { dirFromPatient: [0, -1, 0], viewUp: [0, 0, 1] }
    case 'posterior':
      return { dirFromPatient: [0, 1, 0], viewUp: [0, 0, 1] }
    case 'right':
      return { dirFromPatient: [-1, 0, 0], viewUp: [0, 0, 1] }
    case 'left':
      return { dirFromPatient: [1, 0, 0], viewUp: [0, 0, 1] }
    case 'superior':
      return { dirFromPatient: [0, 0, 1], viewUp: [0, -1, 0] }
    case 'inferior':
      return { dirFromPatient: [0, 0, -1], viewUp: [0, -1, 0] }
    default:
      return { dirFromPatient: [0, -1, 0], viewUp: [0, 0, 1] }
  }
}

function applyEnterpriseVtkAppearance(
  vtk: VtkVolumeBundle,
  presetId: EnterpriseVolumePresetId,
  params: VolumeParams,
  qualityTier: VolRenderQualityTier,
) {
  const input = vtk.mapper.getInputData()
  if (!input) return
  const spacing = input.getSpacing()
  const minS = Math.min(spacing[0], spacing[1], spacing[2])
  configureVolumeMapperSampling(vtk.mapper, minS, qualityTier)
  /** Phong + LAO только для костного пресета; на CTA/лёгких сосудах объёмный свет даёт «грязь» и неверный контраст. */
  const bonePresetQuality = presetId === 'bones'
  configureVolumeRendering(
    vtk.property,
    vtk.mapper,
    'cta3d',
    params.suppressBone,
    params.vesselBoost,
    params.boneTame,
    {
      blendMode: params.blendMode,
      colormapStyle: params.colormapStyle,
      scalarShift: params.scalarShift,
      opacityGain: params.opacityGain,
      quality: {
        phongShade: bonePresetQuality,
        localAmbientOcclusion: bonePresetQuality,
      },
    },
  )
  if (presetId === 'bones') {
    vtk.property.setLAOKernelSize(9)
    vtk.property.setLAOKernelRadius(4)
  }
  vtk.grw.getRenderWindow().render()
}

function createVtkImageFromCtVolume(vol: CtVolumeResult): vtkImageData {
  const image = vtkImageData.newInstance()
  image.setDimensions([vol.dimX, vol.dimY, vol.dimZ])
  image.setSpacing([vol.spacingX, vol.spacingY, vol.spacingZ])
  image.setOrigin([...vol.worldOriginMM])

  const scalars = vtkDataArray.newInstance({
    name: 'HU',
    values: vol.scalars,
    numberOfComponents: 1,
  })
  image.getPointData().setScalars(scalars)
  return image
}

type Props = {
  activeSeries: DicomSeries
  nativeSeries?: DicomSeries | null
  presetId: EnterpriseVolumePresetId
  navigationMode?: VolumeNavigationMode
  useAllSlices?: boolean
  rebuildToken?: number
  /** Clip range within series indices (inclusive). */
  clipStart: number
  clipEnd: number
  removeTable: boolean
  clipX: number
  clipY: number
  clipZ: number
  qualityTier?: VolRenderQualityTier
  scalarShift?: number
  opacityGain?: number
  vesselBoost?: number
  boneTame?: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function addScaled3(
  base: readonly [number, number, number],
  dir: readonly [number, number, number],
  s: number,
): readonly [number, number, number] {
  return [base[0] + dir[0] * s, base[1] + dir[1] * s, base[2] + dir[2] * s] as const
}

function sampleNearestAtWorld(vol: CtVolumeResult, p: readonly [number, number, number]): number {
  const dx = p[0] - vol.worldOriginMM[0]
  const dy = p[1] - vol.worldOriginMM[1]
  const dz = p[2] - vol.worldOriginMM[2]
  const d = [dx, dy, dz] as const
  const ix = Math.round(dot3(d, vol.volumeAxesLps.column) / vol.spacingX - 0.5)
  const iy = Math.round(dot3(d, vol.volumeAxesLps.row) / vol.spacingY - 0.5)
  const iz = Math.round(dot3(d, vol.volumeAxesLps.slice) / vol.spacingZ - 0.5)
  if (ix < 0 || iy < 0 || iz < 0 || ix >= vol.dimX || iy >= vol.dimY || iz >= vol.dimZ) return -1024
  return vol.scalars[ix + iy * vol.dimX + iz * vol.dimX * vol.dimY] ?? -1024
}

/**
 * DSA по контрасту: пишем в тот же Float32Array, без второго гигабайтного буфера.
 * Лимит совпадает с buildCtVolumeFromSeries (после stride объём уже ≤ MAX_VOXELS).
 * Раньше 22M отсекало типичные 512×512×~700 после stride=2 (~23M) — ложный отказ.
 */
const DSA_MAX_VOXELS = 32_000_000

/** Периодически отдаём главный поток, чтобы вкладка не «висела» на минуту. */
async function applyDsaInPlace(contrast: CtVolumeResult, native: CtVolumeResult): Promise<CtVolumeResult> {
  const total = contrast.dimX * contrast.dimY * contrast.dimZ
  if (total > DSA_MAX_VOXELS) {
    throw new Error(
      'DSA слишком тяжёлый на полном объёме. Отключите «Все срезы» или сузьте диапазон срезов.',
    )
  }

  const scalars = contrast.scalars
  const origin = contrast.worldOriginMM
  const col = contrast.volumeAxesLps.column
  const row = contrast.volumeAxesLps.row
  const sl = contrast.volumeAxesLps.slice
  let o = 0
  for (let z = 0; z < contrast.dimZ; z += 1) {
    for (let y = 0; y < contrast.dimY; y += 1) {
      for (let x = 0; x < contrast.dimX; x += 1) {
        let p = addScaled3(origin, col, (x + 0.5) * contrast.spacingX)
        p = addScaled3(p, row, (y + 0.5) * contrast.spacingY)
        p = addScaled3(p, sl, (z + 0.5) * contrast.spacingZ)
        const c = scalars[o] ?? -1024
        const n = sampleNearestAtWorld(native, p)
        scalars[o] = c - n
        o += 1
      }
    }
    if (z % 2 === 1) {
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  return contrast
}

export const EnterpriseVolume3DViewport = forwardRef<EnterpriseVolume3DViewportHandle, Props>(
  function EnterpriseVolume3DViewport(
    {
      activeSeries,
      nativeSeries = null,
      presetId,
      navigationMode = 'rotate',
      useAllSlices = true,
      rebuildToken = 0,
      clipStart,
      clipEnd,
      removeTable,
      clipX,
      clipY,
      clipZ,
      qualityTier = 'balanced',
      scalarShift,
      opacityGain,
      vesselBoost,
      boneTame,
    },
    ref,
  ) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const vtkRef = useRef<VtkVolumeBundle | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const params = useMemo(() => {
    const base = volumeParamsForPreset(presetId)
    return {
      ...base,
      scalarShift: scalarShift ?? base.scalarShift,
      opacityGain: opacityGain ?? base.opacityGain,
      vesselBoost: vesselBoost ?? base.vesselBoost,
      boneTame: boneTame ?? base.boneTame,
    }
  }, [presetId, scalarShift, opacityGain, vesselBoost, boneTame])

  const appearanceSnapRef = useRef({ params, presetId, qualityTier })
  appearanceSnapRef.current = { params, presetId, qualityTier }

  useImperativeHandle(ref, () => ({
    snapToPatientView: (face: ViewCubeFace) => {
      const vtk = vtkRef.current
      if (!vtk) return
      const input = vtk.mapper.getInputData()
      if (!input) return
      const b = input.getBounds()
      const cx = (b[0] + b[1]) / 2
      const cy = (b[2] + b[3]) / 2
      const cz = (b[4] + b[5]) / 2
      const dx = b[1] - b[0]
      const dy = b[3] - b[2]
      const dz = b[5] - b[4]
      const diag = Math.hypot(dx, dy, dz)
      const dist = Math.max(diag * 0.74, 80)
      const { dirFromPatient, viewUp } = patientViewCameraLps(face)
      const renderer = vtk.grw.getRenderer()
      const camera = renderer.getActiveCamera()
      camera.setFocalPoint(cx, cy, cz)
      camera.setPosition(
        cx + dirFromPatient[0] * dist,
        cy + dirFromPatient[1] * dist,
        cz + dirFromPatient[2] * dist,
      )
      camera.setViewUp(viewUp[0], viewUp[1], viewUp[2])
      renderer.resetCameraClippingRange()
      vtk.grw.getRenderWindow().render()
    },
    applyLassoRemoveInterior: async (
      polygonDomNorm: NormPoint[],
      options?: LassoRemoveOptions,
    ): Promise<LassoRemoveResult> => {
      const mode = options?.mode ?? 'all'
      let boneHuMin =
        typeof options?.boneHuMin === 'number' && Number.isFinite(options.boneHuMin)
          ? Math.max(-1024, Math.min(3071, options.boneHuMin))
          : 320
      if (mode === 'boneOnly') {
        boneHuMin = Math.max(
          ENTERPRISE_LASSO_BONE_HU_MIN,
          Math.min(ENTERPRISE_LASSO_BONE_HU_MAX, boneHuMin),
        )
      }
      const vtk = vtkRef.current
      if (!vtk) {
        return { ok: false, removed: 0, message: 'Рендерер не готов' }
      }
      const imageData = vtk.mapper.getInputData()
      if (!imageData) {
        return { ok: false, removed: 0, message: 'Нет объёмных данных' }
      }
      const scalars = imageData.getPointData()?.getScalars()
      const data = scalars?.getData() as Float32Array | undefined
      if (!scalars || !data) {
        return { ok: false, removed: 0, message: 'Нет скаляров HU' }
      }
      if (polygonDomNorm.length < 3) {
        return { ok: false, removed: 0, message: 'Слишком мало точек контура' }
      }

      const renderer = vtk.grw.getRenderer()
      const view = vtk.grw.getRenderWindow().getViews()[0]
      if (!view) {
        return { ok: false, removed: 0, message: 'Нет viewport' }
      }
      const vdims = view.getViewportSize(renderer)
      const aspect = vdims[0] / Math.max(1e-9, vdims[1])

      const [nx, ny, nz] = imageData.getDimensions()
      const world: number[] = [0, 0, 0]
      const ijk: number[] = [0, 0, 0]
      let removed = 0
      let processed = 0
      const yieldEvery = 180_000

      for (let iz = 0; iz < nz; iz += 1) {
        for (let iy = 0; iy < ny; iy += 1) {
          for (let ix = 0; ix < nx; ix += 1) {
            ijk[0] = ix + 0.5
            ijk[1] = iy + 0.5
            ijk[2] = iz + 0.5
            imageData.indexToWorld(ijk, world)
            const [vx, vy] = renderer.worldToNormalizedDisplay(world[0], world[1], world[2], aspect)
            const domX = vx
            const domY = 1 - vy
            if (pointInPolygonNorm(domX, domY, polygonDomNorm)) {
              const idx = ix + iy * nx + iz * nx * ny
              const v = data[idx] ?? -1024
              if (mode === 'boneOnly') {
                if (v >= boneHuMin) {
                  data[idx] = -1024
                  removed += 1
                }
              } else if (v > -900) {
                data[idx] = -1024
                removed += 1
              }
            }
            processed += 1
            if (processed % yieldEvery === 0) {
              await new Promise<void>((r) => setTimeout(r, 0))
            }
          }
        }
      }

      scalars.modified()
      vtk.mapper.modified()
      vtk.grw.getRenderWindow().render()
      return { ok: true, removed }
    },
  }))

  useEffect(() => {
    if (!hostRef.current) return
    if (vtkRef.current) return

    const grw = vtkGenericRenderWindow.newInstance({ background: [0.02, 0.03, 0.05] })
    grw.setContainer(hostRef.current)
    grw.resize()
    const renderer = grw.getRenderer()
    const renderWindow = grw.getRenderWindow()
    const interactor = grw.getInteractor()
    const navStyle = vtkInteractorStyleManipulator.newInstance()
    interactor.setInteractorStyle(navStyle)

    const mapper = vtkVolumeMapper.newInstance()
    const volume = vtkVolume.newInstance()
    const property = vtkVolumeProperty.newInstance()
    volume.setMapper(mapper)
    volume.setProperty(property)
    renderer.addVolume(volume)

    vtkRef.current = { grw, volume, mapper, property, navStyle }

    renderWindow.render()

    const onResize = () => grw.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      try {
        grw.delete()
      } catch {
        // ignore
      }
      vtkRef.current = null
    }
  }, [])

  useEffect(() => {
    const vtk = vtkRef.current
    if (!vtk) return
    applyEnterpriseNavigationToStyle(vtk.navStyle, navigationMode)
  }, [navigationMode])

  /** Только TF / сэмплирование луча — без перечитывания DICOM (слайдеры не должны дергать buildCtVolume). */
  useEffect(() => {
    const vtk = vtkRef.current
    if (!vtk) return
    const input = vtk.mapper.getInputData()
    const scalars = input?.getPointData()?.getScalars()
    if (!input || !scalars) return

    const frame = requestAnimationFrame(() => {
      applyEnterpriseVtkAppearance(vtk, presetId, params, qualityTier)
    })
    return () => cancelAnimationFrame(frame)
  }, [params, presetId, qualityTier])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const vtk = vtkRef.current
      if (!vtk) return
      setLoading(true)
      setError('')
      try {
        // Build HU volume for vtk.js (same as workstation DVR).
        const contrastVol = await buildCtVolumeFromSeries(
          activeSeries,
          useAllSlices ? 0 : clipStart,
          useAllSlices ? Math.max(0, activeSeries.files.length - 1) : clipEnd,
          removeTable,
          clipX,
          clipY,
          clipZ,
        )
        if (cancelled) return

        let vol = contrastVol
        // DSA только если есть отдельная нативная серия; та же UID, что у активной → вычитание обнуляет объём.
        const nativeForDsa =
          nativeSeries &&
          nativeSeries.seriesInstanceUid !== activeSeries.seriesInstanceUid
        if ((presetId === 'aorta' || presetId === 'vessels_general') && nativeForDsa) {
          const nativeLen = nativeSeries.files.length
          const contrastLen = activeSeries.files.length
          const mapIndex = (i: number) =>
            contrastLen > 1 ? Math.round((i * (nativeLen - 1)) / (contrastLen - 1)) : 0
          const nStart = useAllSlices ? 0 : clamp(mapIndex(clipStart), 0, Math.max(0, nativeLen - 1))
          const nEnd = useAllSlices
            ? Math.max(0, nativeLen - 1)
            : clamp(mapIndex(clipEnd), nStart, Math.max(0, nativeLen - 1))
          const nativeVol = await buildCtVolumeFromSeries(
            nativeSeries,
            nStart,
            nEnd,
            removeTable,
            clipX,
            clipY,
            clipZ,
          )
          if (cancelled) return
          vol = await applyDsaInPlace(contrastVol, nativeVol)
        }

        const imageData = createVtkImageFromCtVolume(vol)
        vtk.mapper.setInputData(imageData)
        const snap = appearanceSnapRef.current
        applyEnterpriseVtkAppearance(vtk, snap.presetId, snap.params, snap.qualityTier)

        vtk.grw.getRenderer().resetCamera()
        vtk.grw.getRenderWindow().render()
      } catch (e) {
        if (cancelled) return
        const raw = e instanceof Error ? e.message : ''
        const msg = String(raw || 'Ошибка построения 3D (volume)')
        const normalized = msg.toLowerCase()
        if (
          normalized.includes('requested file could not be read') ||
          (normalized.includes('could not be read') && normalized.includes('permission')) ||
          normalized.includes('permission problems')
        ) {
          setError(
            'Браузер потерял доступ к DICOM-файлам (ограничение безопасности после обновления/перезапуска). Выберите папку исследования заново.',
          )
          return
        }
        if (
          e instanceof RangeError ||
          normalized.includes('array buffer allocation failed') ||
          normalized.includes('out of memory')
        ) {
          setError(
            'Не хватает памяти для полного объёма КТ. Снимите «Все срезы», сузьте диапазон срезов или усильте обрезку (clipping) и нажмите «Перестроить».',
          )
          return
        }
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    activeSeries.seriesInstanceUid,
    nativeSeries?.seriesInstanceUid,
    presetId,
    rebuildToken,
    useAllSlices,
    clipStart,
    clipEnd,
    removeTable,
    clipX,
    clipY,
    clipZ,
  ])

  return (
    <div className="true3d-shell">
      <div ref={hostRef} className="true3d-canvas-wrap" />
      {loading ? <div className="true3d-overlay">Построение 3D…</div> : null}
      {error ? <div className="true3d-overlay error">{error}</div> : null}
    </div>
  )
})

EnterpriseVolume3DViewport.displayName = 'EnterpriseVolume3DViewport'

