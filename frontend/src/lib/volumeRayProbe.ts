/**
 * CPU-зонд по объёму HU (для HUD и клика → MPR).
 * GPU DVR остаётся в vtk.js; здесь только согласованная выборка по тем же origin/spacing.
 */

import * as vtkMath from 'vtk.js/Sources/Common/Core/Math'

/** Совпадает с vtk Matrix3x3: row-major 3×3. */
type RowMat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

type Vec3 = [number, number, number]

/** Направления осей сетки в LPS (как в DICOM IOP): column→индекс x, row→y, slice→z. */
export type VolumePatientAxes = {
  column: readonly [number, number, number]
  row: readonly [number, number, number]
  slice: readonly [number, number, number]
}

export type VolumeGridMeta = {
  scalars: Float32Array
  dimX: number
  dimY: number
  dimZ: number
  /** Шаг сетки vtk (мм) */
  spacing: readonly [number, number, number]
  /** Мм: угол вокселя (0,0,0) — совпадает с vtk ImageData origin */
  origin: readonly [number, number, number]
  voxelCrop: { x0: number; y0: number; z0: number; stride: number }
  nativeSpacingMM: { x: number; y: number; z: number }
  /**
   * Если задано, мир: origin + M·(i,j,k), M — строки [col*sx | row*sy | slice*sz] (как vtk row-major × ijk).
   * null — синтетическая ось XYZ.
   */
  patientAxes: VolumePatientAxes | null
}

function rayAabbIntersect(
  ro: readonly [number, number, number],
  rd: readonly [number, number, number],
  bmin: readonly [number, number, number],
  bmax: readonly [number, number, number],
): [number, number] | null {
  let t0 = 0
  let t1 = Number.POSITIVE_INFINITY
  for (let i = 0; i < 3; i += 1) {
    const o = ro[i]
    const d = rd[i]
    const bn = bmin[i]
    const bx = bmax[i]
    if (Math.abs(d) < 1e-12) {
      if (o < bn || o > bx) return null
      continue
    }
    const inv = 1 / d
    let tNear = (bn - o) * inv
    let tFar = (bx - o) * inv
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear]
    t0 = Math.max(t0, tNear)
    t1 = Math.min(t1, tFar)
    if (t0 > t1) return null
  }
  return [t0, t1]
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function sampleTrilinear(
  scalars: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const z0 = Math.floor(pz)
  const x1 = clamp(x0 + 1, 0, nx - 1)
  const y1 = clamp(y0 + 1, 0, ny - 1)
  const z1 = clamp(z0 + 1, 0, nz - 1)
  const xd = px - x0
  const yd = py - y0
  const zd = pz - z0
  const c000 = scalars[x0 + y0 * nx + z0 * nx * ny]
  const c100 = scalars[x1 + y0 * nx + z0 * nx * ny]
  const c010 = scalars[x0 + y1 * nx + z0 * nx * ny]
  const c110 = scalars[x1 + y1 * nx + z0 * nx * ny]
  const c001 = scalars[x0 + y0 * nx + z1 * nx * ny]
  const c101 = scalars[x1 + y0 * nx + z1 * nx * ny]
  const c011 = scalars[x0 + y1 * nx + z1 * nx * ny]
  const c111 = scalars[x1 + y1 * nx + z1 * nx * ny]
  const c00 = c000 * (1 - xd) + c100 * xd
  const c01 = c001 * (1 - xd) + c101 * xd
  const c10 = c010 * (1 - xd) + c110 * xd
  const c11 = c011 * (1 - xd) + c111 * xd
  const c0 = c00 * (1 - yd) + c10 * yd
  const c1 = c01 * (1 - yd) + c11 * yd
  return c0 * (1 - zd) + c1 * zd
}

/** Row-major 3×3: W = O + m * ijk (ijk — столбец индексов). */
function scaledRowMajorFromAxes(
  axes: VolumePatientAxes,
  spacing: readonly [number, number, number],
): RowMat3 {
  const [sx, sy, sz] = spacing
  const c = axes.column
  const r = axes.row
  const s = axes.slice
  return [
    c[0] * sx,
    r[0] * sy,
    s[0] * sz,
    c[1] * sx,
    r[1] * sy,
    s[1] * sz,
    c[2] * sx,
    r[2] * sy,
    s[2] * sz,
  ]
}

function axisAlignedWorldBounds(meta: VolumeGridMeta): readonly [number, number, number][] {
  const [ox, oy, oz] = meta.origin
  const [sx, sy, sz] = meta.spacing
  const { dimX, dimY, dimZ } = meta
  if (!meta.patientAxes) {
    return [
      [ox, oy, oz],
      [ox + dimX * sx, oy + dimY * sy, oz + dimZ * sz],
    ]
  }
  const m = scaledRowMajorFromAxes(meta.patientAxes, meta.spacing)
  const idxCorners: readonly [number, number, number][] = [
    [0, 0, 0],
    [dimX - 1, 0, 0],
    [0, dimY - 1, 0],
    [0, 0, dimZ - 1],
    [dimX - 1, dimY - 1, 0],
    [dimX - 1, 0, dimZ - 1],
    [0, dimY - 1, dimZ - 1],
    [dimX - 1, dimY - 1, dimZ - 1],
  ]
  const w: Vec3 = [0, 0, 0]
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const ijk of idxCorners) {
    vtkMath.multiply3x3_vect3(m, ijk, w)
    const wx = ox + w[0]
    const wy = oy + w[1]
    const wz = oz + w[2]
    minX = Math.min(minX, wx)
    minY = Math.min(minY, wy)
    minZ = Math.min(minZ, wz)
    maxX = Math.max(maxX, wx)
    maxY = Math.max(maxY, wy)
    maxZ = Math.max(maxZ, wz)
  }
  return [
    [minX, minY, minZ],
    [maxX, maxY, maxZ],
  ]
}

export type ProbeStrategy = 'mip' | 'first-tissue' | 'mean-ray'

/**
 * Возвращает HU вдоль луча и мировую точку (центр выбранного шага).
 */
function worldToContinuousVoxel(
  wx: number,
  wy: number,
  wz: number,
  meta: VolumeGridMeta,
  invRowMajor: RowMat3 | null,
  tmp: Vec3,
): { px: number; py: number; pz: number } {
  const [ox, oy, oz] = meta.origin
  const [sx, sy, sz] = meta.spacing
  tmp[0] = wx - ox
  tmp[1] = wy - oy
  tmp[2] = wz - oz
  if (invRowMajor) {
    const ijk: Vec3 = [0, 0, 0]
    vtkMath.multiply3x3_vect3(invRowMajor, tmp, ijk)
    return { px: ijk[0] - 0.5, py: ijk[1] - 0.5, pz: ijk[2] - 0.5 }
  }
  return {
    px: tmp[0] / sx - 0.5,
    py: tmp[1] / sy - 0.5,
    pz: tmp[2] / sz - 0.5,
  }
}

export function probeAlongRay(
  ro: readonly [number, number, number],
  rd: readonly [number, number, number],
  meta: VolumeGridMeta,
  strategy: ProbeStrategy,
  options?: { steps?: number; tissueHuMin?: number },
): { hu: number; mean3: number; world: readonly [number, number, number] } | null {
  const steps = options?.steps ?? 384
  const tissueMin = options?.tissueHuMin ?? -350

  const dirLen = Math.hypot(rd[0], rd[1], rd[2]) || 1
  const rdx = rd[0] / dirLen
  const rdy = rd[1] / dirLen
  const rdz = rd[2] / dirLen

  let invRowMajor: RowMat3 | null = null
  const tmpRel: Vec3 = [0, 0, 0]
  if (meta.patientAxes) {
    const m = scaledRowMajorFromAxes(meta.patientAxes, meta.spacing)
    if (Math.abs(vtkMath.determinant3x3(m)) > 1e-18) {
      invRowMajor = [0, 0, 0, 0, 0, 0, 0, 0, 0]
      vtkMath.invert3x3(m, invRowMajor)
    }
  }

  const [bmin, bmax] = axisAlignedWorldBounds(meta)
  const hit = rayAabbIntersect(ro, [rdx, rdy, rdz], bmin, bmax)
  if (!hit) return null
  const [tNear, tFar] = hit
  const t0 = Math.max(0, tNear)
  const t1 = tFar
  if (t1 < t0) return null

  let bestHu = -2048
  let bestT = t0
  let firstT = t1 + 1
  let firstHu = -2048
  let sum = 0
  let count = 0

  for (let i = 0; i < steps; i += 1) {
    const t = t0 + (i / Math.max(1, steps - 1)) * (t1 - t0)
    const wx = ro[0] + rdx * t
    const wy = ro[1] + rdy * t
    const wz = ro[2] + rdz * t
    const { px, py, pz } = worldToContinuousVoxel(wx, wy, wz, meta, invRowMajor, tmpRel)
    if (px < -0.5 || py < -0.5 || pz < -0.5) continue
    if (px > meta.dimX - 0.5 || py > meta.dimY - 0.5 || pz > meta.dimZ - 0.5) continue

    const hu = sampleTrilinear(
      meta.scalars,
      meta.dimX,
      meta.dimY,
      meta.dimZ,
      px,
      py,
      pz,
    )
    sum += hu
    count += 1
    if (hu > bestHu) {
      bestHu = hu
      bestT = t
    }
    if (firstT > t1 && hu > tissueMin) {
      firstT = t
      firstHu = hu
    }
  }

  if (count === 0) return null

  const pickT =
    strategy === 'mip'
      ? bestT
      : strategy === 'first-tissue'
        ? firstT <= t1
          ? firstT
          : bestT
        : (t0 + t1) * 0.5

  const huScalar =
    strategy === 'mip'
      ? bestHu
      : strategy === 'first-tissue'
        ? firstT <= t1
          ? firstHu
          : bestHu
        : sum / count

  const wx = ro[0] + rdx * pickT
  const wy = ro[1] + rdy * pickT
  const wz = ro[2] + rdz * pickT
  const pick = worldToContinuousVoxel(wx, wy, wz, meta, invRowMajor, tmpRel)
  const { px, py, pz } = pick

  let acc = 0
  let n = 0
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        acc += sampleTrilinear(
          meta.scalars,
          meta.dimX,
          meta.dimY,
          meta.dimZ,
          px + dx * 0.5,
          py + dy * 0.5,
          pz + dz * 0.5,
        )
        n += 1
      }
    }
  }
  const mean3 = acc / n

  return {
    hu: huScalar,
    mean3,
    world: [wx, wy, wz],
  }
}

/** Мировые мм → индексы срезов для MPR (грубое выравнивание с текущей моделью DicomViewport). */
export function worldMMToCrosshairIndices(
  world: readonly [number, number, number],
  meta: VolumeGridMeta,
  limits: { maxX: number; maxY: number; maxZ: number },
): { x: number; y: number; z: number } {
  const { voxelCrop } = meta
  const [sx, sy, sz] = meta.spacing

  let ix: number
  let iy: number
  let iz: number

  if (meta.patientAxes) {
    const m = scaledRowMajorFromAxes(meta.patientAxes, meta.spacing)
    if (Math.abs(vtkMath.determinant3x3(m)) > 1e-18) {
      const inv: RowMat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
      vtkMath.invert3x3(m, inv)
      const rel: Vec3 = [
        world[0] - meta.origin[0],
        world[1] - meta.origin[1],
        world[2] - meta.origin[2],
      ]
      const ijk: Vec3 = [0, 0, 0]
      vtkMath.multiply3x3_vect3(inv, rel, ijk)
      ix = ijk[0] - 0.5
      iy = ijk[1] - 0.5
      iz = ijk[2] - 0.5
    } else {
      ix = (world[0] - meta.origin[0]) / sx - 0.5
      iy = (world[1] - meta.origin[1]) / sy - 0.5
      iz = (world[2] - meta.origin[2]) / sz - 0.5
    }
  } else {
    ix = (world[0] - meta.origin[0]) / sx - 0.5
    iy = (world[1] - meta.origin[1]) / sy - 0.5
    iz = (world[2] - meta.origin[2]) / sz - 0.5
  }

  const x = Math.round(voxelCrop.x0 + ix * voxelCrop.stride)
  const y = Math.round(voxelCrop.y0 + iy * voxelCrop.stride)
  const z = Math.round(voxelCrop.z0 + iz * voxelCrop.stride)

  return {
    x: clamp(x, 0, limits.maxX),
    y: clamp(y, 0, limits.maxY),
    z: clamp(z, 0, limits.maxZ),
  }
}
