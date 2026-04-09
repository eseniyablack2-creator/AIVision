import { useEffect, useMemo, useRef, useState } from 'react'
// VTK.js requires importing a rendering profile to register WebGL implementations.
// Without this, GenericRenderWindow may crash at runtime (undefined passes).
import 'vtk.js/Sources/Rendering/Profiles/Volume'
import vtkGenericRenderWindow from 'vtk.js/Sources/Rendering/Misc/GenericRenderWindow'
import vtkVolume from 'vtk.js/Sources/Rendering/Core/Volume'
import vtkVolumeMapper from 'vtk.js/Sources/Rendering/Core/VolumeMapper'
import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData'
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray'
import vtkVolumeProperty from 'vtk.js/Sources/Rendering/Core/VolumeProperty'
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction'
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction'
import type { DicomSeries } from '../lib/dicom'
import type { CtColormapStyle, CtVolumeBlendMode } from '../lib/vtkCtTransferFunctions'
import { configureVolumeRendering } from '../lib/vtkCtTransferFunctions'
import { configureVolumeMapperSampling, type VolRenderQualityTier } from '../lib/vtkVolumeMapperQuality'
import type { CtVolumeResult } from '../lib/ctVolume'
import { buildCtVolumeFromSeries } from '../lib/ctVolume'

export type EnterpriseVolumePresetId = 'aorta' | 'vessels_general' | 'bones' | 'lungs'
export type VolumeNavigationMode = 'rotate' | 'pan'

type VolumeParams = {
  colormapStyle: CtColormapStyle
  blendMode: CtVolumeBlendMode
  suppressBone: boolean
  vesselBoost: number
  boneTame: number
  scalarShift: number
  opacityGain: number
}

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
      blendMode: 'average',
      suppressBone: true,
      vesselBoost: 0.7,
      boneTame: 0.5,
      scalarShift: 0,
      opacityGain: 1.05,
    }
  }
  // aorta / vessels_general
  return {
    colormapStyle: 'vascular-isolated',
    blendMode: 'composite',
    suppressBone: true,
    vesselBoost: presetId === 'aorta' ? 0.9 : 0.75,
    boneTame: 0.9,
    scalarShift: 0,
    opacityGain: 1.15,
  }
}

function applyBonesOnlyTf(property: ReturnType<typeof vtkVolumeProperty.newInstance>) {
  const cfun = vtkColorTransferFunction.newInstance()
  const ofun = vtkPiecewiseFunction.newInstance()

  // Hide everything below ~250 HU (soft tissue) and ramp bones.
  cfun.addRGBPoint(-1024, 0, 0, 0)
  cfun.addRGBPoint(0, 0.05, 0.05, 0.05)
  cfun.addRGBPoint(150, 0.1, 0.09, 0.085)
  cfun.addRGBPoint(300, 0.78, 0.74, 0.66)
  cfun.addRGBPoint(600, 0.92, 0.9, 0.86)
  cfun.addRGBPoint(3000, 1, 1, 0.98)

  ofun.addPoint(-1024, 0.0)
  ofun.addPoint(180, 0.0)
  ofun.addPoint(260, 0.02)
  ofun.addPoint(320, 0.18)
  ofun.addPoint(420, 0.42)
  ofun.addPoint(650, 0.55)
  ofun.addPoint(1200, 0.45)
  ofun.addPoint(3000, 0.0)

  property.setRGBTransferFunction(0, cfun)
  property.setScalarOpacity(0, ofun)
  property.setInterpolationTypeToLinear()
  property.setShade(false)
  property.setUseGradientOpacity(0, false)
  property.setScalarOpacityUnitDistance(0, 0.9)
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

/** DSA по контрасту: пишем в тот же Float32Array, без второго гигабайтного буфера. */
function applyDsaInPlace(contrast: CtVolumeResult, native: CtVolumeResult): CtVolumeResult {
  const total = contrast.dimX * contrast.dimY * contrast.dimZ
  if (total > 22_000_000) {
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
  }

  return contrast
}

export function EnterpriseVolume3DViewport({
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
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const vtkRef = useRef<{
    grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>
    volume: ReturnType<typeof vtkVolume.newInstance>
    mapper: ReturnType<typeof vtkVolumeMapper.newInstance>
    property: ReturnType<typeof vtkVolumeProperty.newInstance>
  } | null>(null)

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

  useEffect(() => {
    if (!hostRef.current) return
    if (vtkRef.current) return

    const grw = vtkGenericRenderWindow.newInstance({ background: [0.02, 0.03, 0.05] })
    grw.setContainer(hostRef.current)
    grw.resize()
    const renderer = grw.getRenderer()
    const renderWindow = grw.getRenderWindow()

    const mapper = vtkVolumeMapper.newInstance()
    const volume = vtkVolume.newInstance()
    const property = vtkVolumeProperty.newInstance()
    volume.setMapper(mapper)
    volume.setProperty(property)
    renderer.addVolume(volume)

    vtkRef.current = { grw, volume, mapper, property }

    // Best-effort: in vtk.js, pan/rotate mapping is handled by interactor style.
    // We keep default behavior; "pan" tool in UI is handled in the 2D toolset.
    void navigationMode

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
  }, [navigationMode])

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
        if ((presetId === 'aorta' || presetId === 'vessels_general') && nativeSeries) {
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
          vol = applyDsaInPlace(contrastVol, nativeVol)
        }

        const imageData = createVtkImageFromCtVolume(vol)
        vtk.mapper.setInputData(imageData)
        configureVolumeMapperSampling(
          vtk.mapper,
          Math.min(vol.spacingX, vol.spacingY, vol.spacingZ),
          qualityTier,
        )
        const angioShade =
          presetId === 'aorta' || presetId === 'vessels_general' || presetId === 'lungs'
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
              phongShade: angioShade,
              localAmbientOcclusion: false,
            },
          },
        )

        if (presetId === 'bones') {
          // Override with strict bones-only TF (no soft tissue shell).
          applyBonesOnlyTf(vtk.property)
        }

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
    params,
    qualityTier,
  ])

  return (
    <div className="true3d-shell">
      <div ref={hostRef} className="true3d-canvas-wrap" />
      {loading ? <div className="true3d-overlay">Построение 3D…</div> : null}
      {error ? <div className="true3d-overlay error">{error}</div> : null}
    </div>
  )
}

