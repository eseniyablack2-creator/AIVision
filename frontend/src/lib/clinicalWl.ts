/** Клинические пресеты окна/уровня для КТ (типичные W/L). */
export type ClinicalWlPreset = {
  id: string
  label: string
  center: number
  width: number
}

export const CLINICAL_WL_PRESETS: ClinicalWlPreset[] = [
  { id: 'brain', label: 'Мозг', center: 40, width: 80 },
  { id: 'subdural', label: 'Субдураль', center: 75, width: 215 },
  { id: 'stroke', label: 'Ишемия', center: 32, width: 8 },
  { id: 'soft', label: 'Мягкие', center: 40, width: 400 },
  { id: 'abdomen', label: 'Брюшная', center: 40, width: 400 },
  { id: 'liver', label: 'Печень', center: 50, width: 150 },
  { id: 'lung', label: 'Лёгкие', center: -600, width: 1500 },
  { id: 'mediastinum', label: 'Средостение', center: 40, width: 350 },
  { id: 'bone', label: 'Кость', center: 400, width: 1800 },
  { id: 'angio', label: 'Ангио / КТА', center: 300, width: 600 },
  { id: 'vessels', label: 'Сосуды', center: 180, width: 700 },
]
