/** Типы без импорта VolumeViewport (vtk) — только для колбэков DicomViewport. */
export type VolumePickPayload = {
  world: readonly [number, number, number]
  hu: number
  mean3: number
  crosshair: { x: number; y: number; z: number }
}
