import type { DicomSeries } from './dicom'
import { decodeDicomSlice } from './dicomSliceLoader'
import { estimateTableCutRowsForSlices } from './ctTableMask'

/** Координатная привязка начала объёма: LPS по IPP/IOP или упрощённая ось Z. */
export type CtVolumeWorldFrame = 'lps_ipp' | 'synthetic'

export type CtVolumeResult = {
  /** Hounsfield units, order: x + y * dimX + z * dimX * dimY */
  scalars: Float32Array
  dimX: number
  dimY: number
  dimZ: number
  spacingX: number
  spacingY: number
  spacingZ: number
  downsampleStride: number
  /** Размер подобъёма после crop стола/ROI, до даунсэмпла — для стыковки NIfTI-масок с тем же шагом. */
  croppedDims: { nx: number; ny: number; nz: number }
  /** Мм: vtk ImageData.setOrigin — угол вокселя (0,0,0) в пациентских мм */
  worldOriginMM: readonly [number, number, number]
  /** Исходные индексы начала подобъёма (до stride) для маппинга в crosshair */
  voxelCrop: { x0: number; y0: number; z0: number }
  /** Нативный шаг сетки (мм) до даунсэмпла */
  nativeSpacingMM: { x: number; y: number; z: number }
  /** Откуда взят worldOriginMM; для NIfTI affine: lps_ipp → LPS→RAS при ресэмпле. */
  worldFrame: CtVolumeWorldFrame
  /**
   * Единичные направления осей сетки в LPS (мм/мм): столбец (индекс x), строка (y), срез (z).
   * При synthetic — ортонормированный базис XYZ.
   */
  volumeAxesLps: {
    column: readonly [number, number, number]
    row: readonly [number, number, number]
    slice: readonly [number, number, number]
  }
}

type Slice = {
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  spacingZ: number
  imagePositionZ: number | null
  imagePositionPatient: [number, number, number] | null
  imageOrientationPatient: [number, number, number, number, number, number] | null
  huPixels: Float32Array
}

function normalize3(x: number, y: number, z: number): readonly [number, number, number] {
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len] as const
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ] as const
}

function add3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as const
}

function scale3(s: number, v: readonly [number, number, number]): readonly [number, number, number] {
  return [s * v[0], s * v[1], s * v[2]] as const
}

/** Лимит вокселей после ROI (до stride): укладываемся в RAM браузера при DICOM+DSA. */
const MAX_VOXELS = 32_000_000

/** Сколько срезов декодировать одновременно. Promise.all по всей серии вешает вкладку (Чёрный экран / Not responding). */
const SLICE_DECODE_BATCH = 20

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sanitizeTableBandRows(dimY: number, tableCutRowsRaw: number): number {
  // Безопасный режим: авто-обрезка стола не должна убирать анатомию.
  // Если алгоритм оценил слишком большую полосу, считаем это ложным срабатыванием.
  // Реальные КТ часто имеют широкий "ложемент" и полосы ремней, поэтому увеличиваем допуск.
  const hardCap = Math.max(0, Math.floor(dimY * 0.22))
  if (tableCutRowsRaw > Math.floor(dimY * 0.45)) {
    return 0
  }
  return clamp(tableCutRowsRaw, 0, hardCap)
}

async function loadSlice(file: File): Promise<Slice> {
  const decoded = await decodeDicomSlice(file)
  return {
    rows: decoded.rows,
    columns: decoded.columns,
    pixelSpacingX: decoded.pixelSpacingX,
    pixelSpacingY: decoded.pixelSpacingY,
    spacingZ: decoded.spacingBetweenSlices,
    imagePositionZ: decoded.imagePositionZ,
    imagePositionPatient: decoded.imagePositionPatient,
    imageOrientationPatient: decoded.imageOrientationPatient,
    huPixels: decoded.huPixels,
  }
}

function computeStride(dimX: number, dimY: number, dimZ: number) {
  const total = dimX * dimY * dimZ
  if (total <= MAX_VOXELS) return 1
  return Math.max(1, Math.ceil(Math.cbrt(total / MAX_VOXELS)))
}

function downsampleScalarField(
  src: Float32Array,
  dimX: number,
  dimY: number,
  dimZ: number,
  stride: number,
) {
  if (stride <= 1) {
    return {
      scalars: src,
      dimX,
      dimY,
      dimZ,
    }
  }

  const nx = Math.floor(dimX / stride)
  const ny = Math.floor(dimY / stride)
  const nz = Math.floor(dimZ / stride)
  const out = new Float32Array(nx * ny * nz)
  let o = 0
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        let sum = 0
        let count = 0
        for (let dz = 0; dz < stride; dz += 1) {
          for (let dy = 0; dy < stride; dy += 1) {
            for (let dx = 0; dx < stride; dx += 1) {
              const ix = x * stride + dx
              const iy = y * stride + dy
              const iz = z * stride + dz
              if (ix < dimX && iy < dimY && iz < dimZ) {
                sum += src[ix + iy * dimX + iz * dimX * dimY]
                count += 1
              }
            }
          }
        }
        out[o] = count > 0 ? sum / count : -1024
        o += 1
      }
    }
  }

  return { scalars: out, dimX: nx, dimY: ny, dimZ: nz }
}

/**
 * Собирает серию КТ в 3D-массив HU для vtk.js volume rendering.
 */
export async function buildCtVolumeFromSeries(
  series: DicomSeries,
  clipStart: number,
  clipEnd: number,
  removeTable: boolean,
  clipX: number,
  clipY: number,
  clipZ: number,
): Promise<CtVolumeResult> {
  const files = series.files.map((f) => f.file)
  const loaded: Slice[] = []
  for (let i = 0; i < files.length; i += SLICE_DECODE_BATCH) {
    const chunk = files.slice(i, i + SLICE_DECODE_BATCH)
    const part = await Promise.all(chunk.map((file) => loadSlice(file)))
    loaded.push(...part)
    // Отдаём главному потоку отрисовку спиннера / интерактора.
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  const sorted = [...loaded].sort((a, b) => {
    if (a.imagePositionZ !== null && b.imagePositionZ !== null) {
      return a.imagePositionZ - b.imagePositionZ
    }
    return 0
  })

  const start = clamp(Math.min(clipStart, clipEnd), 0, sorted.length - 1)
  const end = clamp(Math.max(clipStart, clipEnd), start, sorted.length - 1)
  const clipped = sorted.slice(start, end + 1)

  if (clipped.length === 0) {
    throw new Error('Нет срезов в выбранном диапазоне.')
  }

  const first = clipped[0]
  const dimX = first.columns
  const dimY = first.rows
  const dimZ = clipped.length

  for (const s of clipped) {
    if (s.columns !== dimX || s.rows !== dimY) {
      throw new Error('Серия с разным размером матрицы — не подходит для 3D.')
    }
  }

  // В 3D «убрать стол» должно быть консервативным: лучше оставить чуть стола,
  // чем срезать тело. Поэтому:
  // - низ стола убираем маской по строкам (tableCutRows)
  // - бок/верх обрезаем только в безопасных пределах
  const tableCutRowsRaw = removeTable ? estimateTableCutRowsForSlices(clipped) : 0
  const tableCutRows = sanitizeTableBandRows(dimY, tableCutRowsRaw)

  // В 3D-режиме геометрический кроп по бокам/сверху чаще даёт риск потери анатомии,
  // поэтому оставляем только маскирование "пола" (tableCutRows) без срезания поля обзора.
  const left = 0
  const right = 0
  const top = 0
  // Низ не «кропаем» по tcRaw.bottom — его уже маскируем, а кроп снизу чаще всего режет тело.
  const tc = { top, bottom: 0, left, right }
  const innerW = dimX - tc.left - tc.right
  const innerH = dimY - tc.top - tc.bottom
  if (innerW < 4 || innerH < 4) {
    throw new Error(
      'После авто-стола поле слишком узкое — отключите «Убрать стол» или ослабьте Clipping.',
    )
  }

  const cropLeftU = Math.floor(innerW * clipX * 0.6)
  const cropTopU = Math.floor(innerH * clipY * 0.6)
  const cropFront = Math.floor(dimZ * clipZ * 0.6)

  const ux0 = clamp(cropLeftU, 0, innerW - 2)
  const uy0 = clamp(cropTopU, 0, innerH - 2)
  const z0 = clamp(cropFront, 0, dimZ - 2)

  const sliceCol0 = tc.left + ux0
  const sliceRow0 = tc.top + uy0

  const nx = innerW - ux0
  const ny = innerH - uy0
  const nz = dimZ - z0

  if (nx < 2 || ny < 2 || nz < 2) {
    throw new Error('Слишком сильное обрезание — увеличьте область.')
  }

  const spacingX = first.pixelSpacingX
  const spacingY = first.pixelSpacingY
  let spacingZ = first.spacingZ
  if (clipped.length > 1) {
    const a = clipped[0].imagePositionZ
    const b = clipped[1].imagePositionZ
    if (a !== null && b !== null && Math.abs(b - a) > 0.001) {
      spacingZ = Math.abs(b - a)
    }
  }

  // Сразу заполняем ROI без промежуточного full[innerW×innerH×dimZ] — иначе на тонких КТ
  // (например 512×512×1200) получается >1 ГБ и падает с «Array buffer allocation failed».
  const cropped = new Float32Array(nx * ny * nz)
  for (let z = 0; z < nz; z += 1) {
    const slice = clipped[z + z0]
    for (let y = 0; y < ny; y += 1) {
      const fy = y + uy0
      const sy = tc.top + fy
      const isTableBand = removeTable && tableCutRows > 0 && sy >= dimY - tableCutRows
      for (let x = 0; x < nx; x += 1) {
        const fx = x + ux0
        const sx = tc.left + fx
        const v = isTableBand ? -1024 : slice.huPixels[sy * dimX + sx]
        cropped[x + y * nx + z * nx * ny] = v
      }
    }
  }

  const stride = computeStride(nx, ny, nz)
  const { scalars, dimX: fx, dimY: fy, dimZ: fz } = downsampleScalarField(
    cropped,
    nx,
    ny,
    nz,
    stride,
  )

  const sx = spacingX * stride
  const sy = spacingY * stride
  const sz = spacingZ * stride

  const refSlice = clipped[z0]
  const ipp0 = refSlice.imagePositionPatient
  const iop = refSlice.imageOrientationPatient

  let worldFrame: CtVolumeWorldFrame = 'synthetic'
  let worldOriginMM: readonly [number, number, number]
  let volumeAxesLps: CtVolumeResult['volumeAxesLps']

  if (ipp0 && iop) {
    const rowDir = normalize3(iop[0], iop[1], iop[2])
    const colDir = normalize3(iop[3], iop[4], iop[5])
    const sliceDir = normalize3(...cross3(rowDir, colDir))
    volumeAxesLps = { column: colDir, row: rowDir, slice: sliceDir }
    let corner = add3(ipp0 as [number, number, number], scale3(sliceCol0 * spacingX, colDir))
    corner = add3(corner, scale3(sliceRow0 * spacingY, rowDir))
    corner = add3(corner, scale3(z0 * spacingZ, sliceDir))
    worldOriginMM = [corner[0], corner[1], corner[2]]
    worldFrame = 'lps_ipp'
  } else {
    worldOriginMM = [
      sliceCol0 * first.pixelSpacingX,
      sliceRow0 * first.pixelSpacingY,
      z0 * spacingZ,
    ]
    volumeAxesLps = {
      column: [1, 0, 0],
      row: [0, 1, 0],
      slice: [0, 0, 1],
    }
  }

  return {
    scalars,
    dimX: fx,
    dimY: fy,
    dimZ: fz,
    spacingX: sx,
    spacingY: sy,
    spacingZ: sz,
    downsampleStride: stride,
    croppedDims: { nx, ny, nz },
    worldOriginMM,
    voxelCrop: { x0: sliceCol0, y0: sliceRow0, z0 },
    nativeSpacingMM: {
      x: first.pixelSpacingX,
      y: first.pixelSpacingY,
      z: spacingZ,
    },
    worldFrame,
    volumeAxesLps,
  }
}
