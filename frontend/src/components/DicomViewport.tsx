import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DicomSeries } from '../lib/dicom'
import { CLINICAL_WL_PRESETS } from '../lib/clinicalWl'
import {
  CLINICAL_VIEW_MODES,
  getClinicalViewMode,
  type DiagnosticRgbTint,
} from '../lib/clinicalViewModes'
import { decodeDicomSlice, clearCornerstoneFileManager } from '../lib/dicomSliceLoader'
import { zipFilesAsAnonymous, downloadBlob } from '../lib/anonymizeExport'
import { buildViewportSecondaryCaptureBlob } from '../lib/exportSecondaryCapture'
import { formatAxialAnnotationSummary } from '../lib/viewportAnnotationExport'
import { computeHuPolygonRoiStats, computeHuRoiStats } from '../lib/huRoiStats'
import {
  analyzeSlicePathology,
  buildCtScreenPayload,
  focalPointForPathologyEmphasis,
  getFindingMetaForClass,
  PathologyClass,
  runVolumePathologyScan,
  type PathologyClassId,
} from '../lib/ctPathologyScreen'
import {
  applyLungQuantFromApi,
  fetchCtScreenInference,
  mergeCtScreenResponse,
} from '../lib/ctInferenceApi'
import type {
  AorticSyndromeScreeningV1,
  CtScreenMasksV1,
  CtScreenMaskSpatialV1,
  TotalsegAortaHuStatsV1,
} from '../lib/ctInferenceTypes'
import { runLungVolumeQuantification, type LungVolumeQuantReport } from '../lib/ctLungQuantification'
import { getPathologyRemoteApiBase } from '../lib/pathologyRemote'
import { loadWorkstationPrefs, saveWorkstationPrefs } from '../lib/sessionPrefs'
import { estimateTableCutRowsForSlices } from '../lib/ctTableMask'
import type { VolumePickPayload } from '../lib/volumePickTypes'
import type { SimilarCasesFocusContext } from '../lib/similarCasesMock'
import {
  Icon2D,
  IconAirways,
  IconCollapse,
  IconCTA3D,
  IconExpand,
  IconExport,
  IconFlipH,
  IconFlipV,
  IconAngle,
  IconHuRoi,
  IconHuRoiPoly,
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconInterp2d,
  IconLayout1,
  IconLayoutGrid,
  IconLayoutMPR,
  IconPan,
  IconPlaneAxial,
  IconPlaneCoronal,
  IconPlaneSagittal,
  IconPlayPause,
  IconReset,
  IconRuler,
  IconSave,
  IconSeg,
  IconSnapshot,
  IconSecondaryCapture,
  IconTags,
  IconWL,
  IconZoom,
} from './WorkstationIcons'
import { DicomTagsModal } from './DicomTagsModal'
import { EnterpriseVolume3DViewport, type EnterpriseVolumePresetId } from './EnterpriseVolume3DViewport'

type ToolMode = 'windowLevel' | 'pan' | 'zoom' | 'length' | 'angle' | 'huRoi' | 'huRoiPoly'
type LayoutMode = 'single' | 'grid' | 'mpr'
type WorkspaceMode = 'diagnostic' | 'cta3d' | 'airway3d'
type VolumeNavigationMode = 'rotate' | 'pan'
export type ViewportKind = 'axial' | 'coronal' | 'sagittal' | 'axialAlt'

export type ViewportState = {
  zoom: number
  panX: number
  panY: number
  /** Зеркало слева-направо при отрисовке 2D (LR) */
  flipH: boolean
  /** Зеркало сверху-вниз */
  flipV: boolean
}

/** Снимок режима окна для инициализации связки при открытии сравнения (основная колонка). */
export type ComparisonWorkbenchProbeState = {
  clinicalViewModeId: string
  presetId: string
  windowCenter: number
  windowWidth: number
}

/** Синхронизация среза, W/L, креста, pan/zoom и пресета окна между двумя viewer (clinical-requirements §3). */
export type DicomComparisonSync = {
  linkedSliceIndex: number
  onLinkedSliceIndexChange: (z: number) => void
  linkedWindowCenter: number
  linkedWindowWidth: number
  onLinkedWindowChange: (center: number, width: number) => void
  linkedClinicalViewModeId: string
  onLinkedClinicalViewModeChange: (id: string) => void
  linkedPresetId: string
  onLinkedPresetIdChange: (id: string) => void
  linkedCrosshairX: number
  linkedCrosshairY: number
  onLinkedCrosshairPatch: (patch: Partial<{ x: number; y: number }>) => void
  linkedViewportStates: Record<ViewportKind, ViewportState>
  onLinkedViewportStatesChange: (next: Record<ViewportKind, ViewportState>) => void
}

type Props = {
  activeSeries: DicomSeries | null
  /** Optional native (non-contrast) series for strict vessels presets in 3D. */
  nativeSeries?: DicomSeries | null
  /** All series of the currently loaded study (for native series selection). */
  allSeries?: DicomSeries[]
  /** Selected native series UID (same-study). */
  nativeSeriesUid?: string
  onNativeSeriesUidChange?: (uid: string) => void
  comparisonSync?: DicomComparisonSync | null
  /** Ключ пары серий: однократное центрирование креста при открытии сравнения */
  comparisonSessionKey?: string | null
  /** Подпись «Текущее» / «Сравнение» над контекстом серии */
  viewerLabel?: string
  /** Только у основной колонки: передавать фокус (срез + HU) для модуля похожих случаев */
  onReportViewerFocus?: (ctx: SimilarCasesFocusContext) => void
  /** Только у основной колонки: текущий режим/пресет/W/L для старта связки при открытии сравнения */
  comparisonWorkbenchProbe?: (state: ComparisonWorkbenchProbeState) => void
  /** Не обрабатывать глобальные хоткеи (например, пока открыта блокирующая модалка) */
  suspendGlobalShortcuts?: boolean
}

type LoadedFrame = {
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  sliceThickness: number
  spacingBetweenSlices: number
  imagePositionZ: number | null
  windowCenter: number
  windowWidth: number
  huPixels: Float32Array
  photometricInterpretation: string
}

type Point = {
  x: number
  y: number
}

type ViewportImage = {
  width: number
  height: number
  worldWidth: number
  worldHeight: number
  pixels: Float32Array
}

type Crosshair = {
  x: number
  y: number
  z: number
}

/** Фокус скрининга: срез + точка на маске (не заливка всего поля). */
type PathologyEmphasisFocus = { z: number; col: number; row: number }

type PaneRect = {
  left: number
  top: number
  width: number
  height: number
}

type PaneMap = Record<ViewportKind, PaneRect>

const TOOL_ITEMS: Array<{ id: ToolMode; title: string }> = [
  { id: 'windowLevel', title: 'Окно / уровень (WL)' },
  { id: 'pan', title: 'Сдвиг' },
  { id: 'zoom', title: 'Масштаб' },
  { id: 'length', title: 'Линейка' },
  {
    id: 'angle',
    title: 'Угол: 3 клика — конец 1-го луча, вершина, конец 2-го луча (∠ в вершине)',
  },
  { id: 'huRoi', title: 'ROI: средний HU по срезу (прямоугольник)' },
  { id: 'huRoiPoly', title: 'ROI: полигон HU (клик — вершины, 2×ЛКМ или замкнуть у первой)' },
]

const LAYOUT_ITEMS: Array<{ id: LayoutMode; title: string }> = [
  { id: 'single', title: 'Одно окно' },
  { id: 'grid', title: 'Сетка 2×2' },
  { id: 'mpr', title: 'MPR' },
]

const WINDOW_BUTTONS: Array<{ id: ViewportKind; title: string }> = [
  { id: 'axial', title: 'Аксиальный' },
  { id: 'coronal', title: 'Корональный' },
  { id: 'sagittal', title: 'Сагиттальный' },
]

const WORKSPACE_ITEMS: Array<{ id: WorkspaceMode; title: string }> = [
  { id: 'diagnostic', title: '2D / MPR' },
  { id: 'cta3d', title: 'CTA 3D объём' },
  { id: 'airway3d', title: 'Дыхательные пути (minIP)' },
]

function getClinicalWindow(presetId: string) {
  const p = CLINICAL_WL_PRESETS.find((item) => item.id === presetId)
  return p ?? CLINICAL_WL_PRESETS[0]
}

function resolveWindowForSeries(clinicalViewModeId: string, presetId: string) {
  const mode = getClinicalViewMode(clinicalViewModeId)
  if (mode) {
    return { center: mode.windowCenter, width: mode.windowWidth }
  }
  const p = getClinicalWindow(presetId)
  return { center: p.center, width: p.width }
}

function toolIcon(id: ToolMode) {
  const c = 'toolbar-svg'
  if (id === 'windowLevel') return <IconWL className={c} />
  if (id === 'pan') return <IconPan className={c} />
  if (id === 'zoom') return <IconZoom className={c} />
  if (id === 'length') return <IconRuler className={c} />
  if (id === 'angle') return <IconAngle className={c} />
  if (id === 'huRoi') return <IconHuRoi className={c} />
  return <IconHuRoiPoly className={c} />
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pathologyEmphasisFromSlice(
  frames: LoadedFrame[],
  z: number,
  preferClassId?: PathologyClassId,
): PathologyEmphasisFocus | null {
  if (frames.length === 0) return null
  const zi = clamp(z, 0, frames.length - 1)
  const fr = frames[zi]
  if (!fr || fr.huPixels.length !== fr.columns * fr.rows) {
    const cols = fr?.columns ?? 1
    const rows = fr?.rows ?? 1
    return { z: zi, col: Math.floor(cols / 2), row: Math.floor(rows / 2) }
  }
  const analysis = analyzeSlicePathology(fr.huPixels, fr.columns, fr.rows)
  const pt = focalPointForPathologyEmphasis(analysis, { preferClassId })
  const col = pt ? clamp(pt.col, 0, fr.columns - 1) : Math.floor(fr.columns / 2)
  const row = pt ? clamp(pt.row, 0, fr.rows - 1) : Math.floor(fr.rows / 2)
  return { z: zi, col, row }
}

/** Угол в вершине b между лучами b→a и b→c (градусы, плоскость среза). */
function angleAtVertexDeg(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const len1 = Math.hypot(v1x, v1y)
  const len2 = Math.hypot(v2x, v2y)
  if (len1 < 1e-9 || len2 < 1e-9) return Number.NaN
  const cos = clamp((v1x * v2x + v1y * v2y) / (len1 * len2), -1, 1)
  return (Math.acos(cos) * 180) / Math.PI
}

function getInitialViewportState(): ViewportState {
  return { zoom: 1, panX: 0, panY: 0, flipH: false, flipV: false }
}

export function createInitialViewportStatesRecord(): Record<ViewportKind, ViewportState> {
  const s = getInitialViewportState()
  return {
    axial: { ...s },
    coronal: { ...s },
    sagittal: { ...s },
    axialAlt: { ...s },
  }
}

function getCanvasCursor(tool: ToolMode, spaceDown: boolean) {
  if (spaceDown) return 'cursor-pan'
  if (tool === 'pan') return 'cursor-pan'
  if (tool === 'zoom') return 'cursor-zoom'
  if (tool === 'length') return 'cursor-length'
  if (tool === 'angle') return 'cursor-angle'
  if (tool === 'huRoi') return 'cursor-huRoi'
  if (tool === 'huRoiPoly') return 'cursor-huRoi'
  return 'cursor-wl'
}

function isZoomHotkey(code: string) {
  return code === 'Equal' || code === 'NumpadAdd' || code === 'Minus' || code === 'NumpadSubtract'
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[middle]
}

async function loadFrame(file: File): Promise<LoadedFrame> {
  const d = await decodeDicomSlice(file)
  return {
    rows: d.rows,
    columns: d.columns,
    pixelSpacingX: d.pixelSpacingX,
    pixelSpacingY: d.pixelSpacingY,
    sliceThickness: d.sliceThickness,
    spacingBetweenSlices: d.spacingBetweenSlices,
    imagePositionZ: d.imagePositionZ,
    windowCenter: d.windowCenter,
    windowWidth: d.windowWidth,
    huPixels: d.huPixels,
    photometricInterpretation: d.photometricInterpretation,
  }
}

function buildImageData(
  width: number,
  height: number,
  pixels: Float32Array,
  photometricInterpretation: string,
  windowCenter: number,
  windowWidth: number,
  colorMode: WorkspaceMode,
  diagnosticTint?: DiagnosticRgbTint | null,
) {
  const imageData = new ImageData(width, height)
  const output = imageData.data
  const minValue = windowCenter - windowWidth / 2
  const maxValue = windowCenter + windowWidth / 2
  const range = Math.max(maxValue - minValue, 1)
  const invert = photometricInterpretation === 'MONOCHROME1'
  const tr = diagnosticTint?.r ?? 1
  const tg = diagnosticTint?.g ?? 1
  const tb = diagnosticTint?.b ?? 1

  for (let index = 0; index < pixels.length; index += 1) {
    const normalized = clamp((pixels[index] - minValue) / range, 0, 1)
    const gray = Math.round((invert ? 1 - normalized : normalized) * 255)
    const offset = index * 4
    if (colorMode === 'cta3d') {
      output[offset] = Math.min(255, Math.round(gray * 1.06))
      output[offset + 1] = Math.min(255, Math.round(gray * 0.92))
      output[offset + 2] = Math.min(255, Math.round(gray * 0.72))
    } else if (colorMode === 'airway3d') {
      output[offset] = Math.round(gray * 0.74)
      output[offset + 1] = Math.round(gray * 0.84)
      output[offset + 2] = Math.min(255, Math.round(gray * 1.06))
    } else {
      output[offset] = clamp(Math.round(gray * tr), 0, 255)
      output[offset + 1] = clamp(Math.round(gray * tg), 0, 255)
      output[offset + 2] = clamp(Math.round(gray * tb), 0, 255)
    }
    output[offset + 3] = 255
  }

  return imageData
}

function buildAxialPixels(frame: LoadedFrame): ViewportImage {
  return {
    width: frame.columns,
    height: frame.rows,
    worldWidth: frame.columns * frame.pixelSpacingX,
    worldHeight: frame.rows * frame.pixelSpacingY,
    pixels: frame.huPixels,
  }
}

function buildCoronalPixels(
  frames: LoadedFrame[],
  rowIndex: number,
  zSpacing: number,
): ViewportImage {
  const depth = frames.length
  const columns = frames[0].columns
  const rows = frames[0].rows
  const y = clamp(rowIndex, 0, rows - 1)
  const out = new Float32Array(depth * columns)

  for (let z = 0; z < depth; z += 1) {
    const frame = frames[z]
    const targetRow = depth - 1 - z
    for (let x = 0; x < columns; x += 1) {
      out[targetRow * columns + x] = frame.huPixels[y * columns + x]
    }
  }

  return {
    width: columns,
    height: depth,
    worldWidth: columns * frames[0].pixelSpacingX,
    worldHeight: depth * zSpacing,
    pixels: out,
  }
}

function buildSagittalPixels(
  frames: LoadedFrame[],
  columnIndex: number,
  zSpacing: number,
): ViewportImage {
  const depth = frames.length
  const columns = frames[0].columns
  const rows = frames[0].rows
  const x = clamp(columnIndex, 0, columns - 1)
  const out = new Float32Array(depth * rows)

  for (let z = 0; z < depth; z += 1) {
    const frame = frames[z]
    const targetRow = depth - 1 - z
    for (let y = 0; y < rows; y += 1) {
      out[targetRow * rows + y] = frame.huPixels[y * columns + x]
    }
  }

  return {
    width: rows,
    height: depth,
    worldWidth: rows * frames[0].pixelSpacingY,
    worldHeight: depth * zSpacing,
    pixels: out,
  }
}

/** Строка по вертикали MPR cor/sag: кадр z кладётся в строку zEnd - z (см. buildCoronalPixels). */
function axialSliceZToMprRow(sliceZ: number, zStart: number, zEnd: number): number {
  const z = clamp(sliceZ, zStart, zEnd)
  return zEnd - z
}

function mprRowToAxialSliceZ(row: number, zStart: number, zEnd: number): number {
  const depth = zEnd - zStart + 1
  if (depth <= 0) return clamp(Math.round(row), 0, 0)
  const r = clamp(Math.round(row), 0, depth - 1)
  return zEnd - r
}

function passesThreshold(value: number, min: number, max: number) {
  return value >= min && value <= max
}

function buildAxialProjection(
  frames: LoadedFrame[],
  startZ: number,
  endZ: number,
  mode: 'mip' | 'minip',
  minThreshold: number,
  maxThreshold: number,
  tableCutRows: number,
): ViewportImage {
  const rows = frames[0].rows
  const columns = frames[0].columns
  const visibleRows = Math.max(1, rows - tableCutRows)
  const out = new Float32Array(visibleRows * columns)
  const fallback = mode === 'mip' ? -1024 : 1024
  out.fill(fallback)

  for (let z = startZ; z <= endZ; z += 1) {
    const frame = frames[z]
    for (let y = 0; y < visibleRows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const sourceIndex = y * columns + x
        const targetIndex = y * columns + x
        const value = frame.huPixels[sourceIndex]
        if (!passesThreshold(value, minThreshold, maxThreshold)) continue

        if (mode === 'mip') {
          if (value > out[targetIndex]) out[targetIndex] = value
        } else if (value < out[targetIndex]) {
          out[targetIndex] = value
        }
      }
    }
  }

  return {
    width: columns,
    height: visibleRows,
    worldWidth: columns * frames[0].pixelSpacingX,
    worldHeight: visibleRows * frames[0].pixelSpacingY,
    pixels: out,
  }
}

function buildCoronalProjection(
  frames: LoadedFrame[],
  startZ: number,
  endZ: number,
  mode: 'mip' | 'minip',
  minThreshold: number,
  maxThreshold: number,
  tableCutRows: number,
  zSpacing: number,
): ViewportImage {
  const visibleRows = Math.max(1, frames[0].rows - tableCutRows)
  const columns = frames[0].columns
  const depth = endZ - startZ + 1
  const out = new Float32Array(depth * columns)
  const fallback = mode === 'mip' ? -1024 : 1024
  out.fill(fallback)

  for (let z = startZ; z <= endZ; z += 1) {
    const frame = frames[z]
    const outRow = endZ - z
    for (let x = 0; x < columns; x += 1) {
      for (let y = 0; y < visibleRows; y += 1) {
        const value = frame.huPixels[y * columns + x]
        if (!passesThreshold(value, minThreshold, maxThreshold)) continue
        const outIndex = outRow * columns + x

        if (mode === 'mip') {
          if (value > out[outIndex]) out[outIndex] = value
        } else if (value < out[outIndex]) {
          out[outIndex] = value
        }
      }
    }
  }

  return {
    width: columns,
    height: depth,
    worldWidth: columns * frames[0].pixelSpacingX,
    worldHeight: depth * zSpacing,
    pixels: out,
  }
}

function buildSagittalProjection(
  frames: LoadedFrame[],
  startZ: number,
  endZ: number,
  mode: 'mip' | 'minip',
  minThreshold: number,
  maxThreshold: number,
  tableCutRows: number,
  zSpacing: number,
): ViewportImage {
  const visibleRows = Math.max(1, frames[0].rows - tableCutRows)
  const columns = frames[0].columns
  const depth = endZ - startZ + 1
  const out = new Float32Array(depth * visibleRows)
  const fallback = mode === 'mip' ? -1024 : 1024
  out.fill(fallback)

  for (let z = startZ; z <= endZ; z += 1) {
    const frame = frames[z]
    const outRow = endZ - z
    for (let y = 0; y < visibleRows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const value = frame.huPixels[y * columns + x]
        if (!passesThreshold(value, minThreshold, maxThreshold)) continue
        const outIndex = outRow * visibleRows + y

        if (mode === 'mip') {
          if (value > out[outIndex]) out[outIndex] = value
        } else if (value < out[outIndex]) {
          out[outIndex] = value
        }
      }
    }
  }

  return {
    width: visibleRows,
    height: depth,
    worldWidth: visibleRows * frames[0].pixelSpacingY,
    worldHeight: depth * zSpacing,
    pixels: out,
  }
}

export function DicomViewport({
  activeSeries,
  nativeSeries = null,
  allSeries = [],
  nativeSeriesUid = '',
  onNativeSeriesUidChange,
  comparisonSync = null,
  comparisonSessionKey = null,
  viewerLabel,
  onReportViewerFocus,
  comparisonWorkbenchProbe,
  suspendGlobalShortcuts = false,
}: Props) {
  const suspendGlobalShortcutsRef = useRef(false)
  suspendGlobalShortcutsRef.current = suspendGlobalShortcuts

  const viewerAreaRef = useRef<HTMLDivElement | null>(null)
  const axialRef = useRef<HTMLCanvasElement | null>(null)
  const coronalRef = useRef<HTMLCanvasElement | null>(null)
  const sagittalRef = useRef<HTMLCanvasElement | null>(null)
  const axialAltRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const dragWindowRef = useRef({ center: 40, width: 400 })
  const comparisonSyncRef = useRef<DicomComparisonSync | null>(null)
  comparisonSyncRef.current = comparisonSync
  /** Запуск сканирования после появления кадров, если пользователь нажал до окончания загрузки серии. */
  const pathologyScanPendingRef = useRef(false)
  const pathologyAbortRef = useRef<AbortController | null>(null)
  const runPathologyVolumeScanRef = useRef<() => void | Promise<void>>(() => {})
  const dragViewportRef = useRef<ViewportState>(getInitialViewportState())
  const measurementStartRef = useRef<Point | null>(null)
  const lengthSliceZRef = useRef(0)
  const huRoiStartRef = useRef<Point | null>(null)
  const huRoiSliceZRef = useRef(0)
  const resizeModeRef = useRef<null | 'mprVertical' | 'mprHorizontal' | 'gridX' | 'gridY'>(
    null,
  )
  /** Последняя успешно загруженная серия (uid + число файлов) — не перегружать кадры при новой ссылке на тот же объект React. */
  const loadedSeriesKeyRef = useRef<string>('')
  const sliceZRef = useRef(0)
  const pathologyScanStartSliceZRef = useRef(0)

  const [activeTool, setActiveTool] = useState<ToolMode>('windowLevel')
  const [presetId, setPresetId] = useState(() => loadWorkstationPrefs().presetId)
  const [clinicalViewModeId, setClinicalViewModeId] = useState(
    () => loadWorkstationPrefs().clinicalViewModeId ?? 'soft_tissue',
  )
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    () => loadWorkstationPrefs().workspaceMode,
  )
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadWorkstationPrefs().layoutMode)
  const [clipStart, setClipStart] = useState(() => loadWorkstationPrefs().clipStart)
  const [clipEnd, setClipEnd] = useState(() => loadWorkstationPrefs().clipEnd)
  const [clipPlaneX, setClipPlaneX] = useState(0)
  const [clipPlaneY, setClipPlaneY] = useState(0)
  const [clipPlaneZ, setClipPlaneZ] = useState(0)
  const [removeTable, _setRemoveTable] = useState(() => loadWorkstationPrefs().removeTable)
  const [suppressBone, _setSuppressBone] = useState(() => loadWorkstationPrefs().suppressBone)
  const [vesselBoost, _setVesselBoost] = useState(() => loadWorkstationPrefs().vesselBoost)
  const [boneSuppressTf, _setBoneSuppressTf] = useState(() => loadWorkstationPrefs().boneSuppress)
  const [segEnabled, setSegEnabled] = useState(() => loadWorkstationPrefs().segEnabled)
  const [segHuMin, setSegHuMin] = useState(() => loadWorkstationPrefs().segHuMin)
  const [segHuMax, setSegHuMax] = useState(() => loadWorkstationPrefs().segHuMax)
  const [toolPanelCollapsed, setToolPanelCollapsed] = useState(false)
  const lastVolumeModeRef = useRef<WorkspaceMode>('cta3d')
  useEffect(() => {
    if (workspaceMode !== 'diagnostic') lastVolumeModeRef.current = workspaceMode
  }, [workspaceMode])

  const [spaceDown, setSpaceDown] = useState(false)
  const tempDragToolRef = useRef<ToolMode | null>(null)
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as any).isContentEditable
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (isTypingTarget(e.target)) return
      if (!spaceDown) setSpaceDown(true)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (spaceDown) setSpaceDown(false)
      tempDragToolRef.current = null
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [spaceDown])

  // Новый 3D-пайплайн (vtk.js volume ray casting): 4 enterprise-пресета.
  const [enterprisePresetId, setEnterprisePresetId] = useState<EnterpriseVolumePresetId>(
    () => loadWorkstationPrefs().enterprise3d?.presetId ?? 'aorta',
  )
  const [enterpriseUseAllSlices, setEnterpriseUseAllSlices] = useState(
    () => loadWorkstationPrefs().enterprise3d?.useAllSlices ?? true,
  )
  const [enterpriseNavigationMode, setEnterpriseNavigationMode] = useState<VolumeNavigationMode>(
    () => loadWorkstationPrefs().enterprise3d?.navigationMode ?? 'rotate',
  )
  const [enterpriseRebuildTick, setEnterpriseRebuildTick] = useState(0)

  const [enterpriseScalarShift, setEnterpriseScalarShift] = useState(
    () => loadWorkstationPrefs().enterprise3d?.scalarShift ?? 0,
  )
  const [enterpriseOpacityGain, setEnterpriseOpacityGain] = useState(
    () => loadWorkstationPrefs().enterprise3d?.opacityGain ?? 1.15,
  )
  const [enterpriseVesselBoost, setEnterpriseVesselBoost] = useState(
    () => loadWorkstationPrefs().enterprise3d?.vesselBoost ?? 0.8,
  )
  const [enterpriseBoneTame, setEnterpriseBoneTame] = useState(
    () => loadWorkstationPrefs().enterprise3d?.boneTame ?? 0.9,
  )
  const [enterpriseRemoveTable, setEnterpriseRemoveTable] = useState(
    () => loadWorkstationPrefs().enterprise3d?.removeTable ?? true,
  )
  const [interpolation2d, setInterpolation2d] = useState(
    () => loadWorkstationPrefs().interpolation2d ?? false,
  )
  const [superCrisp2d, setSuperCrisp2d] = useState(
    () => loadWorkstationPrefs().superCrisp2d ?? true,
  )

  useEffect(() => {
    saveWorkstationPrefs({
      enterprise3d: {
        presetId: enterprisePresetId,
        useAllSlices: enterpriseUseAllSlices,
        navigationMode: enterpriseNavigationMode,
        nativeSeriesUid,
        scalarShift: enterpriseScalarShift,
        opacityGain: enterpriseOpacityGain,
        vesselBoost: enterpriseVesselBoost,
        boneTame: enterpriseBoneTame,
        removeTable: enterpriseRemoveTable,
      },
    })
  }, [
    enterprisePresetId,
    enterpriseUseAllSlices,
    enterpriseNavigationMode,
    nativeSeriesUid,
    enterpriseScalarShift,
    enterpriseOpacityGain,
    enterpriseVesselBoost,
    enterpriseBoneTame,
    enterpriseRemoveTable,
  ])
  /** Управление DVR в vtk: сдвиг шкалы HU и усиление непрозрачности (отдельно от 2D W/L). */
  const [volScalarShift, setVolScalarShift] = useState(0)
  const [volOpacityGain, setVolOpacityGain] = useState(1)
  const [volResetCameraTick, setVolResetCameraTick] = useState(0)
  /** URL multilabel NIfTI (например ответ inference masks.nifti_url) для оверлея в vtk. */
  const [volumeMaskUrl, setVolumeMaskUrl] = useState<string | null>(null)
  /** Метаданные маски с сервера (outputGrid, hintRu) — сброс при смене серии. */
  const [volumeMaskServerMeta, setVolumeMaskServerMeta] = useState<CtScreenMasksV1 | null>(null)
  /** Скрининг ОАС по ответу POST /v1/ct-screen (модель или демо-сервер). */
  const [aorticScreening, setAorticScreening] = useState<AorticSyndromeScreeningV1 | null>(null)
  /** Статистики HU в маске аорты после TotalSegmentator (поле totalsegAortaHuStats). */
  const [totalsegAortaHuStats, setTotalsegAortaHuStats] = useState<TotalsegAortaHuStatsV1 | null>(
    null,
  )
  const [volumeMaskOpacity, setVolumeMaskOpacity] = useState(0.42)
  const [pathologyVolumeResult, setPathologyVolumeResult] = useState<
    ReturnType<typeof runVolumePathologyScan>
  >(null)
  const [pathologyScanRunning, setPathologyScanRunning] = useState(false)
  const [pathologyPopupOpen, setPathologyPopupOpen] = useState(false)
  /** Точка на срезе и подпись находок (после «Перейти к находке»). */
  const [pathologyEmphasis, setPathologyEmphasis] = useState<PathologyEmphasisFocus | null>(null)
  const [lungQuantReport, setLungQuantReport] = useState<LungVolumeQuantReport | null>(null)
  const [pathologyTooltip, setPathologyTooltip] = useState<{
    viewport: ViewportKind
    classId: PathologyClassId
    label: string
    organSystem: string
    summary: string
    details: string
    left: number
    top: number
  } | null>(null)
  const [expandedViewport, setExpandedViewport] = useState<ViewportKind | null>(null)
  const [viewerError, setViewerError] = useState('')
  const [frames, setFrames] = useState<LoadedFrame[]>([])
  const [crosshair, setCrosshair] = useState<Crosshair>({ x: 0, y: 0, z: 0 })
  const [windowCenter, setWindowCenter] = useState(40)
  const [windowWidth, setWindowWidth] = useState(400)
  const [activeViewport, setActiveViewport] = useState<ViewportKind>('axial')
  const [singleViewport, setSingleViewport] = useState<ViewportKind>('axial')
  const [viewportStates, setViewportStates] = useState<Record<ViewportKind, ViewportState>>({
    axial: getInitialViewportState(),
    coronal: getInitialViewportState(),
    sagittal: getInitialViewportState(),
    axialAlt: getInitialViewportState(),
  })
  const [measurement, setMeasurement] = useState<{
    start: Point
    end: Point
    sliceZ: number
  } | null>(null)
  const [measurementPreview, setMeasurementPreview] = useState<Point | null>(null)
  const [huRoiRect, setHuRoiRect] = useState<{ start: Point; end: Point; sliceZ: number } | null>(null)
  const [huRoiPreview, setHuRoiPreview] = useState<Point | null>(null)
  const [huRoiPolyPoints, setHuRoiPolyPoints] = useState<Point[]>([])
  const [huRoiPolyDraftSliceZ, setHuRoiPolyDraftSliceZ] = useState<number | null>(null)
  const [huRoiPolyFinal, setHuRoiPolyFinal] = useState<{ points: Point[]; sliceZ: number } | null>(null)
  const [huRoiPolyHover, setHuRoiPolyHover] = useState<Point | null>(null)
  /** Угол: последовательность точек A–B–C, угол в B между BA и BC. */
  const [anglePoints, setAnglePoints] = useState<Point[]>([])
  const [angleDraftSliceZ, setAngleDraftSliceZ] = useState<number | null>(null)
  const [angleFinal, setAngleFinal] = useState<{
    a: Point
    b: Point
    c: Point
    sliceZ: number
  } | null>(null)
  const [angleHover, setAngleHover] = useState<Point | null>(null)
  const [viewerSize, setViewerSize] = useState({ width: 900, height: 640 })
  const [mprVerticalSplit, setMprVerticalSplit] = useState(0.72)
  const [mprHorizontalSplit, setMprHorizontalSplit] = useState(0.5)
  const [gridSplitX, setGridSplitX] = useState(0.58)
  const [gridSplitY, setGridSplitY] = useState(0.52)
  const [tagsModalOpen, setTagsModalOpen] = useState(false)
  const [cinePlaying, setCinePlaying] = useState(false)

  const clinicalViewModeIdActive = comparisonSync?.linkedClinicalViewModeId ?? clinicalViewModeId
  const presetIdActive = comparisonSync?.linkedPresetId ?? presetId

  const clinicalMode = useMemo(
    () => getClinicalViewMode(clinicalViewModeIdActive) ?? CLINICAL_VIEW_MODES[2],
    [clinicalViewModeIdActive],
  )

  const applyWorkspaceMode = useCallback(
    (id: WorkspaceMode) => {
      setWorkspaceMode(id)
      setExpandedViewport(null)
      setCinePlaying(false)
      if (id !== 'diagnostic') {
        setLayoutMode('mpr')
        const nextPreset = id === 'cta3d' ? 'vessels' : 'lung'
        setPresetId(nextPreset)
        comparisonSync?.onLinkedPresetIdChange(nextPreset)
        setEnterprisePresetId(id === 'cta3d' ? 'aorta' : 'lungs')
      }
    },
    [comparisonSync],
  )

  const sliceZ = useMemo(() => {
    const raw = comparisonSync ? comparisonSync.linkedSliceIndex : crosshair.z
    return clamp(raw, 0, Math.max(0, frames.length - 1))
  }, [comparisonSync, comparisonSync?.linkedSliceIndex, crosshair.z, frames.length])

  useEffect(() => {
    sliceZRef.current = sliceZ
  }, [sliceZ])

  const effectiveViewportStates = useMemo((): Record<ViewportKind, ViewportState> => {
    if (comparisonSync) return comparisonSync.linkedViewportStates
    return viewportStates
  }, [comparisonSync, comparisonSync?.linkedViewportStates, viewportStates])

  const effectiveCrosshair = useMemo((): Crosshair => {
    if (!comparisonSync || frames.length === 0) {
      return { x: crosshair.x, y: crosshair.y, z: sliceZ }
    }
    const cols = frames[0].columns
    const rows = frames[0].rows
    return {
      x: clamp(comparisonSync.linkedCrosshairX, 0, cols - 1),
      y: clamp(comparisonSync.linkedCrosshairY, 0, rows - 1),
      z: sliceZ,
    }
  }, [
    comparisonSync,
    comparisonSync?.linkedCrosshairX,
    comparisonSync?.linkedCrosshairY,
    crosshair.x,
    crosshair.y,
    sliceZ,
    frames,
  ])

  const displayWindowCenter = comparisonSync?.linkedWindowCenter ?? windowCenter
  const displayWindowWidth = comparisonSync?.linkedWindowWidth ?? windowWidth

  useEffect(() => {
    if (!comparisonSync) return
    const { linkedClinicalViewModeId: lc, linkedPresetId: lp } = comparisonSync
    setClinicalViewModeId(lc)
    setPresetId(lp)
  }, [comparisonSync, comparisonSync?.linkedClinicalViewModeId, comparisonSync?.linkedPresetId])

  useLayoutEffect(() => {
    if (!comparisonWorkbenchProbe) return
    comparisonWorkbenchProbe({
      clinicalViewModeId: comparisonSync?.linkedClinicalViewModeId ?? clinicalViewModeId,
      presetId: comparisonSync?.linkedPresetId ?? presetId,
      windowCenter: comparisonSync?.linkedWindowCenter ?? windowCenter,
      windowWidth: comparisonSync?.linkedWindowWidth ?? windowWidth,
    })
  }, [
    comparisonWorkbenchProbe,
    clinicalViewModeId,
    presetId,
    windowCenter,
    windowWidth,
    comparisonSync?.linkedClinicalViewModeId,
    comparisonSync?.linkedPresetId,
    comparisonSync?.linkedWindowCenter,
    comparisonSync?.linkedWindowWidth,
    comparisonSync,
  ])

  useEffect(() => {
    if (!comparisonSync) return
    setCrosshair((ch) => {
      if (frames.length === 0) return ch
      const cols = frames[0].columns
      const rows = frames[0].rows
      const nx = clamp(comparisonSync.linkedCrosshairX, 0, cols - 1)
      const ny = clamp(comparisonSync.linkedCrosshairY, 0, rows - 1)
      if (ch.x === nx && ch.y === ny && ch.z === sliceZ) return ch
      return { x: nx, y: ny, z: sliceZ }
    })
  }, [
    comparisonSync,
    comparisonSync?.linkedCrosshairX,
    comparisonSync?.linkedCrosshairY,
    sliceZ,
    frames,
  ])

  const comparisonSeedKeyRef = useRef('')
  useEffect(() => {
    if (!comparisonSessionKey) comparisonSeedKeyRef.current = ''
  }, [comparisonSessionKey])

  useEffect(() => {
    if (!comparisonSync || !comparisonSessionKey || frames.length === 0) return
    if (viewerLabel !== 'Текущая серия') return
    if (comparisonSeedKeyRef.current === comparisonSessionKey) return
    comparisonSeedKeyRef.current = comparisonSessionKey
    const cx = Math.floor(frames[0].columns / 2)
    const cy = Math.floor(frames[0].rows / 2)
    comparisonSync.onLinkedCrosshairPatch({ x: cx, y: cy })
    comparisonSync.onLinkedSliceIndexChange(Math.floor(frames.length / 2))
  }, [comparisonSync, comparisonSessionKey, frames, viewerLabel])

  const cineLinkedSliceRef = useRef(0)
  useEffect(() => {
    cineLinkedSliceRef.current = comparisonSync?.linkedSliceIndex ?? 0
  }, [comparisonSync?.linkedSliceIndex])

  useEffect(() => {
    if (!cinePlaying || frames.length === 0 || workspaceMode !== 'diagnostic') {
      return
    }
    const fps = 9
    const id = window.setInterval(() => {
      const n = frames.length
      if (n <= 1) return
      if (comparisonSync) {
        const z = (cineLinkedSliceRef.current + 1) % n
        cineLinkedSliceRef.current = z
        comparisonSync.onLinkedSliceIndexChange(z)
      } else {
        setCrosshair((c) => ({ ...c, z: (c.z + 1) % n }))
      }
    }, 1000 / fps)
    return () => clearInterval(id)
  }, [cinePlaying, frames.length, workspaceMode, comparisonSync])

  const lastSimilarFocusKeyRef = useRef('')
  useEffect(() => {
    lastSimilarFocusKeyRef.current = ''
  }, [activeSeries?.seriesInstanceUid])

  useEffect(() => {
    if (!onReportViewerFocus || workspaceMode !== 'diagnostic' || frames.length === 0) return
    const fr = frames[sliceZ]
    if (!fr || fr.huPixels.length !== fr.columns * fr.rows) return
    const col = clamp(effectiveCrosshair.x, 0, fr.columns - 1)
    const row = clamp(effectiveCrosshair.y, 0, fr.rows - 1)
    const hu = fr.huPixels[row * fr.columns + col]
    const huStr = Number.isFinite(hu) ? hu.toFixed(0) : ''
    const key = `${sliceZ}\t${col}\t${row}\t${huStr}\t${clinicalViewModeIdActive}\t${displayWindowCenter}\t${displayWindowWidth}`
    if (lastSimilarFocusKeyRef.current === key) return
    lastSimilarFocusKeyRef.current = key
    onReportViewerFocus({
      sliceIndex: sliceZ,
      col,
      row,
      hu: Number.isFinite(hu) ? hu : null,
      clinicalViewModeId: clinicalViewModeIdActive,
      clinicalViewLabel: clinicalMode.label,
      windowCenter: displayWindowCenter,
      windowWidth: displayWindowWidth,
    })
  }, [
    onReportViewerFocus,
    workspaceMode,
    frames,
    sliceZ,
    effectiveCrosshair.x,
    effectiveCrosshair.y,
    clinicalViewModeIdActive,
    clinicalMode.label,
    displayWindowCenter,
    displayWindowWidth,
  ])

  useEffect(() => {
    setVolumeMaskUrl(null)
    setVolumeMaskServerMeta(null)
    setAorticScreening(null)
    setTotalsegAortaHuStats(null)
  }, [activeSeries?.seriesInstanceUid])

  const volumeMaskServerHint = useMemo(() => {
    if (!volumeMaskServerMeta?.url || !volumeMaskUrl) return null
    if (volumeMaskServerMeta.url.trim() !== volumeMaskUrl.trim()) return null
    const parts: string[] = []
    if (volumeMaskServerMeta.engineId) parts.push(volumeMaskServerMeta.engineId)
    const g = volumeMaskServerMeta.outputGrid
    if (g) parts.push(`NIfTI ${g.dim0}×${g.dim1}×${g.dim2}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [volumeMaskServerMeta, volumeMaskUrl])

  const volumeMaskSpatialForViewer = useMemo((): CtScreenMaskSpatialV1 | null => {
    if (!volumeMaskServerMeta?.url || !volumeMaskUrl) return null
    if (volumeMaskServerMeta.url.trim() !== volumeMaskUrl.trim()) return null
    const { coordinateConvention, affineVoxelToWorldRowMajor } = volumeMaskServerMeta
    const hasAffine = affineVoxelToWorldRowMajor?.length === 16
    const hasConv = Boolean(coordinateConvention?.trim().length)
    if (!hasAffine && !hasConv) return null
    return { coordinateConvention, affineVoxelToWorldRowMajor }
  }, [volumeMaskServerMeta, volumeMaskUrl])

  const paneRects = useMemo((): PaneMap => {
    const splitterWidth = 8
    const width = viewerSize.width
    const height = viewerSize.height
    const emptyRect = { left: 0, top: 0, width: 0, height: 0 }

    if (
      expandedViewport &&
      layoutMode === 'mpr' &&
      workspaceMode === 'diagnostic'
    ) {
      if (expandedViewport === 'axial') {
        return {
          axial: { left: 0, top: 0, width, height },
          coronal: emptyRect,
          sagittal: emptyRect,
          axialAlt: emptyRect,
        }
      }
      if (expandedViewport === 'coronal') {
        return {
          axial: emptyRect,
          coronal: { left: 0, top: 0, width, height },
          sagittal: emptyRect,
          axialAlt: emptyRect,
        }
      }
      if (expandedViewport === 'sagittal') {
        return {
          axial: emptyRect,
          coronal: emptyRect,
          sagittal: { left: 0, top: 0, width, height },
          axialAlt: emptyRect,
        }
      }
    }

    if (layoutMode === 'single') {
      const targetViewport = singleViewport === 'axialAlt' ? 'axial' : singleViewport
      const emptyRect = { left: 0, top: 0, width: 0, height: 0 }
      return {
        axial: targetViewport === 'axial' ? { left: 0, top: 0, width, height } : emptyRect,
        coronal: targetViewport === 'coronal' ? { left: 0, top: 0, width, height } : emptyRect,
        sagittal: targetViewport === 'sagittal' ? { left: 0, top: 0, width, height } : emptyRect,
        axialAlt: emptyRect,
      }
    }

    if (layoutMode === 'mpr') {
      const mainWidth = Math.floor((width - splitterWidth) * mprVerticalSplit)
      const stackWidth = width - mainWidth - splitterWidth
      const topHeight = Math.floor((height - splitterWidth) * mprHorizontalSplit)
      const bottomHeight = height - topHeight - splitterWidth

      return {
        axial: { left: 0, top: 0, width: mainWidth, height },
        coronal: {
          left: mainWidth + splitterWidth,
          top: 0,
          width: stackWidth,
          height: topHeight,
        },
        sagittal: {
          left: mainWidth + splitterWidth,
          top: topHeight + splitterWidth,
          width: stackWidth,
          height: bottomHeight,
        },
        axialAlt: { left: 0, top: 0, width: 0, height: 0 },
      }
    }

    const leftWidth = Math.floor((width - splitterWidth) * gridSplitX)
    const rightWidth = width - leftWidth - splitterWidth
    const topHeight = Math.floor((height - splitterWidth) * gridSplitY)
    const bottomHeight = height - topHeight - splitterWidth

    return {
      axial: { left: 0, top: 0, width: leftWidth, height: topHeight },
      coronal: {
        left: leftWidth + splitterWidth,
        top: 0,
        width: rightWidth,
        height: topHeight,
      },
      sagittal: {
        left: 0,
        top: topHeight + splitterWidth,
        width: leftWidth,
        height: bottomHeight,
      },
      axialAlt: {
        left: leftWidth + splitterWidth,
        top: topHeight + splitterWidth,
        width: rightWidth,
        height: bottomHeight,
      },
    }
  }, [
    viewerSize,
    layoutMode,
    singleViewport,
    mprVerticalSplit,
    mprHorizontalSplit,
    gridSplitX,
    gridSplitY,
    expandedViewport,
    workspaceMode,
  ])

  useEffect(() => {
    // Один глобальный wadouri fileManager на всё приложение. В двух колонках сравнения
    // у каждого viewport свой activeSeries: очистка при смене серии в одной колонке
    // удаляла бы записи другой колонки → не все срезы доходили до декодера.
    if (comparisonSync != null) return
    clearCornerstoneFileManager()
  }, [activeSeries?.seriesInstanceUid, comparisonSync])

  useEffect(() => {
    pathologyAbortRef.current?.abort()
    setPathologyVolumeResult(null)
    setPathologyPopupOpen(false)
    setPathologyTooltip(null)
    setPathologyEmphasis(null)
    setLungQuantReport(null)
    pathologyScanPendingRef.current = false
  }, [activeSeries?.seriesInstanceUid])

  useEffect(() => {
    if (layoutMode !== 'mpr') setExpandedViewport(null)
  }, [layoutMode])

  useLayoutEffect(() => {
    if (!viewerAreaRef.current) return
    const element = viewerAreaRef.current
    const syncSize = () => {
      setViewerSize({
        width: Math.max(520, Math.floor(element.clientWidth)),
        height: Math.max(420, Math.floor(element.clientHeight)),
      })
    }
    syncSize()
    const raf = window.requestAnimationFrame(syncSize)
    const timeout = window.setTimeout(syncSize, 80)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timeout)
    }
  }, [toolPanelCollapsed, layoutMode, workspaceMode])

  useEffect(() => {
    if (!viewerAreaRef.current) return

    const element = viewerAreaRef.current
    const updateSize = () => {
      setViewerSize({
        width: Math.max(520, Math.floor(element.clientWidth)),
        height: Math.max(420, Math.floor(element.clientHeight)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  const applyViewportZoom = useCallback(
    (viewport: ViewportKind, delta: number) => {
      const next = {
        ...effectiveViewportStates[viewport],
        zoom: clamp(effectiveViewportStates[viewport].zoom + delta, 0.2, 8),
      }
      if (comparisonSync) {
        comparisonSync.onLinkedViewportStatesChange({
          ...comparisonSync.linkedViewportStates,
          [viewport]: next,
        })
      } else {
        setViewportStates((value) => ({
          ...value,
          [viewport]: next,
        }))
      }
    },
    [comparisonSync, effectiveViewportStates],
  )

  useEffect(() => {
    if (!activeSeries || activeSeries.files.length === 0) {
      loadedSeriesKeyRef.current = ''
      setFrames([])
      setViewerError('')
      return
    }

    const series = activeSeries
    const seriesKey = `${series.seriesInstanceUid}\t${series.files.length}`
    if (seriesKey === loadedSeriesKeyRef.current) {
      return
    }

    let cancelled = false
    const previousKey = loadedSeriesKeyRef.current
    const prevUid = previousKey.split('\t')[0] ?? ''
    const preserveSlicePosition = previousKey !== '' && prevUid === series.seriesInstanceUid

    async function run() {
      try {
        setViewerError('')
        const loaded = await Promise.all(series.files.map((item) => loadFrame(item.file)))

        if (cancelled) return

        const sorted = [...loaded].sort((left, right) => {
          if (left.imagePositionZ !== null && right.imagePositionZ !== null) {
            return left.imagePositionZ - right.imagePositionZ
          }
          return 0
        })

        const first = sorted[0]
        const centerX = Math.floor(first.columns / 2)
        const centerY = Math.floor(first.rows / 2)
        const centerZ = Math.floor(sorted.length / 2)

        loadedSeriesKeyRef.current = seriesKey
        setFrames(sorted)
        const cs = comparisonSyncRef.current
        if (cs) {
          const lx = clamp(cs.linkedCrosshairX, 0, first.columns - 1)
          const ly = clamp(cs.linkedCrosshairY, 0, first.rows - 1)
          const lz = clamp(cs.linkedSliceIndex, 0, sorted.length - 1)
          setCrosshair({ x: lx, y: ly, z: lz })
        } else if (preserveSlicePosition) {
          setCrosshair((ch) => ({
            x: clamp(ch.x, 0, first.columns - 1),
            y: clamp(ch.y, 0, first.rows - 1),
            z: clamp(ch.z, 0, sorted.length - 1),
          }))
        } else {
          setCrosshair({ x: centerX, y: centerY, z: centerZ })
        }
        setClipStart(0)
        setClipEnd(sorted.length - 1)
        setClipPlaneX(0)
        setClipPlaneY(0)
        setClipPlaneZ(0)
        setMeasurement(null)
        setMeasurementPreview(null)
        setHuRoiRect(null)
        setHuRoiPreview(null)
        setHuRoiPolyPoints([])
        setHuRoiPolyDraftSliceZ(null)
        setHuRoiPolyFinal(null)
        setHuRoiPolyHover(null)
        setAnglePoints([])
        setAngleDraftSliceZ(null)
        setAngleFinal(null)
        setAngleHover(null)
        if (!cs) {
          setViewportStates({
            axial: getInitialViewportState(),
            coronal: getInitialViewportState(),
            sagittal: getInitialViewportState(),
            axialAlt: getInitialViewportState(),
          })
        }

        const cw = resolveWindowForSeries(clinicalViewModeIdActive, presetIdActive)
        setWindowCenter(first.windowCenter || cw.center)
        setWindowWidth(first.windowWidth || cw.width)
      } catch (error) {
        if (cancelled) return
        loadedSeriesKeyRef.current = ''
        setFrames([])
        setViewerError(
          error instanceof Error ? error.message : 'Не удалось открыть серию в viewer.',
        )
      }
    }

    void run()

    return () => {
      cancelled = true
    }
    // Только uid + число файлов: новая ссылка на тот же activeSeries не сбрасывает срез в центр.
    // preset намеренно не в deps: смена пресета не должна перечитывать серию с диска.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeries?.seriesInstanceUid, activeSeries?.files.length])

  const zSpacing = useMemo(() => {
    if (frames.length <= 1) return frames[0]?.sliceThickness || 1
    const distances: number[] = []

    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1].imagePositionZ
      const next = frames[index].imagePositionZ
      if (previous !== null && next !== null) {
        const distance = Math.abs(next - previous)
        if (distance > 0) {
          distances.push(distance)
        }
      }
    }

    return (
      median(distances) ||
      frames[0]?.spacingBetweenSlices ||
      frames[0]?.sliceThickness ||
      1
    )
  }, [frames])

  const volumeCrosshairIndexLimits = useMemo(() => {
    if (frames.length === 0) {
      return { maxX: 0, maxY: 0, maxZ: 0 }
    }
    return {
      maxX: frames[0].columns - 1,
      maxY: frames[0].rows - 1,
      maxZ: frames.length - 1,
    }
  }, [frames])

  const handleVolumePick = useCallback(
    (payload: VolumePickPayload) => {
      const { x, y, z } = payload.crosshair
      setCrosshair({ x, y, z })
      comparisonSync?.onLinkedSliceIndexChange(z)
      comparisonSync?.onLinkedCrosshairPatch({ x, y })
    },
    [comparisonSync],
  )

  const jumpToPathologyFocus = useCallback(
    (z: number, preferClassId?: PathologyClassId) => {
      const em = pathologyEmphasisFromSlice(frames, z, preferClassId)
      if (!em) return
      setPathologyEmphasis(em)
      setCrosshair({ x: em.col, y: em.row, z: em.z })
      comparisonSync?.onLinkedSliceIndexChange(em.z)
      comparisonSync?.onLinkedCrosshairPatch({ x: em.col, y: em.row })
    },
    [frames, comparisonSync],
  )

  const runPathologyVolumeScan = useCallback(async () => {
    if (frames.length === 0) {
      if (activeSeries && activeSeries.files.length > 0) {
        pathologyScanPendingRef.current = true
      }
      return
    }
    pathologyScanPendingRef.current = false
    pathologyAbortRef.current?.abort()
    pathologyAbortRef.current = new AbortController()
    const { signal } = pathologyAbortRef.current
    pathologyScanStartSliceZRef.current = sliceZRef.current
    setPathologyEmphasis(null)
    setAorticScreening(null)
    setTotalsegAortaHuStats(null)
    setPathologyScanRunning(true)
    try {
      const local = runVolumePathologyScan(frames)
      let merged = local
      let lungQ =
        clinicalViewModeIdActive === 'lung' ? runLungVolumeQuantification(frames) : null

      const base = getPathologyRemoteApiBase()
      if (local && base && activeSeries) {
        const f0 = frames[0]
        const payload = buildCtScreenPayload(frames, {
          seriesInstanceUid: activeSeries.seriesInstanceUid,
          zSpacingMm: zSpacing,
          pixelSpacingRowMm: f0?.pixelSpacingY ?? null,
          pixelSpacingColMm: f0?.pixelSpacingX ?? null,
          requestAorticSyndromeScreening: clinicalViewModeIdActive === 'aorta_oas',
        })
        if (payload) {
          try {
            const remote = await fetchCtScreenInference(base, payload, signal)
            if (remote && !signal.aborted) {
              merged = mergeCtScreenResponse(local, remote)
              lungQ = applyLungQuantFromApi(lungQ, remote)
              if (remote.masks?.format === 'nifti_url' && remote.masks.url?.trim()) {
                setVolumeMaskUrl(remote.masks.url.trim())
                setVolumeMaskServerMeta(remote.masks)
              }
              const as = remote.aorticSyndromeScreening
              if (
                as &&
                typeof as.aasProbability === 'number' &&
                Number.isFinite(as.aasProbability) &&
                as.summaryLineRu &&
                as.disclaimerRu
              ) {
                const alRaw = as.alertLevel
                const alertLevel =
                  alRaw === 'rule_out' || alRaw === 'review' || alRaw === 'alert' ? alRaw : 'review'
                setAorticScreening({
                  modelId: as.modelId,
                  aasProbability: Math.max(0, Math.min(1, as.aasProbability)),
                  alertLevel,
                  thresholdRuleOut:
                    typeof as.thresholdRuleOut === 'number' ? as.thresholdRuleOut : 0.3,
                  thresholdAlert: typeof as.thresholdAlert === 'number' ? as.thresholdAlert : 0.65,
                  predictedSubtype: as.predictedSubtype ?? null,
                  focusSliceIndex:
                    typeof as.focusSliceIndex === 'number' && Number.isFinite(as.focusSliceIndex)
                      ? as.focusSliceIndex
                      : null,
                  heatmapNiftiUrl: as.heatmapNiftiUrl?.trim() || null,
                  summaryLineRu: as.summaryLineRu,
                  disclaimerRu: as.disclaimerRu,
                })
              } else {
                setAorticScreening(null)
              }
              const tsA = remote.totalsegAortaHuStats
              if (tsA && typeof tsA.ok === 'boolean') {
                setTotalsegAortaHuStats(tsA)
              } else {
                setTotalsegAortaHuStats(null)
              }
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return
            console.warn('[pathology] inference API:', err)
          }
        }
      }

      if (signal.aborted) return

      setPathologyVolumeResult(merged)
      setLungQuantReport(clinicalViewModeIdActive === 'lung' ? lungQ : null)
      if (merged && !signal.aborted) {
        const em = pathologyEmphasisFromSlice(
          frames,
          merged.focusSliceIndex,
          merged.findings[0]?.classId,
        )
        if (em) {
          setPathologyEmphasis(em)
          if (sliceZRef.current === pathologyScanStartSliceZRef.current) {
            setCrosshair({ x: em.col, y: em.row, z: em.z })
            comparisonSync?.onLinkedSliceIndexChange(em.z)
            comparisonSync?.onLinkedCrosshairPatch({ x: em.col, y: em.row })
          }
        }
      }
    } finally {
      setPathologyScanRunning(false)
    }
  }, [
    frames,
    comparisonSync,
    activeSeries,
    clinicalViewModeIdActive,
    zSpacing,
  ])

  runPathologyVolumeScanRef.current = runPathologyVolumeScan

  useEffect(() => {
    if (!pathologyScanPendingRef.current || frames.length === 0 || pathologyScanRunning) return
    pathologyScanPendingRef.current = false
    void runPathologyVolumeScanRef.current()
  }, [frames.length, pathologyScanRunning])

  const activeSlicePathology = useMemo(() => {
    if (workspaceMode !== 'diagnostic' || frames.length === 0) return null
    const fr = frames[sliceZ]
    if (!fr || fr.huPixels.length !== fr.columns * fr.rows) return null
    return analyzeSlicePathology(fr.huPixels, fr.columns, fr.rows)
  }, [workspaceMode, frames, sliceZ])

  /**
   * Фокус для vtk: только в 2D-режиме и только если бы совпадал с миром объёма.
   * Синтетические мм от креста ≠ LPS+IPP у тома — смещали камеру и «теряли» модель в кадре.
   */
  const focalWorldMM = useMemo((): readonly [number, number, number] | null => {
    if (workspaceMode !== 'diagnostic' || frames.length === 0) return null
    const f = frames[0]
    return [
      (effectiveCrosshair.x + 0.5) * f.pixelSpacingX,
      (effectiveCrosshair.y + 0.5) * f.pixelSpacingY,
      (sliceZ + 0.5) * zSpacing,
    ] as const
  }, [workspaceMode, frames, effectiveCrosshair.x, effectiveCrosshair.y, sliceZ, zSpacing])

  // Параметры volume-движка (vtk.js) вынесены в общий state и правую панель.
  void [
    clipPlaneX,
    clipPlaneY,
    clipPlaneZ,
    volResetCameraTick,
    volumeMaskServerHint,
    volumeMaskSpatialForViewer,
    volumeCrosshairIndexLimits,
    handleVolumePick,
    focalWorldMM,
  ]

  const tableCutRows = useMemo(() => {
    if (workspaceMode === 'diagnostic' || !removeTable) return 0
    return estimateTableCutRowsForSlices(frames)
  }, [frames, removeTable, workspaceMode])

  const clipBounds = useMemo(() => {
    if (frames.length === 0) {
      return { start: 0, end: 0 }
    }

    const start = clamp(Math.min(clipStart, clipEnd), 0, frames.length - 1)
    const end = clamp(Math.max(clipStart, clipEnd), start, frames.length - 1)
    return { start, end }
  }, [clipStart, clipEnd, frames.length])

  const axialData = useMemo(() => {
    if (frames.length === 0) return null
    return buildAxialPixels(frames[sliceZ])
  }, [frames, sliceZ])

  const coronalData = useMemo(() => {
    if (frames.length === 0) return null
    return buildCoronalPixels(frames, effectiveCrosshair.y, zSpacing)
  }, [frames, effectiveCrosshair.y, zSpacing])

  const sagittalData = useMemo(() => {
    if (frames.length === 0) return null
    return buildSagittalPixels(frames, effectiveCrosshair.x, zSpacing)
  }, [frames, effectiveCrosshair.x, zSpacing])

  const ctaAxialProjection = useMemo(() => {
    if (workspaceMode !== 'cta3d' || frames.length === 0) return null
    return buildAxialProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'mip',
      140,
      suppressBone ? 520 : 4000,
      tableCutRows,
    )
  }, [frames, clipBounds, suppressBone, tableCutRows, workspaceMode])

  const ctaCoronalProjection = useMemo(() => {
    if (workspaceMode !== 'cta3d' || frames.length === 0) return null
    return buildCoronalProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'mip',
      140,
      suppressBone ? 520 : 4000,
      tableCutRows,
      zSpacing,
    )
  }, [frames, clipBounds, suppressBone, tableCutRows, zSpacing, workspaceMode])

  const ctaSagittalProjection = useMemo(() => {
    if (workspaceMode !== 'cta3d' || frames.length === 0) return null
    return buildSagittalProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'mip',
      140,
      suppressBone ? 520 : 4000,
      tableCutRows,
      zSpacing,
    )
  }, [frames, clipBounds, suppressBone, tableCutRows, zSpacing, workspaceMode])

  const airwayAxialProjection = useMemo(() => {
    if (workspaceMode !== 'airway3d' || frames.length === 0) return null
    return buildAxialProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'minip',
      -1100,
      -350,
      tableCutRows,
    )
  }, [frames, clipBounds, tableCutRows, workspaceMode])

  const airwayCoronalProjection = useMemo(() => {
    if (workspaceMode !== 'airway3d' || frames.length === 0) return null
    return buildCoronalProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'minip',
      -1100,
      -350,
      tableCutRows,
      zSpacing,
    )
  }, [frames, clipBounds, tableCutRows, zSpacing, workspaceMode])

  const airwaySagittalProjection = useMemo(() => {
    if (workspaceMode !== 'airway3d' || frames.length === 0) return null
    return buildSagittalProjection(
      frames,
      clipBounds.start,
      clipBounds.end,
      'minip',
      -1100,
      -350,
      tableCutRows,
      zSpacing,
    )
  }, [frames, clipBounds, tableCutRows, zSpacing, workspaceMode])

  const viewportImages: Record<ViewportKind, ViewportImage | null> =
    workspaceMode === 'cta3d'
      ? {
          axial: ctaAxialProjection,
          coronal: ctaCoronalProjection,
          sagittal: ctaSagittalProjection,
          axialAlt: ctaAxialProjection,
        }
      : workspaceMode === 'airway3d'
        ? {
            axial: airwayAxialProjection,
            coronal: airwayCoronalProjection,
            sagittal: airwaySagittalProjection,
            axialAlt: airwayAxialProjection,
          }
        : {
            axial: axialData,
            coronal: coronalData,
            sagittal: sagittalData,
            axialAlt: axialData,
          }

  function resetView() {
    const cw = clinicalMode
    if (comparisonSync) {
      comparisonSync.onLinkedWindowChange(cw.windowCenter, cw.windowWidth)
    } else {
      setWindowCenter(cw.windowCenter)
      setWindowWidth(cw.windowWidth)
    }
    const fresh = {
      axial: getInitialViewportState(),
      coronal: getInitialViewportState(),
      sagittal: getInitialViewportState(),
      axialAlt: getInitialViewportState(),
    }
    if (comparisonSync) {
      comparisonSync.onLinkedViewportStatesChange(fresh)
    } else {
      setViewportStates(fresh)
    }
    setMeasurement(null)
    setMeasurementPreview(null)
    setHuRoiRect(null)
    setHuRoiPreview(null)
    setHuRoiPolyPoints([])
    setHuRoiPolyDraftSliceZ(null)
    setHuRoiPolyFinal(null)
    setHuRoiPolyHover(null)
    setAnglePoints([])
    setAngleDraftSliceZ(null)
    setAngleFinal(null)
    setAngleHover(null)
  }

  const resetViewRef = useRef(resetView)
  resetViewRef.current = resetView

  useEffect(() => {
    if (measurementStartRef.current != null && lengthSliceZRef.current !== sliceZ) {
      measurementStartRef.current = null
      setMeasurementPreview(null)
    }
  }, [sliceZ])

  useEffect(() => {
    if (angleDraftSliceZ == null || anglePoints.length === 0) return
    if (angleDraftSliceZ !== sliceZ) {
      setAnglePoints([])
      setAngleHover(null)
      setAngleDraftSliceZ(null)
    }
  }, [sliceZ, angleDraftSliceZ, anglePoints.length])

  useEffect(() => {
    if (huRoiPolyDraftSliceZ == null || huRoiPolyPoints.length === 0) return
    if (huRoiPolyDraftSliceZ !== sliceZ) {
      setHuRoiPolyPoints([])
      setHuRoiPolyHover(null)
      setHuRoiPolyDraftSliceZ(null)
    }
  }, [sliceZ, huRoiPolyDraftSliceZ, huRoiPolyPoints.length])

  useEffect(() => {
    if (huRoiStartRef.current != null && huRoiSliceZRef.current !== sliceZ) {
      huRoiStartRef.current = null
      setHuRoiPreview(null)
    }
  }, [sliceZ])

  useEffect(() => {
    function isFormFieldTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return t.isContentEditable
    }

    function bumpSlice(delta: number) {
      if (frames.length <= 1) return
      const nz = clamp(sliceZ + delta, 0, frames.length - 1)
      if (comparisonSync) {
        comparisonSync.onLinkedSliceIndexChange(nz)
      } else {
        setCrosshair((ch) => ({ ...ch, z: nz }))
      }
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (suspendGlobalShortcutsRef.current) return
      if (ev.defaultPrevented) return
      if (ev.repeat) return
      if (isFormFieldTarget(ev.target)) return
      if (!activeSeries || activeSeries.files.length === 0) return

      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && isZoomHotkey(ev.code)) {
        ev.preventDefault()
        applyViewportZoom(activeViewport, ev.code === 'Minus' || ev.code === 'NumpadSubtract' ? -0.12 : 0.12)
        return
      }

      if (ev.ctrlKey || ev.metaKey || ev.altKey) return

      if (ev.key === 'Escape') {
        setHuRoiPolyPoints([])
        setHuRoiPolyDraftSliceZ(null)
        setHuRoiPolyHover(null)
        setAnglePoints([])
        setAngleDraftSliceZ(null)
        setAngleHover(null)
        return
      }

      if (ev.code === 'KeyR') {
        ev.preventDefault()
        resetViewRef.current()
        return
      }

      if (workspaceMode === 'diagnostic' && frames.length > 0) {
        if (ev.code === 'BracketLeft') {
          ev.preventDefault()
          bumpSlice(-1)
          return
        }
        if (ev.code === 'BracketRight') {
          ev.preventDefault()
          bumpSlice(1)
          return
        }
        if (ev.code === 'Space') {
          ev.preventDefault()
          return
        }

        const toolKeys: Partial<Record<string, ToolMode>> = {
          Digit1: 'windowLevel',
          Digit2: 'pan',
          Digit3: 'zoom',
          Digit4: 'length',
          Digit5: 'angle',
          Digit6: 'huRoi',
          Digit7: 'huRoiPoly',
        }
        const tool = toolKeys[ev.code]
        if (tool) {
          ev.preventDefault()
          setActiveTool(tool)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSeries, activeViewport, applyViewportZoom, comparisonSync, frames.length, sliceZ, workspaceMode])

  useEffect(() => {
    if (activeTool !== 'huRoiPoly') setHuRoiPolyHover(null)
    if (activeTool !== 'angle') setAngleHover(null)
  }, [activeTool])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!viewerAreaRef.current || !resizeModeRef.current) return

      const rect = viewerAreaRef.current.getBoundingClientRect()
      const relativeX = clamp(event.clientX - rect.left, 120, rect.width - 120)
      const relativeY = clamp(event.clientY - rect.top, 120, rect.height - 120)

      if (resizeModeRef.current === 'mprVertical') {
        setMprVerticalSplit(clamp(relativeX / rect.width, 0.38, 0.82))
      } else if (resizeModeRef.current === 'mprHorizontal') {
        setMprHorizontalSplit(clamp(relativeY / rect.height, 0.2, 0.8))
      } else if (resizeModeRef.current === 'gridX') {
        setGridSplitX(clamp(relativeX / rect.width, 0.28, 0.72))
      } else if (resizeModeRef.current === 'gridY') {
        setGridSplitY(clamp(relativeY / rect.height, 0.28, 0.72))
      }
    }

    const stopResize = () => {
      resizeModeRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
    }
  }, [])

  function prepareCanvas(canvas: HTMLCanvasElement | null, rect: PaneRect, smoothScaling: boolean) {
    if (!canvas || rect.width <= 0 || rect.height <= 0) return null

    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.floor(rect.width * dpr))
    const backingHeight = Math.max(1, Math.floor(rect.height * dpr))

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth
      canvas.height = backingHeight
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }

    const context = canvas.getContext('2d')
    if (!context) return null

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.imageSmoothingEnabled = smoothScaling
    if (smoothScaling) {
      context.imageSmoothingQuality = 'high'
    }
    return context
  }

  type DrawMetrics = {
    drawScale: number
    drawWidth: number
    drawHeight: number
    baseX: number
    baseY: number
    /** Источник в пикселях исходного буфера (для drawImage и креста). */
    srcX: number
    srcY: number
    srcW: number
    srcH: number
    flipH: boolean
    flipV: boolean
  }

  function getDrawMetrics(viewport: ViewportKind, data: ViewportImage, rect: PaneRect): DrawMetrics {
    const state = { ...getInitialViewportState(), ...effectiveViewportStates[viewport] }
    // Важно: crop по "анатомии" на каждом срезе даёт прыжки/обрезание при прокрутке,
    // поэтому для стабильной навигации рендерим полный кадр.
    const srcX = 0
    const srcY = 0
    const srcW = data.width
    const srcH = data.height
    const sx = data.worldWidth / Math.max(1, data.width)
    const sy = data.worldHeight / Math.max(1, data.height)
    const worldW = srcW * sx
    const worldH = srcH * sy
    const fitScale = Math.min(rect.width / worldW, rect.height / worldH)
    const drawScale = fitScale * state.zoom
    let drawWidth = worldW * drawScale
    let drawHeight = worldH * drawScale
    let baseX = (rect.width - drawWidth) / 2 + state.panX
    let baseY = (rect.height - drawHeight) / 2 + state.panY

    const snapPixels =
      workspaceMode === 'diagnostic' &&
      superCrisp2d &&
      // Супер-чёткость важна, когда мы уже не сглаживаем и можем избежать дробного ресэмплинга.
      !interpolation2d
    if (snapPixels) {
      baseX = Math.round(baseX)
      baseY = Math.round(baseY)
      drawWidth = Math.round(drawWidth)
      drawHeight = Math.round(drawHeight)
    }

    return {
      drawScale,
      drawWidth,
      drawHeight,
      baseX,
      baseY,
      srcX,
      srcY,
      srcW,
      srcH,
      flipH: state.flipH,
      flipV: state.flipV,
    }
  }

  function imageXToScreen(x: number, m: DrawMetrics) {
    const t = ((x - m.srcX) / m.srcW) * m.drawWidth
    return m.flipH ? m.baseX + m.drawWidth - t : m.baseX + t
  }

  function imageYToScreen(y: number, m: DrawMetrics) {
    const t = ((y - m.srcY) / m.srcH) * m.drawHeight
    return m.flipV ? m.baseY + m.drawHeight - t : m.baseY + t
  }

  function drawViewport(viewport: ViewportKind) {
    const canvasMap: Record<ViewportKind, HTMLCanvasElement | null> = {
      axial: axialRef.current,
      coronal: coronalRef.current,
      sagittal: sagittalRef.current,
      axialAlt: axialAltRef.current,
    }

    const canvas = canvasMap[viewport]
    const data = viewportImages[viewport]
    const rect = paneRects[viewport]

    if (!canvas || !data || rect.width <= 0 || rect.height <= 0 || frames.length === 0) return

    // Сглаживание управляется кнопкой интерполяции: выкл. = чёткие пиксели (как NN), вкл. = плавный зум.
    const smooth2d = interpolation2d
    const context = prepareCanvas(canvas, rect, smooth2d)
    if (!context) return

    const frame = frames[0]
    const axialFrame = frames[sliceZ] ?? frame
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }

    const offscreen = offscreenRef.current
    offscreen.width = data.width
    offscreen.height = data.height
    const offscreenContext = offscreen.getContext('2d')
    if (!offscreenContext) return

    offscreenContext.putImageData(
      buildImageData(
        data.width,
        data.height,
        data.pixels,
        viewport === 'axial' || viewport === 'axialAlt'
          ? axialFrame.photometricInterpretation
          : frame.photometricInterpretation,
        displayWindowCenter,
        displayWindowWidth,
        workspaceMode,
        workspaceMode === 'diagnostic' ? clinicalMode.diagnosticTint : null,
      ),
      0,
      0,
    )

    context.clearRect(0, 0, rect.width, rect.height)
    context.fillStyle = '#050608'
    context.fillRect(0, 0, rect.width, rect.height)

    const metrics = getDrawMetrics(viewport, data, rect)

    function drawSliceLayer(
      c: CanvasRenderingContext2D,
      src: CanvasImageSource,
      srcX: number,
      srcY: number,
      srcW: number,
      srcH: number,
      layer?: { globalAlpha?: number; composite?: GlobalCompositeOperation },
    ) {
      c.save()
      if (layer?.globalAlpha != null) c.globalAlpha = layer.globalAlpha
      if (layer?.composite) c.globalCompositeOperation = layer.composite
      if (metrics.flipH || metrics.flipV) {
        c.translate(
          metrics.baseX + (metrics.flipH ? metrics.drawWidth : 0),
          metrics.baseY + (metrics.flipV ? metrics.drawHeight : 0),
        )
        c.scale(metrics.flipH ? -1 : 1, metrics.flipV ? -1 : 1)
        c.drawImage(src, srcX, srcY, srcW, srcH, 0, 0, metrics.drawWidth, metrics.drawHeight)
      } else {
        c.drawImage(
          src,
          srcX,
          srcY,
          srcW,
          srcH,
          metrics.baseX,
          metrics.baseY,
          metrics.drawWidth,
          metrics.drawHeight,
        )
      }
      c.restore()
    }

    drawSliceLayer(context, offscreen, metrics.srcX, metrics.srcY, metrics.srcW, metrics.srcH)

    if (
      segEnabled &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      frames[sliceZ]
    ) {
      const ax = frames[sliceZ]
      const src = ax.huPixels
      if (src.length === data.width * data.height) {
        const img = new ImageData(data.width, data.height)
        for (let i = 0; i < src.length; i += 1) {
          const v = src[i]
          if (v >= segHuMin && v <= segHuMax) {
            const o = i * 4
            img.data[o] = 40
            img.data[o + 1] = 255
            img.data[o + 2] = 120
            img.data[o + 3] = 85
          }
        }
        const segC = document.createElement('canvas')
        segC.width = data.width
        segC.height = data.height
        const sctx = segC.getContext('2d')
        if (sctx) {
          sctx.putImageData(img, 0, 0)
          drawSliceLayer(context, segC, metrics.srcX, metrics.srcY, metrics.srcW, metrics.srcH, {
            globalAlpha: 0.42,
          })
        }
      }
    }

    if (
      activeSlicePathology &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      frames[sliceZ] &&
      data.width === activeSlicePathology.width &&
      data.height === activeSlicePathology.height
    ) {
      try {
        const pw = activeSlicePathology.width
        const ph = activeSlicePathology.height
        const pick = activeSlicePathology.pickIds
        const emphasisHere =
          pathologyEmphasis !== null && sliceZ === pathologyEmphasis.z
        let hyperDensePx = 0
        for (let i = 0; i < pick.length; i += 1) {
          if (pick[i] === PathologyClass.hyperdenseAcute) hyperDensePx += 1
        }
        const hyperFrac = pick.length > 0 ? hyperDensePx / pick.length : 0
        /** Красный акцент только для относительно компактных масок (не вся паренхима). */
        const useRedForClass = (c: PathologyClassId) => {
          if (c === PathologyClass.none) return false
          if (c === PathologyClass.softTissueFoci) return false
          if (c === PathologyClass.hyperdenseAcute && hyperFrac > 0.011) return false
          return true
        }
        {
          const rgba = new Uint8ClampedArray(activeSlicePathology.highlightRgba)
          const hiImg = new ImageData(rgba, pw, ph)
          const hiC = document.createElement('canvas')
          hiC.width = pw
          hiC.height = ph
          const hictx = hiC.getContext('2d')
          if (hictx) {
            hictx.putImageData(hiImg, 0, 0)
            drawSliceLayer(context, hiC, metrics.srcX, metrics.srcY, metrics.srcW, metrics.srcH, {
              globalAlpha: 0.5,
              composite: 'source-over',
            })
          }
        }

        if (emphasisHere && pathologyEmphasis) {
          const mx = imageXToScreen(pathologyEmphasis.col + 0.5, metrics)
          const my = imageYToScreen(pathologyEmphasis.row + 0.5, metrics)
          const rMark = Math.max(5, Math.min(14, Math.min(metrics.drawWidth, metrics.drawHeight) * 0.035))
          context.save()
          context.strokeStyle = '#ff3b3b'
          context.lineWidth = 2
          context.beginPath()
          context.arc(mx, my, rMark, 0, Math.PI * 2)
          context.stroke()
          const arm = rMark * 1.65
          context.beginPath()
          context.moveTo(mx - arm, my)
          context.lineTo(mx + arm, my)
          context.moveTo(mx, my - arm)
          context.lineTo(mx, my + arm)
          context.stroke()
          context.restore()

          if (pathologyVolumeResult && pathologyVolumeResult.findings.length > 0) {
            const here = pathologyVolumeResult.findings.filter((f) => f.sliceIndices.includes(sliceZ))
            const broadFinding = (f: { id: string }) => f.id === 'soft_tissue_foci_screen'
            const focalHere = here.filter((f) => !broadFinding(f))
            const labelSource = focalHere.length > 0 ? focalHere : here
            if (labelSource.length > 0) {
              const drawStrokeFill = (
                text: string,
                cx: number,
                cy: number,
                fill: string,
                lineOffset: number,
              ) => {
                context.save()
                context.font = '600 11px system-ui, "Segoe UI", sans-serif'
                context.textAlign = 'center'
                context.textBaseline = 'bottom'
                const ty = Math.max(metrics.baseY + 12 + lineOffset, cy - 6 - rMark - lineOffset * 0.35)
                context.strokeStyle = 'rgba(0, 0, 0, 0.92)'
                context.lineWidth = 4
                context.lineJoin = 'round'
                context.miterLimit = 2
                context.strokeText(text, cx, ty)
                context.fillStyle = fill
                context.fillText(text, cx, ty)
                context.restore()
              }
              const raw = labelSource.map((f) => f.label).join(' · ')
              const text = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw
              drawStrokeFill(text, mx, my, '#ff3b3b', 0)
            }
          }
        } else if (!emphasisHere) {
          const blobsFocal = activeSlicePathology.blobs.filter((b) => useRedForClass(b.classId))
          if (blobsFocal.length > 0) {
            const drawStrokeFill = (
              text: string,
              cx: number,
              cy: number,
              fill: string,
              lineOffset: number,
            ) => {
              context.save()
              context.font = '600 11px system-ui, "Segoe UI", sans-serif'
              context.textAlign = 'center'
              context.textBaseline = 'bottom'
              const ty = Math.max(metrics.baseY + 12 + lineOffset, cy - 6 - lineOffset * 0.35)
              context.strokeStyle = 'rgba(0, 0, 0, 0.92)'
              context.lineWidth = 4
              context.lineJoin = 'round'
              context.miterLimit = 2
              context.strokeText(text, cx, ty)
              context.fillStyle = fill
              context.fillText(text, cx, ty)
              context.restore()
            }
            const maxBlobs = 5
            for (let bi = 0; bi < Math.min(blobsFocal.length, maxBlobs); bi += 1) {
              const b = blobsFocal[bi]
              const cx = imageXToScreen(b.cx + 0.5, metrics)
              const cy = imageYToScreen(b.cy + 0.5, metrics)
              const raw = b.label
              const text = raw.length > 48 ? `${raw.slice(0, 46)}…` : raw
              drawStrokeFill(text, cx, cy, '#ff3b3b', bi * 18)
            }
          }
        }
      } catch {
        /* старые движки без ImageData ctor — пропускаем оверлей */
      }
    }

    context.strokeStyle = '#d8ba4d'
    context.lineWidth = 1
    context.beginPath()
    if (viewport === 'axial' || viewport === 'axialAlt') {
      const vx = imageXToScreen(effectiveCrosshair.x, metrics)
      context.moveTo(vx, metrics.baseY)
      context.lineTo(vx, metrics.baseY + metrics.drawHeight)
      const hy = imageYToScreen(effectiveCrosshair.y, metrics)
      context.moveTo(metrics.baseX, hy)
      context.lineTo(metrics.baseX + metrics.drawWidth, hy)
    } else if (viewport === 'coronal') {
      const vx = imageXToScreen(effectiveCrosshair.x, metrics)
      context.moveTo(vx, metrics.baseY)
      context.lineTo(vx, metrics.baseY + metrics.drawHeight)
      const zS = workspaceMode === 'diagnostic' ? 0 : clipBounds.start
      const zE =
        frames.length === 0 ? 0 : workspaceMode === 'diagnostic' ? frames.length - 1 : clipBounds.end
      const hy = imageYToScreen(axialSliceZToMprRow(sliceZ, zS, zE), metrics)
      context.moveTo(metrics.baseX, hy)
      context.lineTo(metrics.baseX + metrics.drawWidth, hy)
    } else {
      const vx = imageXToScreen(effectiveCrosshair.y, metrics)
      context.moveTo(vx, metrics.baseY)
      context.lineTo(vx, metrics.baseY + metrics.drawHeight)
      const zS = workspaceMode === 'diagnostic' ? 0 : clipBounds.start
      const zE =
        frames.length === 0 ? 0 : workspaceMode === 'diagnostic' ? frames.length - 1 : clipBounds.end
      const hy = imageYToScreen(axialSliceZToMprRow(sliceZ, zS, zE), metrics)
      context.moveTo(metrics.baseX, hy)
      context.lineTo(metrics.baseX + metrics.drawWidth, hy)
    }
    context.stroke()

    context.save()
    const frHud = frames[sliceZ]
    let huAtCross: number | null = null
    if (
      frHud &&
      frHud.huPixels.length === frHud.columns * frHud.rows &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      const ci = clamp(effectiveCrosshair.x, 0, frHud.columns - 1)
      const ri = clamp(effectiveCrosshair.y, 0, frHud.rows - 1)
      const v = frHud.huPixels[ri * frHud.columns + ci]
      huAtCross = Number.isFinite(v) ? v : null
    }
    let huRoiStats:
      | ReturnType<typeof computeHuRoiStats>
      | ReturnType<typeof computeHuPolygonRoiStats>
      | null = null
    if (
      huRoiPolyFinal &&
      huRoiPolyFinal.points.length >= 3 &&
      huRoiPolyFinal.sliceZ === sliceZ &&
      frHud &&
      frHud.huPixels.length === frHud.columns * frHud.rows &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      huRoiStats = computeHuPolygonRoiStats(
        frHud.huPixels,
        frHud.columns,
        frHud.rows,
        huRoiPolyFinal.points,
        frHud.pixelSpacingX,
        frHud.pixelSpacingY,
      )
    } else if (
      huRoiRect &&
      huRoiRect.sliceZ === sliceZ &&
      frHud &&
      frHud.huPixels.length === frHud.columns * frHud.rows &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      huRoiStats = computeHuRoiStats(
        frHud.huPixels,
        frHud.columns,
        frHud.rows,
        huRoiRect.start.x,
        huRoiRect.start.y,
        huRoiRect.end.x,
        huRoiRect.end.y,
        frHud.pixelSpacingX,
        frHud.pixelSpacingY,
      )
    }
    const roiHudExtra = huRoiStats ? 2 + (huRoiStats.areaMm2 != null ? 1 : 0) : 0
    const angleHudLine =
      angleFinal &&
      angleFinal.sliceZ === sliceZ &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      frames[sliceZ] &&
      Number.isFinite(angleAtVertexDeg(angleFinal.a, angleFinal.b, angleFinal.c))
        ? 1
        : 0
    const measHudLine =
      measurement &&
      measurement.sliceZ === sliceZ &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      frames[sliceZ]
        ? 1
        : 0
    const hudLines =
      2 +
      measHudLine +
      angleHudLine +
      roiHudExtra +
      (huAtCross != null ? 1 : 0)
    const hudW = huRoiStats ? 320 : angleHudLine ? 300 : 210
    const hudH = 10 + hudLines * 16
    context.font = '600 11px ui-monospace, monospace'
    context.fillStyle = 'rgba(8, 10, 14, 0.72)'
    context.fillRect(6, 6, hudW, hudH)
    context.fillStyle = '#e8edf2'
    const planeShort =
      viewport === 'axial' || viewport === 'axialAlt'
        ? `Ax ${sliceZ + 1}/${frames.length}`
        : viewport === 'coronal'
          ? `Cor Y${effectiveCrosshair.y}`
          : `Sag X${effectiveCrosshair.x}`
    context.fillText(planeShort, 12, 22)
    context.fillStyle = '#9fb4c9'
    context.font = '500 10px ui-monospace, monospace'
    context.fillText(
      `W${Math.round(displayWindowWidth)} L${Math.round(displayWindowCenter)} · Δz ${zSpacing.toFixed(2)}mm`,
      12,
      38,
    )
    let hudY = 54
    if (measurement && measurement.sliceZ === sliceZ && (viewport === 'axial' || viewport === 'axialAlt') && frames[sliceZ]) {
      const fr = frames[sliceZ]
      const dx = (measurement.end.x - measurement.start.x) * fr.pixelSpacingX
      const dy = (measurement.end.y - measurement.start.y) * fr.pixelSpacingY
      const len = Math.sqrt(dx * dx + dy * dy).toFixed(1)
      context.fillStyle = '#5eead4'
      context.fillText(`L ${len} mm (срез ${measurement.sliceZ + 1})`, 12, hudY)
      hudY += 16
    }
    if (
      angleFinal &&
      angleFinal.sliceZ === sliceZ &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      frames[sliceZ]
    ) {
      const deg = angleAtVertexDeg(angleFinal.a, angleFinal.b, angleFinal.c)
      if (Number.isFinite(deg)) {
        context.fillStyle = '#7dd3fc'
        context.fillText(`∠ ${deg.toFixed(1)}° (вершина — 2-й клик)`, 12, hudY)
        hudY += 16
      }
    }
    if (huRoiStats) {
      context.fillStyle = '#fde68a'
      const roiLabel = huRoiStats.areaKind === 'contour' ? 'ROI poly' : 'ROI'
      context.fillText(
        `${roiLabel} Ø ${huRoiStats.mean.toFixed(1)} HU · n=${huRoiStats.count}`,
        12,
        hudY,
      )
      hudY += 16
      if (huRoiStats.areaMm2 != null) {
        const s = huRoiStats.areaMm2
        const sStr = s >= 10000 ? `${(s / 100).toFixed(2)} cm²` : `${s.toFixed(1)} mm²`
        const areaNote = huRoiStats.areaKind === 'contour' ? 'контур' : 'сетка'
        context.fillStyle = huRoiStats.areaKind === 'contour' ? '#ddd6fe' : '#fbbf24'
        context.fillText(`S ≈ ${sStr} (${areaNote})`, 12, hudY)
        hudY += 16
      }
      context.fillStyle = '#fcd34d'
      context.fillText(
        `min ${huRoiStats.min.toFixed(0)} · max ${huRoiStats.max.toFixed(0)} · σ ${huRoiStats.std.toFixed(1)}`,
        12,
        hudY,
      )
      hudY += 16
    }
    if (huAtCross != null) {
      context.fillStyle = '#a7f3d0'
      context.fillText(`HU ≈ ${huAtCross.toFixed(0)} @ (${effectiveCrosshair.x},${effectiveCrosshair.y})`, 12, hudY)
    }
    context.restore()

    if (viewport === 'axial' || viewport === 'axialAlt') {
      const showFinalMeas = measurement && measurement.sliceZ === sliceZ
      const showMeasPreview =
        measurementPreview &&
        measurementStartRef.current &&
        activeTool === 'length' &&
        lengthSliceZRef.current === sliceZ
      const start = showFinalMeas
        ? measurement.start
        : showMeasPreview
          ? measurementStartRef.current
          : null
      const end = showFinalMeas ? measurement.end : showMeasPreview ? measurementPreview : null

      if (start && end) {
        const startCanvas = {
          x: imageXToScreen(start.x, metrics),
          y: imageYToScreen(start.y, metrics),
        }
        const endCanvas = {
          x: imageXToScreen(end.x, metrics),
          y: imageYToScreen(end.y, metrics),
        }

        context.strokeStyle = '#1bc5ff'
        context.lineWidth = 2
        context.beginPath()
        context.moveTo(startCanvas.x, startCanvas.y)
        context.lineTo(endCanvas.x, endCanvas.y)
        context.stroke()
      }
    }

    if (
      (viewport === 'axial' || viewport === 'axialAlt') &&
      workspaceMode === 'diagnostic' &&
      ((angleFinal && angleFinal.sliceZ === sliceZ) ||
        (anglePoints.length > 0 && angleDraftSliceZ === sliceZ))
    ) {
      const strokeLine = (p: Point, q: Point) => {
        context.beginPath()
        context.moveTo(imageXToScreen(p.x, metrics), imageYToScreen(p.y, metrics))
        context.lineTo(imageXToScreen(q.x, metrics), imageYToScreen(q.y, metrics))
        context.stroke()
      }
      context.strokeStyle = '#38bdf8'
      context.lineWidth = 2
      if (angleFinal && angleFinal.sliceZ === sliceZ) {
        strokeLine(angleFinal.a, angleFinal.b)
        strokeLine(angleFinal.b, angleFinal.c)
      } else if (angleDraftSliceZ === sliceZ && anglePoints.length === 1 && angleHover) {
        strokeLine(anglePoints[0]!, angleHover)
      } else if (angleDraftSliceZ === sliceZ && anglePoints.length === 2 && angleHover) {
        strokeLine(anglePoints[0]!, anglePoints[1]!)
        strokeLine(anglePoints[1]!, angleHover)
      }
    }

    const polyRoiOnSlice =
      huRoiPolyFinal &&
      huRoiPolyFinal.sliceZ === sliceZ &&
      huRoiPolyFinal.points.length >= 3
    const polyDraftOnSlice =
      huRoiPolyPoints.length > 0 && huRoiPolyDraftSliceZ === sliceZ
    const polyHoverOnSlice =
      activeTool === 'huRoiPoly' &&
      huRoiPolyHover != null &&
      (huRoiPolyPoints.length === 0 || huRoiPolyDraftSliceZ === sliceZ)
    if (
      (viewport === 'axial' || viewport === 'axialAlt') &&
      workspaceMode === 'diagnostic' &&
      (polyRoiOnSlice || polyDraftOnSlice || polyHoverOnSlice)
    ) {
      const finalized = Boolean(polyRoiOnSlice)
      const pts =
        finalized && huRoiPolyFinal ? huRoiPolyFinal.points : huRoiPolyPoints
      const hover =
        activeTool === 'huRoiPoly' && !finalized && polyHoverOnSlice && huRoiPolyHover
          ? huRoiPolyHover
          : null
      context.strokeStyle = '#c4b5fd'
      context.lineWidth = 2
      context.setLineDash(finalized ? [5, 3] : [7, 5])
      context.beginPath()
      for (let i = 0; i < pts.length; i += 1) {
        const sx = imageXToScreen(pts[i].x, metrics)
        const sy = imageYToScreen(pts[i].y, metrics)
        if (i === 0) context.moveTo(sx, sy)
        else context.lineTo(sx, sy)
      }
      if (hover && pts.length > 0) {
        context.lineTo(imageXToScreen(hover.x, metrics), imageYToScreen(hover.y, metrics))
      } else if (finalized && pts.length >= 3) {
        context.closePath()
      }
      context.stroke()
      context.setLineDash([])
    }

    const showHuRoiRectFinal = huRoiRect && huRoiRect.sliceZ === sliceZ
    const showHuRoiRectDraft =
      activeTool === 'huRoi' &&
      huRoiSliceZRef.current === sliceZ &&
      (huRoiPreview != null || huRoiStartRef.current != null)
    if (
      (viewport === 'axial' || viewport === 'axialAlt') &&
      (showHuRoiRectFinal || showHuRoiRectDraft)
    ) {
      const start = showHuRoiRectFinal ? huRoiRect!.start : huRoiStartRef.current
      const end = showHuRoiRectFinal ? huRoiRect!.end : huRoiPreview
      if (start && end) {
        const x0 = Math.min(start.x, end.x)
        const x1 = Math.max(start.x, end.x)
        const y0 = Math.min(start.y, end.y)
        const y1 = Math.max(start.y, end.y)
        const sx0 = imageXToScreen(x0, metrics)
        const sx1 = imageXToScreen(x1, metrics)
        const sy0 = imageYToScreen(y0, metrics)
        const sy1 = imageYToScreen(y1, metrics)
        const left = Math.min(sx0, sx1)
        const top = Math.min(sy0, sy1)
        const rw = Math.max(Math.abs(sx1 - sx0), 1)
        const rh = Math.max(Math.abs(sy1 - sy0), 1)
        context.strokeStyle = '#fbbf24'
        context.lineWidth = 2
        context.setLineDash(showHuRoiRectFinal ? [5, 4] : [7, 5])
        context.strokeRect(left, top, rw, rh)
        context.setLineDash([])
      }
    }
  }

  useEffect(() => {
    drawViewport('axial')
    drawViewport('coronal')
    drawViewport('sagittal')
    drawViewport('axialAlt')
    /* Состояние отрисовки перечислено в зависимостях; drawViewport намеренно не в deps. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paneRects,
    effectiveViewportStates,
    windowCenter,
    windowWidth,
    displayWindowCenter,
    displayWindowWidth,
    effectiveCrosshair,
    sliceZ,
    clinicalMode,
    measurement,
    measurementPreview,
    huRoiRect,
    huRoiPreview,
    huRoiPolyFinal,
    huRoiPolyPoints,
    huRoiPolyDraftSliceZ,
    huRoiPolyHover,
    anglePoints,
    angleDraftSliceZ,
    angleFinal,
    angleHover,
    activeTool,
    interpolation2d,
    workspaceMode,
    axialData,
    coronalData,
    sagittalData,
    ctaAxialProjection,
    ctaCoronalProjection,
    ctaSagittalProjection,
    airwayAxialProjection,
    airwayCoronalProjection,
    airwaySagittalProjection,
    zSpacing,
    segEnabled,
    segHuMin,
    segHuMax,
    pathologyVolumeResult,
    pathologyEmphasis,
    activeSlicePathology,
    layoutMode,
  ])

  useEffect(() => {
    if (!pathologyVolumeResult) return
    const strong = pathologyVolumeResult.findings.some((f) => f.confidence >= 0.66)
    if (strong) setPathologyPopupOpen(true)
  }, [pathologyVolumeResult])

  function getMousePoint(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const pointX = event.clientX - rect.left
    const pointY = event.clientY - rect.top
    const pane = paneRects[viewport]
    const metrics = getDrawMetrics(viewport, data, pane)
    let fx = clamp((pointX - metrics.baseX) / metrics.drawWidth, 0, 1)
    let fy = clamp((pointY - metrics.baseY) / metrics.drawHeight, 0, 1)
    if (metrics.flipH) fx = 1 - fx
    if (metrics.flipV) fy = 1 - fy
    const ix = metrics.srcX + fx * metrics.srcW
    const iy = metrics.srcY + fy * metrics.srcH

    if (viewport === 'axial' || viewport === 'axialAlt') {
      return {
        x: clamp(ix, 0, data.width - 1),
        y: clamp(iy, 0, data.height - 1),
      }
    }

    if (viewport === 'coronal') {
      return {
        x: clamp(ix, 0, data.width - 1),
        y: clamp(iy, 0, data.height - 1),
      }
    }

    return {
      x: clamp(ix, 0, data.width - 1),
      y: clamp(iy, 0, data.height - 1),
    }
  }

  function updatePathologyHover(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage | null,
  ) {
    if (
      !data ||
      !activeSlicePathology ||
      workspaceMode !== 'diagnostic' ||
      (viewport !== 'axial' && viewport !== 'axialAlt') ||
      data.width !== activeSlicePathology.width ||
      data.height !== activeSlicePathology.height
    ) {
      setPathologyTooltip(null)
      return
    }
    const pt = getMousePoint(event, viewport, data)
    const w = activeSlicePathology.width
    const h = activeSlicePathology.height
    const cx = clamp(Math.round(pt.x), 0, w - 1)
    const cy = clamp(Math.round(pt.y), 0, h - 1)
    const classId = activeSlicePathology.pickIds[cy * w + cx] as PathologyClassId
    const meta = classId ? getFindingMetaForClass(classId) : null
    const pane = event.currentTarget.parentElement
    if (meta && pane) {
      const pr = pane.getBoundingClientRect()
      const tw = 300
      const th = 128
      setPathologyTooltip({
        viewport,
        classId: classId as PathologyClassId,
        label: meta.label,
        organSystem: meta.organSystem,
        summary: meta.summary,
        details: meta.details,
        left: clamp(event.clientX - pr.left + 14, 8, Math.max(8, pr.width - tw - 8)),
        top: clamp(event.clientY - pr.top + 14, 8, Math.max(8, pr.height - th - 8)),
      })
    } else {
      setPathologyTooltip(null)
    }
  }

  function updateCrosshairFromPoint(viewport: ViewportKind, point: Point) {
    if (viewport === 'axial' || viewport === 'axialAlt') {
      const nx = Math.round(point.x)
      const ny = Math.round(point.y)
      setCrosshair((value) => ({
        ...value,
        x: nx,
        y: ny,
      }))
      comparisonSync?.onLinkedCrosshairPatch({ x: nx, y: ny })
      return
    }

    if (viewport === 'coronal') {
      const zS = workspaceMode === 'diagnostic' ? 0 : clipBounds.start
      const zE =
        frames.length === 0 ? 0 : workspaceMode === 'diagnostic' ? frames.length - 1 : clipBounds.end
      const newZ = mprRowToAxialSliceZ(point.y, zS, zE)
      const nx = Math.round(point.x)
      setCrosshair((value) => ({
        ...value,
        x: nx,
        z: newZ,
      }))
      comparisonSync?.onLinkedCrosshairPatch({ x: nx })
      comparisonSync?.onLinkedSliceIndexChange(newZ)
      return
    }

    const zS = workspaceMode === 'diagnostic' ? 0 : clipBounds.start
    const zE =
      frames.length === 0 ? 0 : workspaceMode === 'diagnostic' ? frames.length - 1 : clipBounds.end
    const newZ = mprRowToAxialSliceZ(point.y, zS, zE)
    const ny = Math.round(point.x)
    setCrosshair((value) => ({
      ...value,
      y: ny,
      z: newZ,
    }))
    comparisonSync?.onLinkedCrosshairPatch({ y: ny })
    comparisonSync?.onLinkedSliceIndexChange(newZ)
  }

  function handlePointerDown(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    setActiveViewport(viewport)
    setSingleViewport(viewport === 'axialAlt' ? 'axial' : viewport)

    const point = getMousePoint(event, viewport, data)
    setPathologyTooltip(null)
    if (workspaceMode === 'diagnostic') {
      updateCrosshairFromPoint(viewport, point)
    }

    if (
      activeTool === 'angle' &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      if (spaceDown && event.button === 0) {
        // Space+drag overrides tool selection: pan around image.
        tempDragToolRef.current = 'pan'
        dragStartRef.current = { x: event.clientX, y: event.clientY }
        dragWindowRef.current = { center: displayWindowCenter, width: displayWindowWidth }
        dragViewportRef.current = { ...effectiveViewportStates[viewport] }
        return
      }
      setAnglePoints((prev) => {
        if (prev.length === 0) {
          setAngleFinal(null)
          setAngleDraftSliceZ(sliceZ)
          setMeasurement(null)
          setMeasurementPreview(null)
          setHuRoiRect(null)
          setHuRoiPreview(null)
          setHuRoiPolyFinal(null)
          setHuRoiPolyPoints([])
          setHuRoiPolyDraftSliceZ(null)
          setHuRoiPolyHover(null)
          return [point]
        }
        if (prev.length === 1) {
          return [...prev, point]
        }
        const a = prev[0]!
        const b = prev[1]!
        setAngleFinal({ a, b, c: point, sliceZ })
        setAngleDraftSliceZ(null)
        return []
      })
      return
    }

    if (
      activeTool === 'huRoiPoly' &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      if (spaceDown && event.button === 0) {
        tempDragToolRef.current = 'pan'
        dragStartRef.current = { x: event.clientX, y: event.clientY }
        dragWindowRef.current = { center: displayWindowCenter, width: displayWindowWidth }
        dragViewportRef.current = { ...effectiveViewportStates[viewport] }
        return
      }
      setAnglePoints([])
      setAngleDraftSliceZ(null)
      setAngleFinal(null)
      setAngleHover(null)
      if (event.detail === 2) {
        event.preventDefault()
        setHuRoiPolyPoints((prev) => {
          if (prev.length >= 3) {
            setHuRoiPolyFinal({ points: [...prev], sliceZ })
            setHuRoiRect(null)
          }
          return []
        })
        setHuRoiPolyDraftSliceZ(null)
        return
      }
      setHuRoiPolyPoints((prev) => {
        if (prev.length >= 3) {
          const p0 = prev[0]
          if (Math.hypot(point.x - p0.x, point.y - p0.y) < 6) {
            setHuRoiPolyFinal({ points: [...prev], sliceZ })
            setHuRoiRect(null)
            setHuRoiPolyDraftSliceZ(null)
            return []
          }
        }
        setHuRoiPolyFinal(null)
        setHuRoiRect(null)
        const next = [...prev, point]
        if (prev.length === 0) setHuRoiPolyDraftSliceZ(sliceZ)
        return next
      })
      return
    }

    dragStartRef.current = { x: event.clientX, y: event.clientY }
    dragWindowRef.current = { center: displayWindowCenter, width: displayWindowWidth }
    dragViewportRef.current = { ...effectiveViewportStates[viewport] }

    if (spaceDown && event.button === 0) {
      tempDragToolRef.current = 'pan'
    }

    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt')) {
      lengthSliceZRef.current = sliceZ
      measurementStartRef.current = point
      setMeasurement(null)
      setMeasurementPreview(point)
      setAnglePoints([])
      setAngleDraftSliceZ(null)
      setAngleFinal(null)
      setAngleHover(null)
    }

    if (activeTool === 'huRoi' && (viewport === 'axial' || viewport === 'axialAlt')) {
      huRoiSliceZRef.current = sliceZ
      huRoiStartRef.current = point
      setHuRoiRect(null)
      setHuRoiPreview(point)
      setHuRoiPolyFinal(null)
      setHuRoiPolyPoints([])
      setHuRoiPolyDraftSliceZ(null)
      setAnglePoints([])
      setAngleDraftSliceZ(null)
      setAngleFinal(null)
      setAngleHover(null)
    }
  }

  function handlePointerMove(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    if (
      activeTool === 'huRoiPoly' &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      (huRoiPolyPoints.length === 0 || huRoiPolyDraftSliceZ === sliceZ)
    ) {
      setHuRoiPolyHover(getMousePoint(event, viewport, data))
    }
    if (
      activeTool === 'angle' &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'axialAlt')
    ) {
      setAngleHover(getMousePoint(event, viewport, data))
    }
    if (!dragStartRef.current) {
      updatePathologyHover(event, viewport, data)
    }
    const dragStart = dragStartRef.current
    if (!dragStart) return

    const deltaX = event.clientX - dragStart.x
    const deltaY = event.clientY - dragStart.y

    const effectiveTool = tempDragToolRef.current ?? activeTool

    if (effectiveTool === 'windowLevel') {
      const nw = clamp(dragWindowRef.current.width + deltaX * 3, 1, 4000)
      const nc = clamp(dragWindowRef.current.center + deltaY * 3, -2000, 3000)
      if (comparisonSync) {
        comparisonSync.onLinkedWindowChange(nc, nw)
      } else {
        setWindowWidth(nw)
        setWindowCenter(nc)
      }
      return
    }

    if (effectiveTool === 'pan') {
      const next = {
        ...effectiveViewportStates[viewport],
        panX: dragViewportRef.current.panX + deltaX,
        panY: dragViewportRef.current.panY + deltaY,
      }
      if (comparisonSync) {
        comparisonSync.onLinkedViewportStatesChange({
          ...comparisonSync.linkedViewportStates,
          [viewport]: next,
        })
      } else {
        setViewportStates((value) => ({
          ...value,
          [viewport]: next,
        }))
      }
      return
    }

    if (effectiveTool === 'zoom') {
      const next = {
        ...effectiveViewportStates[viewport],
        zoom: clamp(dragViewportRef.current.zoom + deltaY * -0.01, 0.2, 8),
      }
      if (comparisonSync) {
        comparisonSync.onLinkedViewportStatesChange({
          ...comparisonSync.linkedViewportStates,
          [viewport]: next,
        })
      } else {
        setViewportStates((value) => ({
          ...value,
          [viewport]: next,
        }))
      }
      return
    }

    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt')) {
      setMeasurementPreview(getMousePoint(event, viewport, data))
    }

    if (
      activeTool === 'huRoi' &&
      (viewport === 'axial' || viewport === 'axialAlt') &&
      huRoiSliceZRef.current === sliceZ
    ) {
      setHuRoiPreview(getMousePoint(event, viewport, data))
    }
  }

  function handlePointerUp(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt') && measurementStartRef.current) {
      setMeasurement({
        start: measurementStartRef.current,
        end: getMousePoint(event, viewport, data),
        sliceZ: lengthSliceZRef.current,
      })
    }

    if (activeTool === 'huRoi' && (viewport === 'axial' || viewport === 'axialAlt') && huRoiStartRef.current) {
      setHuRoiRect({
        start: huRoiStartRef.current,
        end: getMousePoint(event, viewport, data),
        sliceZ: huRoiSliceZRef.current,
      })
      setHuRoiPolyFinal(null)
      setHuRoiPolyPoints([])
      setHuRoiPolyDraftSliceZ(null)
      setAnglePoints([])
      setAngleDraftSliceZ(null)
      setAngleFinal(null)
      setAngleHover(null)
    }

    dragStartRef.current = null
    tempDragToolRef.current = null
    measurementStartRef.current = null
    huRoiStartRef.current = null
    setMeasurementPreview(null)
    setHuRoiPreview(null)
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>, viewport: ViewportKind) {
    event.preventDefault()

    if ((event.ctrlKey || event.metaKey) && workspaceMode === 'diagnostic') {
      applyViewportZoom(viewport, event.deltaY < 0 ? 0.12 : -0.12)
      return
    }

    if (activeTool === 'zoom') {
      applyViewportZoom(viewport, event.deltaY < 0 ? 0.12 : -0.12)
      return
    }

    if (frames.length === 0) return

    if (workspaceMode !== 'diagnostic') {
      const nextStart = clipBounds.start + (event.deltaY > 0 ? 1 : -1)
      const nextEnd = clipBounds.end + (event.deltaY > 0 ? 1 : -1)
      const shift = clamp(nextStart, 0, frames.length - 1) - clipBounds.start
      setClipStart(clamp(nextStart, 0, frames.length - 1))
      setClipEnd(clamp(nextEnd - (nextStart - clamp(nextStart, 0, frames.length - 1)), 0, frames.length - 1))
      if (shift === 0 && nextEnd !== clipBounds.end) {
        setClipEnd(clamp(nextEnd, 0, frames.length - 1))
      }
      return
    }

    const deltaZ = event.deltaY > 0 ? 1 : -1

    if (viewport === 'axial' || viewport === 'axialAlt') {
      if (comparisonSync) {
        const nz = clamp(comparisonSync.linkedSliceIndex + deltaZ, 0, frames.length - 1)
        comparisonSync.onLinkedSliceIndexChange(nz)
        return
      }
      setCrosshair((value) => ({
        ...value,
        z: clamp(value.z + deltaZ, 0, frames.length - 1),
      }))
      return
    }

    if (viewport === 'coronal') {
      // В coronal рендерится "стек" по Y (plane выбирается по effectiveCrosshair.y)
      // поэтому wheel по умолчанию должен листать Y; Shift+wheel — менять Z.
      if (event.shiftKey) {
        if (comparisonSync) {
          const nz = clamp(comparisonSync.linkedSliceIndex + deltaZ, 0, frames.length - 1)
          comparisonSync.onLinkedSliceIndexChange(nz)
          return
        }
        setCrosshair((value) => ({ ...value, z: clamp(value.z + deltaZ, 0, frames.length - 1) }))
        return
      }

      const ny = clamp(effectiveCrosshair.y + deltaZ, 0, frames[0].rows - 1)
      if (comparisonSync) {
        comparisonSync.onLinkedCrosshairPatch({ y: ny })
      } else {
        setCrosshair((value) => ({ ...value, y: ny }))
      }
      return
    }

    if (viewport === 'sagittal') {
      // В sagittal рендерится "стек" по X (plane выбирается по effectiveCrosshair.x)
      // поэтому wheel по умолчанию должен листать X; Shift+wheel — менять Z.
      if (event.shiftKey) {
        if (comparisonSync) {
          const nz = clamp(comparisonSync.linkedSliceIndex + deltaZ, 0, frames.length - 1)
          comparisonSync.onLinkedSliceIndexChange(nz)
          return
        }
        setCrosshair((value) => ({ ...value, z: clamp(value.z + deltaZ, 0, frames.length - 1) }))
        return
      }

      const nx = clamp(effectiveCrosshair.x + deltaZ, 0, frames[0].columns - 1)
      if (comparisonSync) {
        comparisonSync.onLinkedCrosshairPatch({ x: nx })
      } else {
        setCrosshair((value) => ({ ...value, x: nx }))
      }
    }
  }

  function startResize(mode: 'mprVertical' | 'mprHorizontal' | 'gridX' | 'gridY') {
    resizeModeRef.current = mode
  }

  function togglePaneExpand(vp: ViewportKind) {
    if (layoutMode !== 'mpr') return
    setExpandedViewport((cur) => (cur === vp ? null : vp))
  }

  function renderCanvas(viewport: ViewportKind) {
    const data = viewportImages[viewport]
    const rect = paneRects[viewport]
    const isHidden = rect.width <= 0 || rect.height <= 0
    const canExpand =
      layoutMode === 'mpr' &&
      workspaceMode === 'diagnostic' &&
      (viewport === 'axial' || viewport === 'coronal' || viewport === 'sagittal')

    return (
      <div
        className={activeViewport === viewport ? 'viewport-pane is-active' : 'viewport-pane'}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          display: isHidden ? 'none' : 'block',
        }}
      >
        {(() => {
          const axisMax =
            viewport === 'axial'
              ? Math.max(0, frames.length - 1)
              : viewport === 'coronal'
                ? Math.max(0, (frames[0]?.rows ?? 1) - 1)
                : viewport === 'sagittal'
                  ? Math.max(0, (frames[0]?.columns ?? 1) - 1)
                  : 0
          const axisValue =
            viewport === 'axial'
              ? sliceZ
              : viewport === 'coronal'
                ? effectiveCrosshair.y
                : viewport === 'sagittal'
                  ? effectiveCrosshair.x
                  : 0
          if (
            !(
              workspaceMode === 'diagnostic' &&
              frames.length > 1 &&
              (viewport === 'axial' || viewport === 'coronal' || viewport === 'sagittal')
            )
          ) {
            return null
          }
          return (
            <div
              className="slice-scrollbar"
              title="Срез"
              onPointerDown={(e) => {
                const track = e.currentTarget.querySelector('.slice-scrollbar-track') as HTMLDivElement | null
                if (!track) return
                setActiveViewport(viewport)
                const rectT = track.getBoundingClientRect()
                const h = Math.max(1, rectT.height)
                const toAxis = (clientY: number) => {
                  const t = clamp((clientY - rectT.top) / h, 0, 1)
                  return Math.round(t * axisMax)
                }
                const setAxisValue = (v: number) => {
                  const nv = clamp(v, 0, axisMax)
                  if (viewport === 'axial') {
                    if (comparisonSync) comparisonSync.onLinkedSliceIndexChange(nv)
                    else setCrosshair((ch) => ({ ...ch, z: nv }))
                    return
                  }
                  if (viewport === 'coronal') {
                    if (comparisonSync) comparisonSync.onLinkedCrosshairPatch({ y: nv })
                    else setCrosshair((ch) => ({ ...ch, y: nv }))
                    return
                  }
                  if (comparisonSync) comparisonSync.onLinkedCrosshairPatch({ x: nv })
                  else setCrosshair((ch) => ({ ...ch, x: nv }))
                }
                e.preventDefault()
                setAxisValue(toAxis(e.clientY))
                const onMove = (ev: PointerEvent) => setAxisValue(toAxis(ev.clientY))
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
            >
              <div className="slice-scrollbar-track">
                <div
                  className="slice-scrollbar-thumb"
                  style={{
                    top: `${(axisValue / Math.max(1, axisMax)) * 100}%`,
                  }}
                />
              </div>
              <div className="slice-scrollbar-label">{Math.round(axisValue) + 1}</div>
            </div>
          )
        })()}
        {canExpand ? (
          <div className="viewport-chrome">
            <button
              type="button"
              className="viewport-chrome-btn"
              title={expandedViewport === viewport ? 'Вернуть MPR' : 'Развернуть окно'}
              aria-label={expandedViewport === viewport ? 'Вернуть MPR' : 'Развернуть окно'}
              onClick={() => togglePaneExpand(viewport)}
            >
              {expandedViewport === viewport ? (
                <IconCollapse className="chrome-svg" />
              ) : (
                <IconExpand className="chrome-svg" />
              )}
            </button>
          </div>
        ) : null}
        {pathologyTooltip && pathologyTooltip.viewport === viewport && !isHidden ? (
          <div
            className="pathology-tooltip-floating"
            style={{ left: pathologyTooltip.left, top: pathologyTooltip.top }}
            role="tooltip"
          >
            <strong className="pathology-tooltip-title">{pathologyTooltip.label}</strong>
            <p className="pathology-tooltip-organ">{pathologyTooltip.organSystem}</p>
            <p className="pathology-tooltip-summary">{pathologyTooltip.summary}</p>
            <p className="pathology-tooltip-details">{pathologyTooltip.details}</p>
          </div>
        ) : null}
        <canvas
          ref={(node) => {
            if (viewport === 'axial') axialRef.current = node
            if (viewport === 'coronal') coronalRef.current = node
            if (viewport === 'sagittal') sagittalRef.current = node
            if (viewport === 'axialAlt') axialAltRef.current = node
          }}
          className={`viewer-surface ${getCanvasCursor(activeTool, spaceDown && workspaceMode === 'diagnostic')}`}
          onMouseDown={(event) =>
            handlePointerDown(
              event,
              viewport,
              data || { width: 1, height: 1, worldWidth: 1, worldHeight: 1, pixels: new Float32Array(1) },
            )
          }
          onMouseMove={(event) =>
            handlePointerMove(
              event,
              viewport,
              data || { width: 1, height: 1, worldWidth: 1, worldHeight: 1, pixels: new Float32Array(1) },
            )
          }
          onMouseUp={(event) =>
            handlePointerUp(
              event,
              viewport,
              data || { width: 1, height: 1, worldWidth: 1, worldHeight: 1, pixels: new Float32Array(1) },
            )
          }
          onMouseLeave={(event) => {
            setPathologyTooltip(null)
            setHuRoiPolyHover(null)
            setAngleHover(null)
            handlePointerUp(
              event,
              viewport,
              data || { width: 1, height: 1, worldWidth: 1, worldHeight: 1, pixels: new Float32Array(1) },
            )
          }}
          onContextMenu={(event) => {
            if (workspaceMode !== 'diagnostic') return
            if (activeTool === 'huRoiPoly') {
              event.preventDefault()
              setHuRoiPolyPoints((prev) => {
                if (prev.length === 0) return prev
                const next = prev.slice(0, -1)
                if (next.length === 0) setHuRoiPolyDraftSliceZ(null)
                return next
              })
              setHuRoiPolyHover(null)
              return
            }
            if (activeTool === 'angle') {
              event.preventDefault()
              setAnglePoints((prev) => {
                const next = prev.length > 0 ? prev.slice(0, -1) : prev
                if (next.length === 0) setAngleDraftSliceZ(null)
                return next
              })
              setAngleHover(null)
            }
          }}
          onWheel={(event) => handleWheel(event, viewport)}
        />
      </div>
    )
  }

  const isVolumeMode = workspaceMode !== 'diagnostic'

  if (!activeSeries) {
    return (
      <section className="viewer-card">
        <div className="viewer-empty">Выберите серию исследования, чтобы открыть viewer.</div>
      </section>
    )
  }

  function patchActiveViewportFlip(axis: 'H' | 'V') {
    const vk = activeViewport
    const cur = { ...getInitialViewportState(), ...effectiveViewportStates[vk] }
    const next =
      axis === 'H' ? { ...cur, flipH: !cur.flipH } : { ...cur, flipV: !cur.flipV }
    if (comparisonSync) {
      comparisonSync.onLinkedViewportStatesChange({
        ...comparisonSync.linkedViewportStates,
        [vk]: next,
      })
    } else {
      setViewportStates((prev) => ({ ...prev, [vk]: next }))
    }
  }

  function persistSession() {
    saveWorkstationPrefs({
      workspaceMode,
      layoutMode,
      clinicalViewModeId: clinicalViewModeIdActive,
      presetId: presetIdActive,
      clipStart,
      clipEnd,
      removeTable,
      suppressBone,
      vesselBoost,
      boneSuppress: boneSuppressTf,
      segEnabled,
      segHuMin,
      segHuMax,
      interpolation2d,
      superCrisp2d,
    })
  }

  async function exportAnonymousZip() {
    if (!activeSeries) return
    const files = activeSeries.files.map((f) => f.file)
    const blob = await zipFilesAsAnonymous(files, activeSeries.studyInstanceUid)
    downloadBlob(blob, `AIVision_export_${activeSeries.studyInstanceUid.slice(-12)}.zip`)
  }

  function exportViewportPng() {
    const ref =
      layoutMode === 'single'
        ? singleViewport === 'coronal'
          ? coronalRef
          : singleViewport === 'sagittal'
            ? sagittalRef
            : axialRef
        : axialRef
    const canvas = ref.current
    if (!canvas || !activeSeries) return
    canvas.toBlob(
      (blob) => {
        if (blob) {
          downloadBlob(
            blob,
            `AIVision_${activeSeries.seriesInstanceUid.slice(-10)}_z${sliceZ + 1}.png`,
          )
        }
      },
      'image/png',
    )
  }

  async function exportViewportSecondaryCaptureDicom() {
    const ref =
      layoutMode === 'single'
        ? singleViewport === 'coronal'
          ? coronalRef
          : singleViewport === 'sagittal'
            ? sagittalRef
            : axialRef
        : axialRef
    const canvas = ref.current
    const srcFile = activeSeries?.files[sliceZ]?.file
    if (!canvas || !activeSeries || !srcFile) return
    try {
      setViewerError('')
      const fr = frames[sliceZ]
      const imageComments =
        fr &&
        formatAxialAnnotationSummary(sliceZ, measurement, angleFinal, fr.pixelSpacingX, fr.pixelSpacingY, {
          huRoiRect,
          huRoiPoly: huRoiPolyFinal,
          frameHu:
            fr.huPixels.length === fr.columns * fr.rows
              ? { huPixels: fr.huPixels, columns: fr.columns, rows: fr.rows }
              : null,
        })
      const blob = await buildViewportSecondaryCaptureBlob(srcFile, canvas, {
        imageComments: imageComments || undefined,
      })
      downloadBlob(
        blob,
        `AIVision_SC_${activeSeries.seriesInstanceUid.slice(-10)}_z${sliceZ + 1}.dcm`,
      )
    } catch (e) {
      setViewerError(e instanceof Error ? e.message : 'Ошибка экспорта DICOM')
    }
  }

  const tagsSourceFile = activeSeries.files[sliceZ]?.file ?? null

  const clinicalToPresetId: Record<string, string> = {
    lung: 'lung',
    bronchi: 'lung',
    soft_tissue: 'soft',
    bone: 'bone',
    vessels: 'angio',
    heart: 'mediastinum',
    aorta_oas: 'mediastinum',
    joints: 'bone',
    tumor: 'soft',
  }

  function applyClinicalViewMode(id: string) {
    const m = getClinicalViewMode(id)
    if (!m) return
    const nextPreset = clinicalToPresetId[id] ?? 'soft'
    setClinicalViewModeId(id)
    comparisonSync?.onLinkedClinicalViewModeChange(id)
    setPresetId(nextPreset)
    comparisonSync?.onLinkedPresetIdChange(nextPreset)
    if (comparisonSync) {
      comparisonSync.onLinkedWindowChange(m.windowCenter, m.windowWidth)
    } else {
      setWindowCenter(m.windowCenter)
      setWindowWidth(m.windowWidth)
    }
    setActiveTool(m.defaultTool as ToolMode)
  }

  return (
    <section className={isVolumeMode ? 'viewer-card workstation-card volume-mode' : 'viewer-card workstation-card'}>
      <div className={toolPanelCollapsed ? 'workstation-shell tools-collapsed' : 'workstation-shell'}>
        <div className="workstation-main">
          {viewerError ? <p className="viewer-error">{viewerError}</p> : null}

          <div className="viewer-stage-shell">
            {workspaceMode === 'diagnostic' ? (
              <div className="viewer-stage" ref={viewerAreaRef}>
                {layoutMode === 'single'
                  ? renderCanvas(singleViewport)
                  : (
                    <>
                      {renderCanvas('axial')}
                      {renderCanvas('coronal')}
                      {renderCanvas('sagittal')}
                      {layoutMode === 'grid' ? renderCanvas('axialAlt') : null}
                    </>
                  )}

                {layoutMode === 'mpr' ? (
                  <>
                    <div
                      className="viewer-splitter vertical"
                      style={{ left: paneRects.axial.width }}
                      onPointerDown={() => startResize('mprVertical')}
                    />
                    <div
                      className="viewer-splitter horizontal"
                      style={{
                        left: paneRects.coronal.left,
                        top: paneRects.coronal.height,
                        width: paneRects.coronal.width,
                      }}
                      onPointerDown={() => startResize('mprHorizontal')}
                    />
                  </>
                ) : null}

                {layoutMode === 'grid' ? (
                  <>
                    <div
                      className="viewer-splitter vertical"
                      style={{ left: paneRects.axial.width }}
                      onPointerDown={() => startResize('gridX')}
                    />
                    <div
                      className="viewer-splitter horizontal full"
                      style={{ top: paneRects.axial.height }}
                      onPointerDown={() => startResize('gridY')}
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <EnterpriseVolume3DViewport
                activeSeries={activeSeries}
                nativeSeries={nativeSeries}
                presetId={enterprisePresetId}
                navigationMode={activeTool === 'pan' ? 'pan' : enterpriseNavigationMode}
                rebuildToken={enterpriseRebuildTick}
                useAllSlices={enterpriseUseAllSlices}
                clipStart={clipBounds.start}
                clipEnd={clipBounds.end}
                removeTable={enterpriseRemoveTable}
                clipX={clipPlaneX}
                clipY={clipPlaneY}
                clipZ={clipPlaneZ}
                qualityTier="balanced"
                scalarShift={enterpriseScalarShift}
                opacityGain={enterpriseOpacityGain}
                vesselBoost={enterpriseVesselBoost}
                boneTame={enterpriseBoneTame}
              />
            )}
          </div>
        </div>

        <aside className={toolPanelCollapsed ? 'vertical-toolbar collapsed' : 'vertical-toolbar'}>
          {toolPanelCollapsed ? (
            <div className="mini-toolbar" aria-label="Мини-панель">
              <button
                type="button"
                className="rail-toggle-button toolpanel-toggle"
                onClick={() => setToolPanelCollapsed(false)}
                title="Развернуть панель"
                aria-label="Развернуть панель"
              >
                <IconChevronDoubleRight className="toolbar-svg compact" />
              </button>

              <div className="mini-toolbar-group" aria-label="2D/3D">
                <button
                  type="button"
                  className={workspaceMode === 'diagnostic' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                  title="2D"
                  aria-label="2D"
                  aria-pressed={workspaceMode === 'diagnostic'}
                  onClick={() => applyWorkspaceMode('diagnostic')}
                >
                  <Icon2D className="toolbar-svg" />
                </button>
                <button
                  type="button"
                  className={workspaceMode !== 'diagnostic' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                  title="3D"
                  aria-label="3D"
                  aria-pressed={workspaceMode !== 'diagnostic'}
                  onClick={() => applyWorkspaceMode(lastVolumeModeRef.current)}
                >
                  <IconCTA3D className="toolbar-svg" />
                </button>
              </div>

              {workspaceMode === 'diagnostic' ? (
                <>
                  <div className="mini-toolbar-group" aria-label="Инструменты">
                    <button
                      type="button"
                      className={activeTool === 'windowLevel' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="Окно/уровень"
                      aria-label="Окно/уровень"
                      aria-pressed={activeTool === 'windowLevel'}
                      onClick={() => setActiveTool('windowLevel')}
                    >
                      <IconWL className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'pan' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="Перемещение"
                      aria-label="Перемещение"
                      aria-pressed={activeTool === 'pan'}
                      onClick={() => setActiveTool('pan')}
                    >
                      <IconPan className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'zoom' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="Зум"
                      aria-label="Зум"
                      aria-pressed={activeTool === 'zoom'}
                      onClick={() => setActiveTool('zoom')}
                    >
                      <IconZoom className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'length' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="Линейка"
                      aria-label="Линейка"
                      aria-pressed={activeTool === 'length'}
                      onClick={() => setActiveTool('length')}
                    >
                      <IconRuler className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'angle' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="Угол"
                      aria-label="Угол"
                      aria-pressed={activeTool === 'angle'}
                      onClick={() => setActiveTool('angle')}
                    >
                      <IconAngle className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'huRoi' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="ROI (прямоугольник)"
                      aria-label="ROI прямоугольник"
                      aria-pressed={activeTool === 'huRoi'}
                      onClick={() => setActiveTool('huRoi')}
                    >
                      <IconHuRoi className="toolbar-svg" />
                    </button>
                    <button
                      type="button"
                      className={activeTool === 'huRoiPoly' ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title="ROI (полигон)"
                      aria-label="ROI полигон"
                      aria-pressed={activeTool === 'huRoiPoly'}
                      onClick={() => setActiveTool('huRoiPoly')}
                    >
                      <IconHuRoiPoly className="toolbar-svg" />
                    </button>
                  </div>
                  <div className="mini-toolbar-group" aria-label="Вид">
                    <button
                      type="button"
                      className="vertical-tool icon-only reset"
                      title="Сброс вида (масштаб, сдвиг, зеркала)"
                      aria-label="Сброс вида"
                      onClick={() => resetView()}
                    >
                      <IconReset className="toolbar-svg" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="mini-toolbar-group" aria-label="3D">
                  <button
                    type="button"
                    className={
                      enterpriseNavigationMode === 'rotate'
                        ? 'vertical-tool icon-only active'
                        : 'vertical-tool icon-only'
                    }
                    title="Вращение 3D"
                    aria-label="Вращение 3D"
                    aria-pressed={enterpriseNavigationMode === 'rotate'}
                    onClick={() => {
                      setEnterpriseNavigationMode('rotate')
                    }}
                  >
                    <IconCTA3D className="toolbar-svg" />
                  </button>
                  <button
                    type="button"
                    className={
                      enterpriseNavigationMode === 'pan'
                        ? 'vertical-tool icon-only active'
                        : 'vertical-tool icon-only'
                    }
                    title="Рука (перемещение) · также Space + ЛКМ"
                    aria-label="Рука (перемещение)"
                    aria-pressed={enterpriseNavigationMode === 'pan'}
                    onClick={() => {
                      setEnterpriseNavigationMode('pan')
                    }}
                  >
                    <IconPan className="toolbar-svg" />
                  </button>
                  <button
                    type="button"
                    className="vertical-tool icon-only reset"
                    title="Сброс камеры"
                    aria-label="Сброс камеры"
                    onClick={() => setVolResetCameraTick((n) => n + 1)}
                  >
                    <IconReset className="toolbar-svg" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="right-inspector">
            <div className="right-inspector-header">
              <div className="right-inspector-topline">
                <div className="right-inspector-title">Инструменты</div>

                <button
                  type="button"
                  className="rail-toggle-button toolpanel-toggle"
                  onClick={() => setToolPanelCollapsed((v) => !v)}
                  title={toolPanelCollapsed ? 'Показать панель инструментов' : 'Скрыть панель инструментов'}
                  aria-label={toolPanelCollapsed ? 'Показать панель инструментов' : 'Скрыть панель инструментов'}
                >
                  {toolPanelCollapsed ? (
                    <IconChevronDoubleRight className="toolbar-svg compact" />
                  ) : (
                    <IconChevronDoubleLeft className="toolbar-svg compact" />
                  )}
                </button>
              </div>
            </div>

            <div className="right-inspector-body">

          <div className="toolbar-section" aria-label="Рабочая область">
            <div className="right-inspector-iconbar">
              {WORKSPACE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={workspaceMode === item.id ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                  title={item.title}
                  aria-label={item.title}
                  aria-pressed={workspaceMode === item.id}
                  onClick={() => applyWorkspaceMode(item.id)}
                >
                  {item.id === 'diagnostic' ? (
                    <Icon2D className="toolbar-svg" />
                  ) : item.id === 'cta3d' ? (
                    <IconCTA3D className="toolbar-svg" />
                  ) : (
                    <IconAirways className="toolbar-svg" />
                  )}
                </button>
              ))}
            </div>

            {isVolumeMode ? (
              <div className="right-inspector-iconbar">
                <button
                  type="button"
                  className={
                    enterpriseNavigationMode === 'rotate'
                      ? 'vertical-tool icon-only active'
                      : 'vertical-tool icon-only'
                  }
                  title="Вращение 3D"
                  aria-label="Вращение 3D"
                  aria-pressed={enterpriseNavigationMode === 'rotate'}
                  onClick={() => {
                    setEnterpriseNavigationMode('rotate')
                  }}
                >
                  <IconCTA3D className="toolbar-svg" />
                </button>
                <button
                  type="button"
                  className={
                    enterpriseNavigationMode === 'pan'
                      ? 'vertical-tool icon-only active'
                      : 'vertical-tool icon-only'
                  }
                  title="Рука (перемещение) · также Space + ЛКМ"
                  aria-label="Рука (перемещение)"
                  aria-pressed={enterpriseNavigationMode === 'pan'}
                  onClick={() => {
                    setEnterpriseNavigationMode('pan')
                  }}
                >
                  <IconPan className="toolbar-svg" />
                </button>
                <button
                  type="button"
                  className="vertical-tool icon-only reset"
                  title="Сброс камеры"
                  aria-label="Сброс камеры"
                  onClick={() => setVolResetCameraTick((n) => n + 1)}
                >
                  <IconReset className="toolbar-svg" />
                </button>
              </div>
            ) : null}

            {!isVolumeMode ? (
              <>
                <div className="right-inspector-iconbar">
                  {LAYOUT_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={layoutMode === item.id ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title={item.title}
                      aria-label={item.title}
                      aria-pressed={layoutMode === item.id}
                      onClick={() => {
                        setLayoutMode(item.id)
                        setExpandedViewport(null)
                      }}
                    >
                      {item.id === 'single' ? (
                        <IconLayout1 className="toolbar-svg" />
                      ) : item.id === 'grid' ? (
                        <IconLayoutGrid className="toolbar-svg" />
                      ) : (
                        <IconLayoutMPR className="toolbar-svg" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="right-inspector-iconbar">
                  {WINDOW_BUTTONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={singleViewport === item.id ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                      title={item.title}
                      aria-label={item.title}
                      aria-pressed={singleViewport === item.id}
                      onClick={() => {
                        setSingleViewport(item.id)
                        setActiveViewport(item.id)
                        setLayoutMode('single')
                        setExpandedViewport(null)
                      }}
                    >
                      {item.id === 'axial' ? (
                        <IconPlaneAxial className="toolbar-svg" />
                      ) : item.id === 'coronal' ? (
                        <IconPlaneCoronal className="toolbar-svg" />
                      ) : (
                        <IconPlaneSagittal className="toolbar-svg" />
                      )}
                    </button>
                  ))}
                </div>

                <select
                  id="clinical-mode-select"
                  className="vertical-toolbar-select"
                  value={clinicalViewModeIdActive}
                  onChange={(e) => applyClinicalViewMode(e.target.value)}
                  title="Клинический режим (W/L пресет + дефолтный инструмент)"
                >
                  {CLINICAL_VIEW_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.shortLabel} — {m.label}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <div className="right-inspector-iconbar">
              {!isVolumeMode ? (
                <>
                  <button
                    type="button"
                    className={cinePlaying ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                    title="Cine: автопрокрутка срезов (2D)"
                    aria-label="Cine"
                    aria-pressed={cinePlaying}
                    onClick={() => setCinePlaying((v) => !v)}
                  >
                    <IconPlayPause playing={cinePlaying} className="toolbar-svg" />
                  </button>
                  <button
                    type="button"
                    className="vertical-tool icon-only"
                    title="Теги DICOM активного среза"
                    aria-label="DICOM-теги"
                    onClick={() => setTagsModalOpen(true)}
                  >
                    <IconTags className="toolbar-svg" />
                  </button>
                  <button
                    type="button"
                    className="vertical-tool icon-only"
                    title="Сохранить видимое изображение в PNG"
                    aria-label="Экспорт PNG"
                    onClick={() => exportViewportPng()}
                  >
                    <IconSnapshot className="toolbar-svg" />
                  </button>
                  <button
                    type="button"
                    className="vertical-tool icon-only"
                    title="Экспорт текущего вида как DICOM Secondary Capture (OT)"
                    aria-label="Экспорт Secondary Capture DICOM"
                    onClick={() => void exportViewportSecondaryCaptureDicom()}
                  >
                    <IconSecondaryCapture className="toolbar-svg" />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="vertical-tool icon-only"
                title="Сохранить настройки интерфейса"
                aria-label="Сохранить настройки"
                onClick={() => persistSession()}
              >
                <IconSave className="toolbar-svg" />
              </button>
              <button
                type="button"
                className="vertical-tool icon-only"
                title="Экспорт ZIP с обезличенными именами файлов"
                aria-label="Экспорт анонимный ZIP"
                onClick={() => void exportAnonymousZip()}
              >
                <IconExport className="toolbar-svg" />
              </button>
            </div>
          </div>

          {isVolumeMode ? (
            <>
              <details className="tool-acc" style={{ display: 'none' }} aria-hidden>
                <summary className="tool-acc-summary">3d</summary>
                <div className="toolbar-section tool-acc-body">
                  <div className="inspector-group">
                    <div className="inspector-row" title="Сдвиг опорных точек TF по HU">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Сдвиг HU</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={-200}
                          max={200}
                          value={volScalarShift}
                          onChange={(e) => setVolScalarShift(Number(e.target.value))}
                        />
                        <span className="inspector-value">
                          {volScalarShift > 0 ? '+' : ''}
                          {volScalarShift}
                        </span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Множитель непрозрачности DVR / MinIP">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Непрозрачность</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={40}
                          max={180}
                          value={Math.round(volOpacityGain * 100)}
                          onChange={(e) => setVolOpacityGain(Number(e.target.value) / 100)}
                        />
                        <span className="inspector-value">{Math.round(volOpacityGain * 100)}%</span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Сбросить камеру">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Камера</span>
                      </span>
                      <span className="inspector-control">
                        <button
                          type="button"
                          className="vertical-tool icon-only reset"
                          onClick={() => setVolResetCameraTick((n) => n + 1)}
                          aria-label="Сброс камеры"
                          title="Сброс камеры"
                        >
                          <IconReset className="toolbar-svg" />
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              </details>

              <details className="tool-acc" open>
                <summary className="tool-acc-summary">3D</summary>

                <div className="toolbar-section tool-acc-body">
                  <div className="inspector-group">
                    <div className="inspector-row" title="Enterprise пресеты: строятся на сервере и загружаются как 3D-сетка (GLB)">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Пресет</span>
                      </span>
                      <span className="inspector-control">
                        <div className="segmented-control">
                          <button
                            type="button"
                            className={enterprisePresetId === 'aorta' ? 'segment-button active' : 'segment-button'}
                            onClick={() => setEnterprisePresetId('aorta')}
                            title="Аорта"
                          >
                            Aorta
                          </button>
                          <button
                            type="button"
                            className={enterprisePresetId === 'vessels_general' ? 'segment-button active' : 'segment-button'}
                            onClick={() => setEnterprisePresetId('vessels_general')}
                            title="Сосуды"
                          >
                            Vessels
                          </button>
                          <button
                            type="button"
                            className={enterprisePresetId === 'bones' ? 'segment-button active' : 'segment-button'}
                            onClick={() => setEnterprisePresetId('bones')}
                            title="Кости"
                          >
                            Bones
                          </button>
                          <button
                            type="button"
                            className={enterprisePresetId === 'lungs' ? 'segment-button active' : 'segment-button'}
                            onClick={() => setEnterprisePresetId('lungs')}
                            title="Лёгкие"
                          >
                            Lungs
                          </button>
                        </div>
                      </span>
                    </div>

                    <div className="inspector-row" title="Навигация: вращение или перемещение (перетаскивание по плоскости)">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Навигация</span>
                      </span>
                      <span className="inspector-control">
                        <div className="segmented-control">
                          <button
                            type="button"
                            className={
                              enterpriseNavigationMode === 'rotate'
                                ? 'segment-button active'
                                : 'segment-button'
                            }
                            onClick={() => {
                              setEnterpriseNavigationMode('rotate')
                            }}
                            title="Вращение"
                          >
                            Вращение
                          </button>
                          <button
                            type="button"
                            className={
                              enterpriseNavigationMode === 'pan'
                                ? 'segment-button active'
                                : 'segment-button'
                            }
                            onClick={() => {
                              setEnterpriseNavigationMode('pan')
                            }}
                            title="Перемещение"
                          >
                            Перемещение
                          </button>
                        </div>
                      </span>
                    </div>

                    <div className="inspector-row" title="Все срезы = точнее, но медленнее. Превью = быстрее для интерактива.">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Срезы</span>
                      </span>
                      <span className="inspector-control">
                        <label className="inline-checkbox">
                          <input
                            type="checkbox"
                            checked={enterpriseUseAllSlices}
                            onChange={(e) => setEnterpriseUseAllSlices(e.target.checked)}
                          />
                          <span>Все срезы</span>
                        </label>
                      </span>
                    </div>

                    <div className="inspector-row" title="Native (NAC) серия нужна для DSA (contrast - native) в Aorta/Vessels">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Native (NAC)</span>
                      </span>
                      <span className="inspector-control">
                        <select
                          className="comparison-series-select"
                          value={nativeSeriesUid || ''}
                          onChange={(e) => onNativeSeriesUidChange?.(e.target.value)}
                        >
                          <option value="">— не выбрана —</option>
                          {allSeries
                            .filter((s) => s.seriesInstanceUid !== activeSeries.seriesInstanceUid)
                            .map((s) => (
                              <option key={s.seriesInstanceUid} value={s.seriesInstanceUid}>
                                {(s.seriesDescription || 'Серия')} · {s.modality} · {s.files.length}
                              </option>
                            ))}
                        </select>
                      </span>
                    </div>

                    <div className="inspector-row" title="Сдвиг шкалы HU для transfer function">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Сдвиг HU</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={-250}
                          max={250}
                          value={enterpriseScalarShift}
                          onChange={(e) => setEnterpriseScalarShift(Number(e.target.value))}
                        />
                        <span className="inspector-value">
                          {enterpriseScalarShift > 0 ? '+' : ''}
                          {enterpriseScalarShift}
                        </span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Общая прозрачность/яркость объёмного рендера">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Opacity</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={40}
                          max={220}
                          value={Math.round(enterpriseOpacityGain * 100)}
                          onChange={(e) => setEnterpriseOpacityGain(Number(e.target.value) / 100)}
                        />
                        <span className="inspector-value">{Math.round(enterpriseOpacityGain * 100)}%</span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Усиление сосудистого диапазона (контраст 150–450 HU)">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Vessel boost</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(enterpriseVesselBoost * 100)}
                          onChange={(e) => setEnterpriseVesselBoost(Number(e.target.value) / 100)}
                        />
                        <span className="inspector-value">{Math.round(enterpriseVesselBoost * 100)}%</span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Подавление плотной кости (550+ HU) в CTA">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Bone tame</span>
                      </span>
                      <span className="inspector-control">
                        <input
                          className="inspector-mini-range"
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(enterpriseBoneTame * 100)}
                          onChange={(e) => setEnterpriseBoneTame(Number(e.target.value) / 100)}
                        />
                        <span className="inspector-value">{Math.round(enterpriseBoneTame * 100)}%</span>
                      </span>
                    </div>

                    <div className="inspector-row" title="Убрать стол/ложемент при сборке 3D тома">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Стол</span>
                      </span>
                      <span className="inspector-control">
                        <label className="inline-checkbox">
                          <input
                            type="checkbox"
                            checked={enterpriseRemoveTable}
                            onChange={(e) => setEnterpriseRemoveTable(e.target.checked)}
                          />
                          <span>Убрать стол</span>
                        </label>
                      </span>
                    </div>

                    <div className="inspector-row" title="Перестроить 3D: повторный запрос на backend /v1/visualize">
                      <span className="inspector-label">
                        <span className="inspector-label-text">Действия</span>
                      </span>
                      <span className="inspector-control">
                        <button
                          type="button"
                          className="vertical-tool is-subtle"
                          onClick={() => setEnterpriseRebuildTick((n) => n + 1)}
                          title="Перестроить 3D"
                        >
                          <span className="vertical-tool-label">Перестроить</span>
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              </details>

              <details className="tool-acc">
                <summary className="tool-acc-summary">Маски</summary>
                <div className="toolbar-section tool-acc-body">
                  <label className="vertical-tool-label-above" htmlFor="vol-mask-url">
                    NIfTI URL
                  </label>
                  <input
                    id="vol-mask-url"
                    className="vertical-toolbar-url-input"
                    type="url"
                    placeholder="https://…/total_multilabel.nii.gz"
                    value={volumeMaskUrl ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim() || null
                      setVolumeMaskUrl(v)
                      if (!v) setVolumeMaskServerMeta(null)
                    }}
                    title="Multilabel NIfTI (CORS)"
                  />
                  <label className="vertical-slider-control compact" title="Прозрачность слоя меток">
                    <span>α</span>
                    <input
                      type="range"
                      min={5}
                      max={90}
                      value={Math.round(volumeMaskOpacity * 100)}
                      onChange={(e) => setVolumeMaskOpacity(Number(e.target.value) / 100)}
                    />
                    <strong>{Math.round(volumeMaskOpacity * 100)}%</strong>
                  </label>
                  <button
                    type="button"
                    className="vertical-tool is-subtle"
                    onClick={() => {
                      setVolumeMaskUrl(null)
                      setVolumeMaskServerMeta(null)
                    }}
                    title="Снять оверлей маски"
                  >
                    <span className="vertical-tool-label">Сброс</span>
                  </button>
                </div>
              </details>
            </>
          ) : (
            <div className="toolbar-section toolbar-section-icons">
              {TOOL_ITEMS.map((item, ti) => (
                <button
                  key={item.id}
                  className={activeTool === item.id ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                  onClick={() => setActiveTool(item.id)}
                  type="button"
                  title={`${item.title} · клавиша ${ti + 1}`}
                  aria-label={item.title}
                >
                  {toolIcon(item.id)}
                </button>
              ))}
              <button
                type="button"
                className={interpolation2d ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                title={
                  workspaceMode === 'diagnostic'
                    ? 'В 2D диагностике сглаживание отключено, чтобы не «мылить».'
                    : 'Интерполяция 2D при масштабе: вкл — сглаживание (билинейная), выкл — ближайший сосед (чёткие пиксели)'
                }
                aria-label="Интерполяция 2D при масштабе"
                aria-pressed={interpolation2d}
                disabled={workspaceMode === 'diagnostic'}
                onClick={() => {
                  if (workspaceMode === 'diagnostic') return
                  setInterpolation2d((v) => {
                    const next = !v
                    saveWorkstationPrefs({ interpolation2d: next })
                    return next
                  })
                }}
              >
                <IconInterp2d className="toolbar-svg" />
              </button>
              <button
                type="button"
                className={superCrisp2d ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                title={
                  workspaceMode === 'diagnostic'
                    ? 'Супер-чётко: привязка 2D-рендера к целым пикселям экрана (без дробных смещений/размеров).'
                    : 'Супер-чётко работает только в диагностическом 2D.'
                }
                aria-label="Супер-чёткий 2D"
                aria-pressed={superCrisp2d}
                disabled={workspaceMode !== 'diagnostic'}
                onClick={() => {
                  if (workspaceMode !== 'diagnostic') return
                  setSuperCrisp2d((v) => {
                    const next = !v
                    saveWorkstationPrefs({ superCrisp2d: next })
                    return next
                  })
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: 0.2 }}>HD</span>
              </button>
              <button
                type="button"
                className={
                  effectiveViewportStates[activeViewport].flipH
                    ? 'vertical-tool icon-only active'
                    : 'vertical-tool icon-only'
                }
                title="Зеркало слева-направо (LR) — активное окно MPR"
                aria-label="Зеркало LR"
                aria-pressed={effectiveViewportStates[activeViewport].flipH}
                onClick={() => patchActiveViewportFlip('H')}
              >
                <IconFlipH className="toolbar-svg" />
              </button>
              <button
                type="button"
                className={
                  effectiveViewportStates[activeViewport].flipV
                    ? 'vertical-tool icon-only active'
                    : 'vertical-tool icon-only'
                }
                title="Зеркало сверху-вниз — активное окно MPR"
                aria-label="Зеркало сверху-вниз"
                aria-pressed={effectiveViewportStates[activeViewport].flipV}
                onClick={() => patchActiveViewportFlip('V')}
              >
                <IconFlipV className="toolbar-svg" />
              </button>
            </div>
          )}

          {!isVolumeMode ? (
            <div className="toolbar-section">
              <span className="toolbar-title">КТ-скрининг</span>
              {pathologyVolumeResult ? (
                <p className="toolbar-hint-inline toolbar-engine-line">
                  <strong>Источник:</strong> {pathologyVolumeResult.engine.labelRu}
                </p>
              ) : null}
              <button
                type="button"
                className="vertical-tool"
                disabled={
                  !activeSeries ||
                  activeSeries.files.length === 0 ||
                  pathologyScanRunning
                }
                onClick={runPathologyVolumeScan}
                title="Просканировать все загруженные срезы по пороговым правилам"
              >
                <span className="vertical-tool-label">
                  {pathologyScanRunning ? 'Сканирование…' : 'Сканировать серию'}
                </span>
              </button>
              {activeSeries &&
              activeSeries.files.length > 0 &&
              frames.length === 0 &&
              !pathologyScanRunning ? (
                <p className="toolbar-hint-inline">
                  Загрузка срезов… «Сканировать серию» уже можно нажать — анализ стартует после декодирования.
                </p>
              ) : null}
              {pathologyVolumeResult ? (
                <>
                  <p className="toolbar-hint-inline">{pathologyVolumeResult.phaseNote}</p>
                  {pathologyVolumeResult.findings.length === 0 ? (
                    <p className="toolbar-hint-inline">
                      Паттерны по правилам не выделены — попробуйте другие окна W/L.
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="vertical-tool"
                        onClick={() =>
                          jumpToPathologyFocus(
                            pathologyVolumeResult.focusSliceIndex,
                            pathologyVolumeResult.findings[0]?.classId,
                          )
                        }
                        title="Срез с максимальной активностью правил; маркер и крест на точке очага"
                      >
                        <span className="vertical-tool-label">
                          Перейти к точке патологии
                        </span>
                      </button>
                      {pathologyEmphasis !== null ? (
                        <button
                          type="button"
                          className="vertical-tool is-subtle"
                          onClick={() => setPathologyEmphasis(null)}
                        >
                          <span className="vertical-tool-label">Снять маркер патологии</span>
                        </button>
                      ) : null}
                      <ul className="pathology-findings-list">
                        {pathologyVolumeResult.findings.slice(0, 6).map((f) => (
                          <li key={f.id}>
                            <button
                              type="button"
                              className="pathology-finding-jump"
                              onClick={() =>
                                jumpToPathologyFocus(
                                  f.sliceIndices[0] ?? pathologyVolumeResult.focusSliceIndex,
                                  f.classId,
                                )
                              }
                              title="Перейти к срезу и точке маски для этой находки"
                            >
                              <span className="pathology-finding-label">{f.label}</span>
                              <span className="pathology-finding-conf">
                                {(f.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="pathology-finding-slices">
                                срезы {f.sliceIndices.slice(0, 4).map((z) => z + 1).join(', ')}
                                {f.sliceIndices.length > 4 ? '…' : ''}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          {!isVolumeMode && clinicalViewModeIdActive === 'lung' ? (
            <div className="toolbar-section lung-quant-section">
              <span className="toolbar-title">Лёгкие: доли по HU</span>
              {lungQuantReport ? (
                <>
                  <p className="toolbar-hint-inline lung-quant-disclaimer">{lungQuantReport.disclaimerRu}</p>
                  <p className="toolbar-hint-inline">{lungQuantReport.summaryLineRu}</p>
                  {lungQuantReport.categories.length > 0 ? (
                    <table className="lung-quant-table">
                      <thead>
                        <tr>
                          <th>Паттерн (HU-прокси)</th>
                          <th>% паренхимы</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lungQuantReport.categories.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <span className="lung-quant-label">{row.labelRu}</span>
                              <span className="lung-quant-meaning">{row.clinicalMeaningRu}</span>
                            </td>
                            <td className="lung-quant-pct">{row.percentOfLungParenchyma.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {lungQuantReport.mediastinalSoftTissueProxyPercent !== null ? (
                    <p className="toolbar-hint-inline lung-quant-mediastinum">
                      Прокси мягких тканей в широкой зоне средостения/корней (не число узлов):{' '}
                      <strong>{lungQuantReport.mediastinalSoftTissueProxyPercent.toFixed(1)}%</strong> вокселей ROI.
                    </p>
                  ) : null}
                  <p className="toolbar-hint-inline lung-quant-meta">
                    Срезов учтено: {lungQuantReport.slicesIncluded} / {lungQuantReport.slicesTotal} (пропущено{' '}
                    {lungQuantReport.slicesSkipped}, без признака грудной клетки). Вокселей в лёгочной маске:{' '}
                    {lungQuantReport.totalLungVoxels.toLocaleString('ru-RU')}.
                  </p>
                  <details className="lung-quant-details">
                    <summary>Не определяется по этой схеме</summary>
                    <ul className="lung-quant-na-list">
                      {lungQuantReport.notAssessable.map((n) => (
                        <li key={n.id}>
                          <strong>{n.labelRu}</strong> — {n.reasonRu}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : frames.length > 0 ? (
                <p className="toolbar-hint-inline">
                  Нажмите «Сканировать серию» выше — для режима «Лёгкие» будут посчитаны доли HU по всем подходящим
                  срезам грудной клетки.
                </p>
              ) : null}
            </div>
          ) : null}

          {!isVolumeMode && totalsegAortaHuStats ? (
            <div className="toolbar-section totalseg-aorta-stats-section">
              <span className="toolbar-title">TotalSegmentator · аорта</span>
              {totalsegAortaHuStats.summaryLineRu ? (
                <p className="toolbar-hint-inline">{totalsegAortaHuStats.summaryLineRu}</p>
              ) : null}
              {totalsegAortaHuStats.ok && !totalsegAortaHuStats.maskEmpty ? (
                <dl className="totalseg-aorta-dl">
                  {typeof totalsegAortaHuStats.aortaLabelId === 'number' ? (
                    <>
                      <dt>Label ID</dt>
                      <dd>{totalsegAortaHuStats.aortaLabelId}</dd>
                    </>
                  ) : null}
                  {typeof totalsegAortaHuStats.volumeMm3 === 'number' ? (
                    <>
                      <dt>Объём (сегмент)</dt>
                      <dd>{(totalsegAortaHuStats.volumeMm3 * 1e-3).toFixed(1)} см³</dd>
                    </>
                  ) : null}
                  {typeof totalsegAortaHuStats.huMean === 'number' ? (
                    <>
                      <dt>HU средн.</dt>
                      <dd>{totalsegAortaHuStats.huMean.toFixed(1)}</dd>
                    </>
                  ) : null}
                  {typeof totalsegAortaHuStats.huStd === 'number' ? (
                    <>
                      <dt>HU σ</dt>
                      <dd>{totalsegAortaHuStats.huStd.toFixed(1)}</dd>
                    </>
                  ) : null}
                  {typeof totalsegAortaHuStats.huP5 === 'number' &&
                  typeof totalsegAortaHuStats.huP95 === 'number' ? (
                    <>
                      <dt>HU p5–p95</dt>
                      <dd>
                        {totalsegAortaHuStats.huP5.toFixed(0)} … {totalsegAortaHuStats.huP95.toFixed(0)}
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : totalsegAortaHuStats.maskEmpty ? (
                <p className="toolbar-hint-inline totalseg-aorta-warn">
                  {totalsegAortaHuStats.reason === 'shape_mismatch'
                    ? 'Объём и маска разного размера — проверьте тот же NIfTI, что для TotalSegmentator.'
                    : 'Маска аорты пуста на этом объёме (класс не размечен или узкий FOV).'}
                </p>
              ) : null}
              {totalsegAortaHuStats.disclaimerRu ? (
                <p className="toolbar-hint-inline aortic-disclaimer">{totalsegAortaHuStats.disclaimerRu}</p>
              ) : null}
            </div>
          ) : null}

          {!isVolumeMode && (clinicalViewModeIdActive === 'aorta_oas' || aorticScreening) ? (
            <div className="toolbar-section aortic-screening-section">
              <span className="toolbar-title">ОАС · неконтраст</span>
              {aorticScreening ? (
                <>
                  <div className={`aortic-alert-badge aortic-alert-${aorticScreening.alertLevel}`} role="status">
                    {aorticScreening.alertLevel === 'rule_out'
                      ? 'Низкий риск (rule-out)'
                      : aorticScreening.alertLevel === 'review'
                        ? 'Зона пересмотра'
                        : 'Тревога · проверить немедленно'}
                  </div>
                  <div className="aortic-probability-bar-wrap" aria-hidden>
                    <div
                      className="aortic-probability-bar-fill"
                      style={{ width: `${Math.round(aorticScreening.aasProbability * 100)}%` }}
                    />
                  </div>
                  <p className="aortic-probability-line">
                    Вероятность ОАС:{' '}
                    <strong>{(aorticScreening.aasProbability * 100).toFixed(1)}%</strong>
                    <span className="aortic-thresholds">
                      {' '}
                      · пороги p: rule-out &lt; {aorticScreening.thresholdRuleOut.toFixed(2)} · alert &gt;{' '}
                      {aorticScreening.thresholdAlert.toFixed(2)}
                    </span>
                  </p>
                  {aorticScreening.predictedSubtype &&
                  aorticScreening.predictedSubtype !== 'none' &&
                  aorticScreening.predictedSubtype !== 'indeterminate' ? (
                    <p className="toolbar-hint-inline">
                      Класс модели: <strong>{aorticScreening.predictedSubtype}</strong>
                    </p>
                  ) : null}
                  {aorticScreening.modelId ? (
                    <p className="toolbar-hint-inline aortic-mono">modelId: {aorticScreening.modelId}</p>
                  ) : null}
                  <p className="toolbar-hint-inline">{aorticScreening.summaryLineRu}</p>
                  <p className="toolbar-hint-inline aortic-disclaimer">{aorticScreening.disclaimerRu}</p>
                  {aorticScreening.focusSliceIndex !== null ? (
                    <button
                      type="button"
                      className="vertical-tool"
                      onClick={() => jumpToPathologyFocus(aorticScreening.focusSliceIndex!)}
                    >
                      <span className="vertical-tool-label">Перейти к срезу (фокус модели)</span>
                    </button>
                  ) : null}
                  {aorticScreening.heatmapNiftiUrl ? (
                    <button
                      type="button"
                      className="vertical-tool is-subtle"
                      onClick={() => {
                        setVolumeMaskUrl(aorticScreening.heatmapNiftiUrl!)
                        setVolumeMaskServerMeta(null)
                      }}
                    >
                      <span className="vertical-tool-label">Подставить heatmap в URL маски 3D</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="toolbar-hint-inline">
                  Нет данных — запустите «Сканировать серию».
                </p>
              )}
            </div>
          ) : null}

          {!isVolumeMode ? (
            <div className="toolbar-section">
              <span className="toolbar-title">Сегментация</span>
              <button
                type="button"
                className={segEnabled ? 'vertical-tool icon-only active' : 'vertical-tool icon-only'}
                title="Пороговая подсветка сосудов (HU) на аксиале"
                aria-label="Сегментация по порогу"
                onClick={() => setSegEnabled((v) => !v)}
              >
                <IconSeg className="toolbar-svg" />
              </button>
              {segEnabled ? (
                <>
                  <label className="vertical-slider-control compact">
                    <span>HU−</span>
                    <input
                      type="range"
                      min={-200}
                      max={800}
                      value={segHuMin}
                      onChange={(e) => setSegHuMin(Number(e.target.value))}
                    />
                  </label>
                  <label className="vertical-slider-control compact">
                    <span>HU+</span>
                    <input
                      type="range"
                      min={-200}
                      max={1200}
                      value={segHuMax}
                      onChange={(e) => setSegHuMax(Number(e.target.value))}
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {isVolumeMode ? null : null}

          {/* removed: duplicate bottom W/L + planes + reset blocks */}
            </div>
          </div>
          )}
        </aside>
      </div>

      {pathologyPopupOpen && pathologyVolumeResult ? (
        <div
          className="oas-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pathology-modal-title"
        >
          <div className="oas-modal-card">
            <h2 id="pathology-modal-title">Результат КТ-скрининга</h2>
            <div className="oas-modal-body">
              <p className="oas-modal-note">{pathologyVolumeResult.phaseNote}</p>
              <p className="oas-modal-rationale">{pathologyVolumeResult.rationale}</p>
              {pathologyVolumeResult.findings.length > 0 ? (
                <ul className="pathology-modal-list">
                  {pathologyVolumeResult.findings.map((f) => (
                    <li key={f.id}>
                      <strong>{f.label}</strong> — уверенность эвристики ~{(f.confidence * 100).toFixed(0)}%.
                      <br />
                      <span className="pathology-modal-li-detail">{f.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="oas-modal-actions">
              {pathologyVolumeResult.findings.length > 0 ? (
                <button
                  type="button"
                  className="oas-modal-btn primary"
                  onClick={() => {
                    jumpToPathologyFocus(
                      pathologyVolumeResult.focusSliceIndex,
                      pathologyVolumeResult.findings[0]?.classId,
                    )
                    setPathologyPopupOpen(false)
                  }}
                >
                  Перейти к точке патологии
                </button>
              ) : null}
              <button
                type="button"
                className={
                  pathologyVolumeResult.findings.length > 0 ? 'oas-modal-btn' : 'oas-modal-btn primary'
                }
                onClick={() => setPathologyPopupOpen(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <DicomTagsModal
        open={tagsModalOpen}
        onClose={() => setTagsModalOpen(false)}
        file={tagsSourceFile}
        title="DICOM-теги среза"
      />
    </section>
  )
}
