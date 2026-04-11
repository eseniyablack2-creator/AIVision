import type { vtkVolumeMapper } from 'vtk.js/Sources/Rendering/Core/VolumeMapper'

export type VolRenderQualityTier = 'balanced' | 'high'

export function normalizeVolRenderQualityTier(value: unknown): VolRenderQualityTier {
  return value === 'high' ? 'high' : 'balanced'
}

/**
 * Шаг луча и лимит сэмплов для DVR: «balanced» оставляет авто-подстройку vtk (FPS),
 * «high» — плотнее сэмплирование, выше нагрузка на GPU.
 */
export function configureVolumeMapperSampling(
  mapper: vtkVolumeMapper,
  minVoxelSpacingMM: number,
  tier: VolRenderQualityTier,
) {
  const s = minVoxelSpacingMM
  if (tier === 'high') {
    mapper.setAutoAdjustSampleDistances(false)
    mapper.setSampleDistance(Math.max(s * 0.11, 0.045))
    mapper.setMaximumSamplesPerRay(5500)
  } else {
    mapper.setAutoAdjustSampleDistances(true)
    mapper.setSampleDistance(Math.max(s * 0.35, 0.2))
    mapper.setMaximumSamplesPerRay(1000)
  }
}
