/**
 * Парсинг multilabel NIfTI и приведение к той же сетке, что у CtVolumeResult (crop + stride).
 * 1) Быстрый путь: совпадение размеров с cropped/даунсэмплом (+ эвристика swap XY).
 * 2) Иначе: nearest в мм по affine (из API affineVoxelToWorldRowMajor или заголовка NIfTI) и IPP/IOP viewer.
 */

import type { CtScreenMaskSpatialV1 } from './ctInferenceTypes'
import type { CtVolumeResult } from './ctVolume'
import nifti from 'nifti-reader-js'

const DT_UINT8 = 2
const DT_INT16 = 4
const DT_INT32 = 8
const DT_FLOAT32 = 16
const DT_INT8 = 256
const DT_UINT16 = 512
const DT_UINT32 = 768

export type NiftiAlignMethod = 'index_match' | 'world_affine_nn'

export type NiftiAlignResult = {
  labels: Float32Array
  dimX: number
  dimY: number
  dimZ: number
  alignMethod: NiftiAlignMethod
  /** Кратко для UI / отладки */
  detail?: string
}

type NiftiHeaderExt = {
  dims: number[]
  datatypeCode: number
  littleEndian?: boolean
  scl_slope?: number
  scl_inter?: number
  qform_code?: number
  sform_code?: number
  affine?: number[][]
}

function imageBufferToFloat32(
  header: { datatypeCode: number; dims: number[] },
  imageBuf: ArrayBuffer,
): Float32Array {
  const dx = header.dims[1]
  const dy = header.dims[2]
  const dz = header.dims[3]
  const n = dx * dy * dz
  const out = new Float32Array(n)
  const code = header.datatypeCode
  const le = (header as { littleEndian?: boolean }).littleEndian !== false

  if (code === DT_UINT8) {
    const src = new Uint8Array(imageBuf, 0, n)
    for (let i = 0; i < n; i += 1) out[i] = src[i]
    return out
  }
  if (code === DT_INT8) {
    const src = new Int8Array(imageBuf, 0, n)
    for (let i = 0; i < n; i += 1) out[i] = src[i]
    return out
  }
  if (code === DT_INT16) {
    const dv = new DataView(imageBuf)
    for (let i = 0; i < n; i += 1) out[i] = dv.getInt16(i * 2, le)
    return out
  }
  if (code === DT_UINT16) {
    const dv = new DataView(imageBuf)
    for (let i = 0; i < n; i += 1) out[i] = dv.getUint16(i * 2, le)
    return out
  }
  if (code === DT_INT32) {
    const dv = new DataView(imageBuf)
    for (let i = 0; i < n; i += 1) out[i] = dv.getInt32(i * 4, le)
    return out
  }
  if (code === DT_UINT32) {
    const dv = new DataView(imageBuf)
    for (let i = 0; i < n; i += 1) out[i] = dv.getUint32(i * 4, le)
    return out
  }
  if (code === DT_FLOAT32 && imageBuf.byteLength >= n * 4) {
    return new Float32Array(imageBuf, 0, n)
  }

  throw new Error(`Неподдерживаемый NIfTI datatype для масок: ${code}`)
}

/** Перестановка осей x↔y в плоскости среза (частый случай несовпадения с DICOM raster). */
function swapXYLabels(src: Float32Array, dx: number, dy: number, dz: number): Float32Array {
  const nx = dy
  const ny = dx
  const nz = dz
  const out = new Float32Array(nx * ny * nz)
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        out[x + nx * (y + ny * z)] = src[y + dx * (x + dy * z)]
      }
    }
  }
  return out
}

function downsampleLabelNearest(
  src: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  stride: number,
): { labels: Float32Array; ox: number; oy: number; oz: number } {
  if (stride <= 1) {
    return { labels: src, ox: nx, oy: ny, oz: nz }
  }
  const ox = Math.floor(nx / stride)
  const oy = Math.floor(ny / stride)
  const oz = Math.floor(nz / stride)
  const out = new Float32Array(ox * oy * oz)
  let o = 0
  for (let z = 0; z < oz; z += 1) {
    for (let y = 0; y < oy; y += 1) {
      for (let x = 0; x < ox; x += 1) {
        const sx = x * stride
        const sy = y * stride
        const sz = z * stride
        out[o] = src[sx + sy * nx + sz * nx * ny]
        o += 1
      }
    }
  }
  return { labels: out, ox, oy, oz }
}

function tryAlignInner(
  flat: Float32Array,
  dx: number,
  dy: number,
  dz: number,
  built: CtVolumeResult,
): NiftiAlignResult | null {
  const { nx, ny, nz } = built.croppedDims
  const { dimX: fx, dimY: fy, dimZ: fz, downsampleStride: st } = built

  const tryDown = (src: Float32Array, sx: number, sy: number, sz: number) => {
    const { labels, ox, oy, oz } = downsampleLabelNearest(src, sx, sy, sz, st)
    if (ox === fx && oy === fy && oz === fz) {
      return {
        labels,
        dimX: fx,
        dimY: fy,
        dimZ: fz,
        alignMethod: 'index_match' as const,
        detail: 'Совпадение индексов с crop/stride',
      }
    }
    return null
  }

  if (dx === nx && dy === ny && dz === nz) {
    const r = tryDown(flat, nx, ny, nz)
    if (r) return r
  }
  if (dx === fx && dy === fy && dz === fz) {
    return {
      labels: Float32Array.from(flat),
      dimX: fx,
      dimY: fy,
      dimZ: fz,
      alignMethod: 'index_match',
      detail: 'Уже на сетке viewer',
    }
  }

  if (dx === ny && dy === nx && dz === nz) {
    const swapped = swapXYLabels(flat, dx, dy, dz)
    const r = tryDown(swapped, nx, ny, nz)
    if (r) return r
  }
  if (dx === fy && dy === fx && dz === fz) {
    const swapped = swapXYLabels(flat, dx, dy, dz)
    if (swapped.length === fx * fy * fz) {
      return {
        labels: swapped,
        dimX: fx,
        dimY: fy,
        dimZ: fz,
        alignMethod: 'index_match',
        detail: 'Swap XY + сетка viewer',
      }
    }
  }

  return null
}

/** LPS (DICOM patient) → RAS (типичный NIfTI world). */
function lpsToRas(x: number, y: number, z: number): [number, number, number] {
  return [-x, -y, z]
}

function transformPoint4(m: number[][], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]![0]! * x + m[0]![1]! * y + m[0]![2]! * z + m[0]![3]!,
    m[1]![0]! * x + m[1]![1]! * y + m[1]![2]! * z + m[1]![3]!,
    m[2]![0]! * x + m[2]![1]! * y + m[2]![2]! * z + m[2]![3]!,
  ]
}

/** Обратная 4×4 (строки), для affine NIfTI. */
function invert4x4Row(a: number[][]): number[][] | null {
  const n = 4
  const aug: number[][] = []
  for (let i = 0; i < n; i += 1) {
    const row = a[i]
    if (!row || row.length < 4) return null
    const id = [0, 0, 0, 0]
    id[i] = 1
    aug[i] = [row[0]!, row[1]!, row[2]!, row[3]!, id[0]!, id[1]!, id[2]!, id[3]!]
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r
    }
    if (Math.abs(aug[pivot]![col]!) < 1e-14) return null
    if (pivot !== col) {
      const tmp = aug[col]!
      aug[col] = aug[pivot]!
      aug[pivot] = tmp
    }
    const div = aug[col]![col]!
    for (let c = 0; c < 8; c += 1) aug[col]![c]! /= div
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue
      const f = aug[r]![col]!
      if (f === 0) continue
      for (let c = 0; c < 8; c += 1) aug[r]![c]! -= f * aug[col]![c]!
    }
  }
  return aug.map((row) => row.slice(4))
}

function niftiHasSpatialForm(h: NiftiHeaderExt): boolean {
  const q = h.qform_code ?? 0
  const s = h.sform_code ?? 0
  return (q > 0 && q <= 3) || (s > 0 && s <= 3)
}

function rowMajor16ToMat4(f: readonly number[] | undefined): number[][] | null {
  if (!f || f.length !== 16) return null
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(f[i]!)) return null
  }
  return [
    [f[0]!, f[1]!, f[2]!, f[3]!],
    [f[4]!, f[5]!, f[6]!, f[7]!],
    [f[8]!, f[9]!, f[10]!, f[11]!],
    [f[12]!, f[13]!, f[14]!, f[15]!],
  ]
}

function maxAffineDiff(a: number[][], b: number[][]): number {
  let m = 0
  for (let r = 0; r < 4; r += 1)
    for (let c = 0; c < 4; c += 1) m = Math.max(m, Math.abs(a[r]![c]! - b[r]![c]!))
  return m
}

/** Мир маски в LPS (как у DICOM patient), иначе считаем RAS/прочее → нужен LPS→RAS из viewer. */
function maskWorldIsLpsFromConvention(code: string | undefined): boolean {
  return (code ?? '').trim().toUpperCase() === 'LPS'
}

/**
 * Nearest-neighbor: центр вокселя vtk → мир маски → inv(affine) → индекс NIfTI.
 */
function resampleWorldNearest(
  src: Float32Array,
  dx: number,
  dy: number,
  dz: number,
  affine4: number[][],
  built: CtVolumeResult,
  opts: { maskWorldIsLps: boolean; affineSource: 'server' | 'file' },
): NiftiAlignResult | null {
  const inv = invert4x4Row(affine4)
  if (!inv) return null

  const { dimX: fx, dimY: fy, dimZ: fz, spacingX: sx, spacingY: sy, spacingZ: sz } = built
  const ox = built.worldOriginMM[0]
  const oy = built.worldOriginMM[1]
  const oz = built.worldOriginMM[2]
  const col = built.volumeAxesLps.column
  const row = built.volumeAxesLps.row
  const sl = built.volumeAxesLps.slice

  const out = new Float32Array(fx * fy * fz)
  let o = 0
  for (let iz = 0; iz < fz; iz += 1) {
    for (let iy = 0; iy < fy; iy += 1) {
      for (let ix = 0; ix < fx; ix += 1) {
        const tcx = (ix + 0.5) * sx
        const tcy = (iy + 0.5) * sy
        const tcz = (iz + 0.5) * sz
        const cx = ox + tcx * col[0] + tcy * row[0] + tcz * sl[0]
        const cy = oy + tcx * col[1] + tcy * row[1] + tcz * sl[1]
        const cz = oz + tcx * col[2] + tcy * row[2] + tcz * sl[2]

        let wx = cx
        let wy = cy
        let wz = cz
        if (built.worldFrame === 'lps_ipp') {
          if (opts.maskWorldIsLps) {
            wx = cx
            wy = cy
            wz = cz
          } else {
            ;[wx, wy, wz] = lpsToRas(cx, cy, cz)
          }
        }

        const fi = transformPoint4(inv, wx, wy, wz)
        const i = Math.floor(fi[0] + 0.5)
        const j = Math.floor(fi[1] + 0.5)
        const k = Math.floor(fi[2] + 0.5)
        if (i >= 0 && i < dx && j >= 0 && j < dy && k >= 0 && k < dz) {
          out[o] = src[i + j * dx + k * dx * dy]
        } else {
          out[o] = 0
        }
        o += 1
      }
    }
  }

  const srcRu = opts.affineSource === 'server' ? 'сервер' : 'файл'
  const frameRu = opts.maskWorldIsLps ? 'мир маски LPS' : 'мир маски RAS/прочее'
  return {
    labels: out,
    dimX: fx,
    dimY: fy,
    dimZ: fz,
    alignMethod: 'world_affine_nn',
    detail: `Пространственно (affine ${srcRu}, nearest · ${frameRu})`,
  }
}

/**
 * Распаковывает NIfTI (в т.ч. .nii.gz) и возвращает метки на сетке vtk-тома или null.
 * @param serverSpatial — из ответа API (coordinateConvention, affineVoxelToWorldRowMajor): приоритет affine для ресэмпла и сверка с заголовком.
 */
export function alignNiftiLabelsToCtVolume(
  arrayBuffer: ArrayBuffer,
  built: CtVolumeResult,
  serverSpatial?: CtScreenMaskSpatialV1 | null,
): NiftiAlignResult | null {
  let buf: ArrayBuffer = arrayBuffer
  if (nifti.isCompressed(buf)) {
    buf = nifti.decompress(buf)
  }
  if (!nifti.isNIFTI(buf)) {
    return null
  }
  const header = nifti.readHeader(buf) as NiftiHeaderExt | null
  if (!header) return null

  const imageBuf = nifti.readImage(header, buf)
  const dx = header.dims[1]
  const dy = header.dims[2]
  const dz = header.dims[3]
  if (dx < 2 || dy < 2 || dz < 2) return null

  let flat = imageBufferToFloat32(header, imageBuf)

  const slope = header.scl_slope
  const inter = header.scl_inter
  if (slope && slope !== 0 && Number.isFinite(slope)) {
    const b = inter && Number.isFinite(inter) ? inter : 0
    for (let i = 0; i < flat.length; i += 1) {
      flat[i] = flat[i] * slope + b
    }
  }

  const byIndex = tryAlignInner(flat, dx, dy, dz, built)
  if (byIndex) return byIndex

  const aff = header.affine
  let fileMat4: number[][] | null = null
  if (aff && aff.length >= 4) {
    const a4 = aff.slice(0, 4).map((r) => (r.length >= 4 ? r.slice(0, 4) : null))
    if (a4.every((r) => r !== null)) fileMat4 = a4 as number[][]
  }

  const serverMat4 = rowMajor16ToMat4(serverSpatial?.affineVoxelToWorldRowMajor)

  let chosen: number[][] | null = null
  let source: 'server' | 'file' = 'file'
  if (serverMat4) {
    chosen = serverMat4
    source = 'server'
  } else if (fileMat4 && niftiHasSpatialForm(header)) {
    chosen = fileMat4
    source = 'file'
  }

  if (chosen) {
    const hasServerConvention =
      serverSpatial?.coordinateConvention !== undefined &&
      String(serverSpatial.coordinateConvention).trim().length > 0
    const maskWorldIsLps = hasServerConvention
      ? maskWorldIsLpsFromConvention(serverSpatial?.coordinateConvention)
      : false

    let mismatch = 0
    if (serverMat4 && fileMat4 && niftiHasSpatialForm(header)) {
      mismatch = maxAffineDiff(serverMat4, fileMat4)
    }

    const spatial = resampleWorldNearest(flat, dx, dy, dz, chosen, built, {
      maskWorldIsLps,
      affineSource: source,
    })
    if (spatial) {
      if (mismatch > 1e-3) {
        return {
          ...spatial,
          detail: `${spatial.detail ?? ''} · max|Δaffine|=${mismatch.toExponential(2)} (файл↔сервер)`,
        }
      }
      return spatial
    }
  }

  return null
}
