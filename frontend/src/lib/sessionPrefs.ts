import { normalizeCtColormapStyle, type CtColormapStyle } from './vtkCtTransferFunctions'
import { normalizeVolRenderQualityTier, type VolRenderQualityTier } from './vtkVolumeMapperQuality'
import { normalizeVolume3dPresetId, type Volume3dPresetId } from './volume3dPresets'

const KEY = 'aivision-workstation-prefs-v1'

/**
 * Верхняя граница HU для лассо «только кость».
 * Значения вроде 2000 почти не затрагивают типичную кортикаль (~200–1800 HU) — кость визуально «не срезается».
 */
export const ENTERPRISE_LASSO_BONE_HU_MAX = 720
export const ENTERPRISE_LASSO_BONE_HU_MIN = 150

export type Enterprise3DPresetId = 'aorta' | 'vessels_general' | 'bones' | 'lungs'
export type Enterprise3DNavigationMode = 'rotate' | 'pan'
export type Enterprise3DSessionPrefs = {
  presetId: Enterprise3DPresetId
  useAllSlices: boolean
  navigationMode: Enterprise3DNavigationMode
  /** Optional: pick a native (non-contrast) series UID from the same study for DSA/bone suppression. */
  nativeSeriesUid?: string
  /** 0..1 */
  vesselBoost?: number
  /** 0..1 */
  boneTame?: number
  /** HU shift for TF */
  scalarShift?: number
  /** 0.25..2.5 */
  opacityGain?: number
  /** Remove couch/table in 3D volume build */
  removeTable?: boolean
  /**
   * Лассо 3D: если true — в контуре обнуляются только воксели с HU ≥ lassoBoneHuMin (кость/кальций),
   * мягкие ткани и контрастный просвет сохраняются.
   */
  lassoBoneOnly?: boolean
  /** Порог HU для режима «только кость» в лассо (типично 280–480; не выше ENTERPRISE_LASSO_BONE_HU_MAX). */
  lassoBoneHuMin?: number
}

export type WorkstationSessionPrefs = {
  version: 1
  workspaceMode: 'diagnostic' | 'cta3d' | 'airway3d'
  layoutMode: 'single' | 'grid' | 'mpr'
  /** Клинический режим из clinical-requirements.md §4.1 */
  clinicalViewModeId: string
  presetId: string
  clipStart: number
  clipEnd: number
  removeTable: boolean
  suppressBone: boolean
  vesselBoost: number
  boneSuppress: number
  segEnabled: boolean
  segHuMin: number
  segHuMax: number
  /** Режим vtk.js: composite = DVR, mip, average = усреднение вдоль луча */
  volBlendMode?: 'composite' | 'mip' | 'average'
  /** @deprecated читайте volColormapPreset; оставлено для старых сохранений */
  volHeatmap?: boolean
  /** Пресет цвета/непрозрачности объёмного 3D (vtk DVR) */
  volColormapPreset: CtColormapStyle
  volPhongShade?: boolean
  volLao?: boolean
  /** Плотность сэмплов луча в vtk DVR: balanced = авто FPS, high = тяжелее GPU, детальнее */
  volRenderQuality?: VolRenderQualityTier
  /** Клинический 3D пресет (CTA/airway) */
  volPresetId?: Volume3dPresetId
  /** Режим навигации в 3D: вращение или перемещение (рука). */
  volNavigationMode?: 'rotate' | 'pan'
  /** Сохранять кальций, примыкающий к сосудистой маске (CTA) */
  volRestoreCalcium?: boolean
  /** HU-порог кальция для CTA restore */
  volCalciumHuMin?: number
  /** @deprecated Игнорируется: 2D всегда без билинейного сглаживания. */
  interpolation2d?: boolean
  /** @deprecated Поведение встроено: целочисленный dest для drawImage. */
  superCrisp2d?: boolean
  /** Линии перекрёста MPR (жёлтые) между аксиальной / корональной / сагиттальной. */
  showMprCrosslines?: boolean

  /** Новый enterprise-3D пайплайн (R3F + backend GLB). */
  enterprise3d?: Enterprise3DSessionPrefs
}

const defaultPrefs: WorkstationSessionPrefs = {
  version: 1,
  workspaceMode: 'diagnostic',
  layoutMode: 'mpr',
  clinicalViewModeId: 'soft_tissue',
  presetId: 'soft',
  clipStart: 0,
  clipEnd: 0,
  removeTable: true,
  suppressBone: true,
  vesselBoost: 0.5,
  boneSuppress: 0.5,
  segEnabled: false,
  segHuMin: 150,
  segHuMax: 500,
  volBlendMode: 'composite',
  volHeatmap: false,
  volColormapPreset: 'vascular',
  volPhongShade: false,
  volLao: false,
  volRenderQuality: 'balanced',
  volPresetId: 'cta_aorta',
  volNavigationMode: 'rotate',
  volRestoreCalcium: true,
  volCalciumHuMin: 600,
  interpolation2d: false,
  superCrisp2d: true,
  showMprCrosslines: true,
  enterprise3d: {
    presetId: 'aorta',
    useAllSlices: true,
    navigationMode: 'rotate',
    vesselBoost: 0.85,
    boneTame: 1,
    opacityGain: 1.15,
  },
}

export function loadWorkstationPrefs(): WorkstationSessionPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaultPrefs }
    const parsed = JSON.parse(raw) as Partial<WorkstationSessionPrefs>
    if (parsed.version !== 1) return { ...defaultPrefs }
    const merged = { ...defaultPrefs, ...parsed, version: 1 as const }
    const rawMap =
      parsed.volColormapPreset ??
      (parsed.volHeatmap ? 'density-heatmap' : defaultPrefs.volColormapPreset)
    const volColormapPreset = normalizeCtColormapStyle(rawMap)
    const volRenderQuality = normalizeVolRenderQualityTier(merged.volRenderQuality)
    const volPresetId = normalizeVolume3dPresetId(merged.volPresetId)
    const showMprCrosslines =
      typeof merged.showMprCrosslines === 'boolean' ? merged.showMprCrosslines : defaultPrefs.showMprCrosslines
    const e3dRaw = merged.enterprise3d ?? defaultPrefs.enterprise3d!
    const enterprise3d: Enterprise3DSessionPrefs = {
      presetId:
        e3dRaw.presetId === 'aorta' ||
        e3dRaw.presetId === 'vessels_general' ||
        e3dRaw.presetId === 'bones' ||
        e3dRaw.presetId === 'lungs'
          ? e3dRaw.presetId
          : defaultPrefs.enterprise3d!.presetId,
      useAllSlices: Boolean(e3dRaw.useAllSlices),
      navigationMode: e3dRaw.navigationMode === 'pan' ? 'pan' : 'rotate',
      nativeSeriesUid: typeof e3dRaw.nativeSeriesUid === 'string' ? e3dRaw.nativeSeriesUid : undefined,
      // 0 в старых сохранениях давал «мёртвый» angio-TF (vScale→min, кость без подавления).
      vesselBoost:
        typeof e3dRaw.vesselBoost === 'number'
          ? e3dRaw.vesselBoost < 0.08
            ? undefined
            : Math.max(0, Math.min(1, e3dRaw.vesselBoost))
          : undefined,
      boneTame:
        typeof e3dRaw.boneTame === 'number'
          ? e3dRaw.boneTame < 0.08
            ? undefined
            : Math.max(0, Math.min(1, e3dRaw.boneTame))
          : undefined,
      scalarShift: typeof e3dRaw.scalarShift === 'number' ? Math.max(-400, Math.min(400, e3dRaw.scalarShift)) : undefined,
      opacityGain: typeof e3dRaw.opacityGain === 'number' ? Math.max(0.25, Math.min(2.5, e3dRaw.opacityGain)) : undefined,
      removeTable: typeof e3dRaw.removeTable === 'boolean' ? e3dRaw.removeTable : undefined,
      lassoBoneOnly: typeof e3dRaw.lassoBoneOnly === 'boolean' ? e3dRaw.lassoBoneOnly : undefined,
      lassoBoneHuMin:
        typeof e3dRaw.lassoBoneHuMin === 'number' && Number.isFinite(e3dRaw.lassoBoneHuMin)
          ? (() => {
              const r = Math.round(e3dRaw.lassoBoneHuMin)
              if (r > ENTERPRISE_LASSO_BONE_HU_MAX) return 380
              return Math.max(ENTERPRISE_LASSO_BONE_HU_MIN, Math.min(ENTERPRISE_LASSO_BONE_HU_MAX, r))
            })()
          : undefined,
    }
    return { ...merged, volColormapPreset, volRenderQuality, volPresetId, showMprCrosslines, enterprise3d }
  } catch {
    return { ...defaultPrefs }
  }
}

export function saveWorkstationPrefs(prefs: Partial<WorkstationSessionPrefs>) {
  const merged = { ...loadWorkstationPrefs(), ...prefs, version: 1 as const }
  localStorage.setItem(KEY, JSON.stringify(merged))
}
