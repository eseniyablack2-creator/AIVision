/**
 * Клинические режимы просмотра (clinical-requirements.md §4.1).
 * Задают W/L, лёгкую цветовую подсветку в 2D и подсказки по умолчанию.
 */
export type ClinicalToolHint =
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'length'
  | 'angle'
  | 'huRoi'
  | 'huRoiPoly'

export type DiagnosticRgbTint = { r: number; g: number; b: number }

export type ClinicalViewMode = {
  id: string
  label: string
  shortLabel: string
  description: string
  windowCenter: number
  windowWidth: number
  /** Множители к серому в 2D (1 = без изменений). */
  diagnosticTint: DiagnosticRgbTint
  defaultTool: ClinicalToolHint
  /** Рекомендуемый рабочий режим vtk (подсказка; переключение по желанию врача). */
  suggestedWorkspace: 'diagnostic' | 'cta3d' | 'airway3d'
}

export const CLINICAL_VIEW_MODES: ClinicalViewMode[] = [
  {
    id: 'lung',
    label: 'Лёгкие',
    shortLabel: 'Лёг',
    description: 'Очаги, инфильтраты, интерстициальные изменения, эмфизема',
    windowCenter: -600,
    windowWidth: 1500,
    diagnosticTint: { r: 0.98, g: 1, b: 1.02 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'diagnostic',
  },
  {
    id: 'bronchi',
    label: 'Бронхи',
    shortLabel: 'Бр',
    description: 'Просветы, стенки, стенозы, бронхоэктазы',
    windowCenter: -450,
    windowWidth: 1200,
    diagnosticTint: { r: 0.95, g: 1.02, b: 1.05 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'airway3d',
  },
  {
    id: 'soft_tissue',
    label: 'Мягкие ткани',
    shortLabel: 'Мягк',
    description: 'Паренхима, средостение, мягкие структуры',
    windowCenter: 40,
    windowWidth: 400,
    diagnosticTint: { r: 1, g: 1, b: 1 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'diagnostic',
  },
  {
    id: 'bone',
    label: 'Кость',
    shortLabel: 'Кост',
    description: 'Переломы, кортикаль, остеодеструкция',
    windowCenter: 400,
    windowWidth: 1800,
    diagnosticTint: { r: 1.02, g: 1, b: 0.96 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'cta3d',
  },
  {
    id: 'vessels',
    label: 'Сосуды',
    shortLabel: 'Сос',
    description: 'КТА, артерии и вены, стенозы',
    windowCenter: 300,
    windowWidth: 600,
    diagnosticTint: { r: 1.04, g: 0.98, b: 0.96 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'cta3d',
  },
  {
    id: 'heart',
    label: 'Сердце',
    shortLabel: 'Сер',
    description: 'Камеры, крупные сосуды, кальцинаты, перикард',
    windowCenter: 40,
    windowWidth: 350,
    diagnosticTint: { r: 1.02, g: 0.98, b: 0.98 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'diagnostic',
  },
  {
    id: 'aorta_oas',
    label: 'Аорта · ОАС',
    shortLabel: 'ОАС',
    description:
      'Неконтрастное КТ: средостение и стенка аорты (мягкотканное окно). Скрининг острого аортального синдрома — по ответу сервера aorticSyndromeScreening (модель / CDSS).',
    windowCenter: 40,
    windowWidth: 400,
    diagnosticTint: { r: 1.01, g: 0.99, b: 1.01 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'diagnostic',
  },
  {
    id: 'joints',
    label: 'Суставы',
    shortLabel: 'Суст',
    description: 'Суставные поверхности, костные контуры',
    windowCenter: 300,
    windowWidth: 1500,
    diagnosticTint: { r: 1.01, g: 1, b: 0.98 },
    defaultTool: 'windowLevel',
    suggestedWorkspace: 'cta3d',
  },
  {
    id: 'tumor',
    label: 'Опухоль / масса',
    shortLabel: 'Опух',
    description: 'Поиск масс, границы, измерения',
    windowCenter: 40,
    windowWidth: 350,
    diagnosticTint: { r: 1, g: 0.99, b: 1.02 },
    defaultTool: 'length',
    suggestedWorkspace: 'diagnostic',
  },
]

export function getClinicalViewMode(id: string): ClinicalViewMode | undefined {
  return CLINICAL_VIEW_MODES.find((m) => m.id === id)
}
