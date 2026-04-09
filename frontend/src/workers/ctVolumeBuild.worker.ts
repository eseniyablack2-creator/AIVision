import type { CtVolumeResult, CtVolumeWorldFrame } from '../lib/ctVolume'
import { estimateTableCutRowsForSlices } from '../lib/ctTableMask'

type SliceIn = {
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

type BuildRequest = {
  kind: 'build'
  clipStart: number
  clipEnd: number
  removeTable: boolean
  clipX: number
  clipY: number
  clipZ: number
  slices: SliceIn[]
}

type ProgressMsg = { kind: 'progress'; phase: 'sort' | 'crop' | 'downsample' | 'done'; value: number }
type ErrorMsg = { kind: 'error'; message: string }
type DoneMsg = { kind: 'done'; built: CtVolumeResult }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sanitizeTableBandRows(dimY: number, tableCutRowsRaw: number): number {
  const hardCap = Math.max(0, Math.floor(dimY * 0.22))
  if (tableCutRowsRaw > Math.floor(dimY * 0.45)) {
    return 0
  }
  return clamp(tableCutRowsRaw, 0, hardCap)
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

function add3(a: readonly [number, number, number], b: readonly [number, number, number]) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as const
}

function scale3(s: number, v: readonly [number, number, number]) {
  return [s * v[0], s * v[1], s * v[2]] as const
}

const MAX_VOXELS = 32_000_000

function computeStride(dimX: number, dimY: number, dimZ: number) {
  const total = dimX * dimY * dimZ
  if (total <= MAX_VOXELS) return 1
  return Math.max(1, Math.ceil(Math.cbrt(total / MAX_VOXELS)))
}

function downsampleScalarField(src: Float32Array, dimX: number, dimY: number, dimZ: number, stride: number) {
  if (stride <= 1) return { scalars: src, dimX, dimY, dimZ }
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

function post(msg: ProgressMsg | ErrorMsg | DoneMsg, transfer?: Transferable[]) {
  ;(self as unknown as Worker).postMessage(msg, transfer ?? [])
}

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const req = ev.data
  if (!req || req.kind !== 'build') return
  try {
    post({ kind: 'progress', phase: 'sort', value: 0 })
    const loaded = req.slices
    if (loaded.length === 0) throw new Error('Нет срезов для 3D.')
    const sorted = [...loaded].sort((a, b) => {
      if (a.imagePositionZ !== null && b.imagePositionZ !== null) return a.imagePositionZ - b.imagePositionZ
      return 0
    })

    const start = clamp(Math.min(req.clipStart, req.clipEnd), 0, sorted.length - 1)
    const end = clamp(Math.max(req.clipStart, req.clipEnd), start, sorted.length - 1)
    const clipped = sorted.slice(start, end + 1)
    if (clipped.length === 0) throw new Error('Нет срезов в выбранном диапазоне.')

    const first = clipped[0]!
    const dimX = first.columns
    const dimY = first.rows
    const dimZ = clipped.length

    for (const s of clipped) {
      if (s.columns !== dimX || s.rows !== dimY) throw new Error('Серия с разным размером матрицы — не подходит для 3D.')
    }

    post({ kind: 'progress', phase: 'sort', value: 1 })
    post({ kind: 'progress', phase: 'crop', value: 0 })

    const tableCutRowsRaw = req.removeTable ? estimateTableCutRowsForSlices(clipped) : 0
    const tableCutRows = sanitizeTableBandRows(dimY, tableCutRowsRaw)

    // Безопасный режим в 3D: не режем поле обзора по бокам/сверху, чтобы не потерять анатомию.
    const left = 0
    const right = 0
    const top = 0
    const tc = { top, bottom: 0, left, right }

    const innerW = dimX - tc.left - tc.right
    const innerH = dimY - tc.top - tc.bottom
    if (innerW < 4 || innerH < 4) {
      throw new Error('После авто-стола поле слишком узкое — отключите «Убрать стол» или ослабьте Clipping.')
    }

    const cropLeftU = Math.floor(innerW * req.clipX * 0.6)
    const cropTopU = Math.floor(innerH * req.clipY * 0.6)
    const cropFront = Math.floor(dimZ * req.clipZ * 0.6)
    const ux0 = clamp(cropLeftU, 0, innerW - 2)
    const uy0 = clamp(cropTopU, 0, innerH - 2)
    const z0 = clamp(cropFront, 0, dimZ - 2)

    const sliceCol0 = tc.left + ux0
    const sliceRow0 = tc.top + uy0

    const nx = innerW - ux0
    const ny = innerH - uy0
    const nz = dimZ - z0
    if (nx < 2 || ny < 2 || nz < 2) throw new Error('Слишком сильное обрезание — увеличьте область.')

    let spacingZ = first.spacingZ
    if (clipped.length > 1) {
      const a = clipped[0]!.imagePositionZ
      const b = clipped[1]!.imagePositionZ
      if (a !== null && b !== null && Math.abs(b - a) > 0.001) spacingZ = Math.abs(b - a)
    }

    const cropped = new Float32Array(nx * ny * nz)
    for (let z = 0; z < nz; z += 1) {
      if (z % 16 === 0) post({ kind: 'progress', phase: 'crop', value: nz > 0 ? z / nz : 1 })
      const slice = clipped[z + z0]!
      for (let y = 0; y < ny; y += 1) {
        const fy = y + uy0
        const sy = tc.top + fy
        const isTableBand = req.removeTable && tableCutRows > 0 && sy >= dimY - tableCutRows
        for (let x = 0; x < nx; x += 1) {
          const fx = x + ux0
          const sx = tc.left + fx
          cropped[x + y * nx + z * nx * ny] = isTableBand ? -1024 : slice.huPixels[sy * dimX + sx]
        }
      }
    }
    post({ kind: 'progress', phase: 'crop', value: 1 })

    post({ kind: 'progress', phase: 'downsample', value: 0 })
    const stride = computeStride(nx, ny, nz)
    const { scalars, dimX: fx, dimY: fy, dimZ: fz } = downsampleScalarField(cropped, nx, ny, nz, stride)

    const sx = first.pixelSpacingX * stride
    const sy = first.pixelSpacingY * stride
    const sz = spacingZ * stride

    const refSlice = clipped[z0]!
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
      let corner = add3(ipp0 as [number, number, number], scale3(sliceCol0 * first.pixelSpacingX, colDir))
      corner = add3(corner, scale3(sliceRow0 * first.pixelSpacingY, rowDir))
      corner = add3(corner, scale3(z0 * spacingZ, sliceDir))
      worldOriginMM = [corner[0], corner[1], corner[2]]
      worldFrame = 'lps_ipp'
    } else {
      worldOriginMM = [sliceCol0 * first.pixelSpacingX, sliceRow0 * first.pixelSpacingY, z0 * spacingZ]
      volumeAxesLps = { column: [1, 0, 0], row: [0, 1, 0], slice: [0, 0, 1] }
    }

    post({ kind: 'progress', phase: 'downsample', value: 1 })

    const built: CtVolumeResult = {
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
      voxelCrop: { x0: sliceCol0, y0: sliceRow0, z0: tc.top + z0 }, // z0 in original index is still z0 in clipped stack, kept for mapping
      nativeSpacingMM: { x: first.pixelSpacingX, y: first.pixelSpacingY, z: spacingZ },
      worldFrame,
      volumeAxesLps,
    }

    // Transfer the big scalars buffer to main thread.
    post({ kind: 'done', built }, [built.scalars.buffer])
    post({ kind: 'progress', phase: 'done', value: 1 })
  } catch (e) {
    post({ kind: 'error', message: e instanceof Error ? e.message : 'Ошибка сборки 3D объёма.' })
  }
}

