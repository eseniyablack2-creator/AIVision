export type CtVolumeBlendMode = 'composite' | 'mip' | 'average'

export type CtColormapStyle =
  | 'vascular'
  | 'vascular-isolated'
  | 'density-heatmap'
  | 'bones'
  | 'bones-rich'
  | 'bronchi'

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

export type VolRenderQualityTier = 'balanced' | 'high'

export function normalizeVolRenderQualityTier(value: unknown): VolRenderQualityTier {
  return value === 'high' ? 'high' : 'balanced'
}
