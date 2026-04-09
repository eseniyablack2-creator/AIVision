import type { CtColormapStyle, CtVolumeBlendMode } from './vtkCtTransferFunctions'
import type { VolRenderQualityTier } from './vtkVolumeMapperQuality'

export type VolumeWorkspaceMode = 'cta3d' | 'airway3d'

export type Volume3dPresetId =
  | 'cta_aorta'
  | 'vessels_contrast'
  | 'phases'
  | 'cta_head_neck'
  | 'cta_coronary'
  | 'cta_runoff'
  | 'cta_pulmonary'
  | 'heart'
  | 'myocardium'
  | 'cac'
  | 'cac2'
  | 'airways'
  | 'lungs_air'
  | 'lungs'
  | 'bones'
  | 'bones_2'
  | 'bones_3'
  | 'abdomen_soft'
  | 'brain_vessels'

export type Volume3dPreset = {
  id: Volume3dPresetId
  label: string
  workspaceMode: VolumeWorkspaceMode
  focus: 'vessels' | 'airway' | 'lung' | 'bone' | 'soft_tissue' | 'brain' | 'heart'
  description: string
  settings: {
    blendMode: CtVolumeBlendMode
    colormapStyle: CtColormapStyle
    suppressBone: boolean
    hardBoneCut: boolean
    vesselOnly: boolean
    vesselHuMin: number
    vesselHuMax: number
    vesselBoost: number
    boneSuppressTf: number
    removeTable: boolean
    scalarShift: number
    opacityGain: number
    renderQuality: VolRenderQualityTier
    preservePerivascularCalcium: boolean
    calciumHuMin: number
  }
}

export const VOLUME_3D_PRESETS: readonly Volume3dPreset[] = [
  {
    id: 'cta_aorta',
    label: 'Аорта CTA',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Сосудистый режим с агрессивным подавлением кости и сохранением кальция у стенки.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular-isolated',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 170,
      vesselHuMax: 520,
      vesselBoost: 0.92,
      boneSuppressTf: 0.95,
      removeTable: true,
      scalarShift: 0,
      opacityGain: 1.22,
      renderQuality: 'high',
      preservePerivascularCalcium: true,
      calciumHuMin: 640,
    },
  },
  {
    id: 'vessels_contrast',
    label: 'Сосуды (контраст)',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Контрастные артерии с мягкой тканью фоном и сохранением периваскулярного кальция.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 150,
      vesselHuMax: 520,
      vesselBoost: 0.9,
      boneSuppressTf: 0.9,
      removeTable: true,
      scalarShift: 6,
      opacityGain: 1.14,
      renderQuality: 'high',
      preservePerivascularCalcium: true,
      calciumHuMin: 620,
    },
  },
  {
    id: 'phases',
    label: 'Фазы',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Многоцветный фазовый рендер (плотностная карта) для оценки контраста и тканей.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'density-heatmap',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 120,
      vesselHuMax: 650,
      vesselBoost: 0.72,
      boneSuppressTf: 0.4,
      removeTable: true,
      scalarShift: 0,
      opacityGain: 0.98,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'cta_head_neck',
    label: 'Голова/шея CTA',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Сосуды головы и шеи с усиленным подавлением черепа.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'vascular-isolated',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 140,
      vesselHuMax: 500,
      vesselBoost: 0.88,
      boneSuppressTf: 0.96,
      removeTable: true,
      scalarShift: -4,
      opacityGain: 1.1,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 640,
    },
  },
  {
    id: 'cta_coronary',
    label: 'Коронарные',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Коронарные артерии: контраст + сохранение кальцинатов.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 180,
      vesselHuMax: 520,
      vesselBoost: 0.94,
      boneSuppressTf: 0.92,
      removeTable: true,
      scalarShift: 10,
      opacityGain: 1.16,
      renderQuality: 'high',
      preservePerivascularCalcium: true,
      calciumHuMin: 620,
    },
  },
  {
    id: 'cta_runoff',
    label: 'Runoff (ноги)',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Длинный артериальный тракт с максимальным костным suppression.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'vascular-isolated',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 170,
      vesselHuMax: 520,
      vesselBoost: 0.86,
      boneSuppressTf: 0.96,
      removeTable: true,
      scalarShift: 0,
      opacityGain: 1.08,
      renderQuality: 'high',
      preservePerivascularCalcium: true,
      calciumHuMin: 650,
    },
  },
  {
    id: 'cta_pulmonary',
    label: 'CTPA',
    workspaceMode: 'cta3d',
    focus: 'vessels',
    description: 'Лёгочные артерии (ТЭЛА) с акцентом на контрастный просвет.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'vascular-isolated',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 130,
      vesselHuMax: 500,
      vesselBoost: 0.84,
      boneSuppressTf: 0.9,
      removeTable: true,
      scalarShift: -8,
      opacityGain: 1.06,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 620,
    },
  },
  {
    id: 'heart',
    label: 'Сердце',
    workspaceMode: 'cta3d',
    focus: 'heart',
    description: 'Мягкотканный кардиорежим с видимыми камерами и магистральными сосудами.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 120,
      vesselHuMax: 600,
      vesselBoost: 0.72,
      boneSuppressTf: 0.85,
      removeTable: true,
      scalarShift: -20,
      opacityGain: 0.94,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'myocardium',
    label: 'Миокард',
    workspaceMode: 'cta3d',
    focus: 'heart',
    description: 'Приглушённый сосудистый слой и акцент на миокард.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 100,
      vesselHuMax: 500,
      vesselBoost: 0.62,
      boneSuppressTf: 0.9,
      removeTable: true,
      scalarShift: -35,
      opacityGain: 0.9,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'cac',
    label: 'CAC',
    workspaceMode: 'cta3d',
    focus: 'heart',
    description: 'Кальциевый режим: подсветка плотных структур (CAC).',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'density-heatmap',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 120,
      vesselHuMax: 900,
      vesselBoost: 0.58,
      boneSuppressTf: 0.25,
      removeTable: true,
      scalarShift: 40,
      opacityGain: 1.02,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'cac2',
    label: 'CAC-2',
    workspaceMode: 'cta3d',
    focus: 'heart',
    description: 'Более контрастная версия CAC с усиленным high-HU.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'density-heatmap',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 140,
      vesselHuMax: 1200,
      vesselBoost: 0.66,
      boneSuppressTf: 0.2,
      removeTable: true,
      scalarShift: 50,
      opacityGain: 1.06,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'airways',
    label: 'Бронхи',
    workspaceMode: 'airway3d',
    focus: 'airway',
    description: 'Бронхиальное дерево с акцентом на воздухоносные пути.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'bronchi',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 150,
      vesselHuMax: 520,
      vesselBoost: 0.8,
      boneSuppressTf: 0.95,
      removeTable: true,
      scalarShift: 0,
      opacityGain: 1.06,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'lungs_air',
    label: 'Лёгкие Air',
    workspaceMode: 'airway3d',
    focus: 'lung',
    description: 'Воздушный режим лёгких с полупрозрачной паренхимой.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'bronchi',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 150,
      vesselHuMax: 520,
      vesselBoost: 0.9,
      boneSuppressTf: 0.98,
      removeTable: true,
      scalarShift: -45,
      opacityGain: 0.9,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 700,
    },
  },
  {
    id: 'lungs',
    label: 'Лёгкие',
    workspaceMode: 'airway3d',
    focus: 'lung',
    description: 'Универсальный лёгочный режим без сильного подавления.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'bronchi',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 150,
      vesselHuMax: 520,
      vesselBoost: 0.78,
      boneSuppressTf: 0.8,
      removeTable: true,
      scalarShift: -20,
      opacityGain: 0.92,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 700,
    },
  },
  {
    id: 'bones',
    label: 'Кости',
    workspaceMode: 'cta3d',
    focus: 'bone',
    description: 'Базовый костный рендер.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'bones',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 150,
      vesselHuMax: 520,
      vesselBoost: 0.45,
      boneSuppressTf: 0.2,
      removeTable: true,
      scalarShift: 0,
      opacityGain: 1.08,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 700,
    },
  },
  {
    id: 'bones_2',
    label: 'Кости-2',
    workspaceMode: 'cta3d',
    focus: 'bone',
    description: 'Костный режим с более выраженной кортикальной костью.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'bones-rich',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 150,
      vesselHuMax: 800,
      vesselBoost: 0.5,
      boneSuppressTf: 0.1,
      removeTable: true,
      scalarShift: 10,
      opacityGain: 1.12,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 700,
    },
  },
  {
    id: 'bones_3',
    label: 'Кости-3',
    workspaceMode: 'cta3d',
    focus: 'bone',
    description: 'Плотный костный режим с более контрастным фоном мягких тканей.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'bones-rich',
      suppressBone: false,
      hardBoneCut: false,
      vesselOnly: false,
      vesselHuMin: 120,
      vesselHuMax: 1000,
      vesselBoost: 0.55,
      boneSuppressTf: 0.15,
      removeTable: true,
      scalarShift: 24,
      opacityGain: 1.16,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 700,
    },
  },
  {
    id: 'abdomen_soft',
    label: 'Брюшная полость',
    workspaceMode: 'cta3d',
    focus: 'soft_tissue',
    description: 'Мягкие ткани брюшной полости.',
    settings: {
      blendMode: 'composite',
      colormapStyle: 'vascular',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: false,
      vesselHuMin: 120,
      vesselHuMax: 500,
      vesselBoost: 0.52,
      boneSuppressTf: 0.86,
      removeTable: true,
      scalarShift: -40,
      opacityGain: 0.9,
      renderQuality: 'balanced',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
  {
    id: 'brain_vessels',
    label: 'Мозг: сосуды',
    workspaceMode: 'cta3d',
    focus: 'brain',
    description: 'Нейроваскулярный режим с высоким подавлением кости.',
    settings: {
      blendMode: 'mip',
      colormapStyle: 'vascular-isolated',
      suppressBone: true,
      hardBoneCut: true,
      vesselOnly: true,
      vesselHuMin: 120,
      vesselHuMax: 500,
      vesselBoost: 0.9,
      boneSuppressTf: 0.98,
      removeTable: true,
      scalarShift: -6,
      opacityGain: 1.1,
      renderQuality: 'high',
      preservePerivascularCalcium: false,
      calciumHuMin: 650,
    },
  },
] as const

const PRESET_BY_ID: Record<Volume3dPresetId, Volume3dPreset> = Object.fromEntries(
  VOLUME_3D_PRESETS.map((p) => [p.id, p]),
) as Record<Volume3dPresetId, Volume3dPreset>

export function getVolume3dPreset(id: string | null | undefined): Volume3dPreset {
  if (id && id in PRESET_BY_ID) {
    return PRESET_BY_ID[id as Volume3dPresetId]
  }
  return PRESET_BY_ID.cta_aorta
}

export function normalizeVolume3dPresetId(id: string | null | undefined): Volume3dPresetId {
  return getVolume3dPreset(id).id
}

export function defaultVolume3dPresetForWorkspace(workspaceMode: VolumeWorkspaceMode): Volume3dPresetId {
  return workspaceMode === 'airway3d' ? 'lungs_air' : 'cta_aorta'
}
