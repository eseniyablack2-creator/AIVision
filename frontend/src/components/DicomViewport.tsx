import { useEffect, useMemo, useRef, useState } from 'react'
import dicomParser from 'dicom-parser'
import type { DicomSeries } from '../lib/dicom'
import { readPixels16, readPixels8 } from '../lib/pixelData'
import { VolumeViewport } from './VolumeViewport'

type ToolMode = 'windowLevel' | 'pan' | 'zoom' | 'length'
type PresetMode = 'soft' | 'bone' | 'lungs' | 'vessels'
type LayoutMode = 'single' | 'grid' | 'mpr'
type WorkspaceMode = 'diagnostic' | 'cta3d' | 'airway3d'
type ViewportKind = 'axial' | 'coronal' | 'sagittal' | 'axialAlt'

type Props = {
  activeSeries: DicomSeries | null
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

type ViewportState = {
  zoom: number
  panX: number
  panY: number
}

type PaneRect = {
  left: number
  top: number
  width: number
  height: number
}

type PaneMap = Record<ViewportKind, PaneRect>

const TOOL_ITEMS: Array<{ id: ToolMode; label: string; icon: string }> = [
  { id: 'windowLevel', label: 'WL', icon: '◐' },
  { id: 'pan', label: 'Pan', icon: '✥' },
  { id: 'zoom', label: 'Zoom', icon: '⌕' },
  { id: 'length', label: 'Длина', icon: '╱' },
]

const PRESET_ITEMS: Array<{ id: PresetMode; label: string; icon: string }> = [
  { id: 'soft', label: 'Мягкие ткани', icon: '◌' },
  { id: 'bone', label: 'Кость', icon: '▣' },
  { id: 'lungs', label: 'Легкие', icon: '◔' },
  { id: 'vessels', label: 'Сосуды', icon: '◎' },
]

const LAYOUT_ITEMS: Array<{ id: LayoutMode; label: string; icon: string }> = [
  { id: 'single', label: '1x1', icon: '▣' },
  { id: 'grid', label: '2x2', icon: '▦' },
  { id: 'mpr', label: 'MPR', icon: '◫' },
]

const WINDOW_BUTTONS: Array<{ id: ViewportKind; label: string }> = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
]

const WORKSPACE_ITEMS: Array<{ id: WorkspaceMode; label: string; icon: string }> = [
  { id: 'diagnostic', label: '2D', icon: '▤' },
  { id: 'cta3d', label: 'CTA 3D', icon: '◎' },
  { id: 'airway3d', label: 'Airways', icon: '◌' },
]

function getPresetWindow(preset: PresetMode) {
  if (preset === 'bone') return { center: 400, width: 1800 }
  if (preset === 'lungs') return { center: -600, width: 1600 }
  if (preset === 'vessels') return { center: 180, width: 700 }
  return { center: 40, width: 400 }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function parseDecimalString(value?: string) {
  if (!value) return 0
  const first = value.split('\\')[0]
  const parsed = Number.parseFloat(first)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseImagePositionZ(value?: string) {
  if (!value) return null
  const parts = value.split('\\')
  const parsed = Number.parseFloat(parts[2] ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

function getInitialViewportState(): ViewportState {
  return { zoom: 1, panX: 0, panY: 0 }
}

function getToolLabel(tool: ToolMode) {
  if (tool === 'windowLevel') return 'WL'
  if (tool === 'pan') return 'Pan'
  if (tool === 'zoom') return 'Zoom'
  return 'Длина'
}

function getCanvasCursor(tool: ToolMode) {
  if (tool === 'pan') return 'cursor-pan'
  if (tool === 'zoom') return 'cursor-zoom'
  if (tool === 'length') return 'cursor-length'
  return 'cursor-wl'
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
  const arrayBuffer = await file.arrayBuffer()
  const byteArray = new Uint8Array(arrayBuffer)
  const dataSet = dicomParser.parseDicom(byteArray)

  const rows = dataSet.uint16('x00280010') || 0
  const columns = dataSet.uint16('x00280011') || 0
  const bitsAllocated = dataSet.uint16('x00280100') || 16
  const pixelRepresentation = dataSet.uint16('x00280103') || 0
  const photometricInterpretation =
    dataSet.string('x00280004')?.trim() || 'MONOCHROME2'
  const pixelSpacing = dataSet.string('x00280030')?.split('\\') || []
  const pixelSpacingY = Number.parseFloat(pixelSpacing[0] || '1') || 1
  const pixelSpacingX = Number.parseFloat(pixelSpacing[1] || '1') || 1
  const sliceThickness = parseDecimalString(dataSet.string('x00180050')) || 1
  const spacingBetweenSlices =
    parseDecimalString(dataSet.string('x00180088')) || sliceThickness || 1
  const imagePositionZ = parseImagePositionZ(dataSet.string('x00200032'))
  const rescaleSlope = parseDecimalString(dataSet.string('x00281053')) || 1
  const rescaleIntercept = parseDecimalString(dataSet.string('x00281052'))
  const windowCenter = parseDecimalString(dataSet.string('x00281050')) || 40
  const windowWidth = parseDecimalString(dataSet.string('x00281051')) || 400

  const pixelDataElement = dataSet.elements.x7fe00010

  if (!pixelDataElement) {
    throw new Error('В DICOM нет Pixel Data.')
  }

  if (pixelDataElement.encapsulatedPixelData) {
    throw new Error(
      'Сжатый DICOM пока не поддержан в canvas-viewer. Для него нужен отдельный декодер.',
    )
  }

  const pixelCount = rows * columns
  const byteOffset = pixelDataElement.dataOffset
  let pixels: Int16Array | Uint16Array

  if (bitsAllocated === 16 && pixelRepresentation === 1) {
    pixels = readPixels16(arrayBuffer, byteOffset, pixelCount, 1)
  } else if (bitsAllocated === 16) {
    pixels = readPixels16(arrayBuffer, byteOffset, pixelCount, 0)
  } else {
    const source = readPixels8(arrayBuffer, byteOffset, pixelCount)
    pixels = Int16Array.from(source)
  }

  const huPixels = new Float32Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    huPixels[index] = pixels[index] * rescaleSlope + rescaleIntercept
  }

  return {
    rows,
    columns,
    pixelSpacingX,
    pixelSpacingY,
    sliceThickness,
    spacingBetweenSlices,
    imagePositionZ,
    windowCenter,
    windowWidth,
    huPixels,
    photometricInterpretation,
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
) {
  const imageData = new ImageData(width, height)
  const output = imageData.data
  const minValue = windowCenter - windowWidth / 2
  const maxValue = windowCenter + windowWidth / 2
  const range = Math.max(maxValue - minValue, 1)
  const invert = photometricInterpretation === 'MONOCHROME1'

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
      output[offset] = gray
      output[offset + 1] = gray
      output[offset + 2] = gray
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

function estimateTableCutRows(frames: LoadedFrame[]) {
  if (frames.length === 0) return 0

  const frame = frames[Math.floor(frames.length / 2)]
  const startRow = Math.floor(frame.rows * 0.6)
  let brightRun = 0

  for (let y = frame.rows - 1; y >= startRow; y -= 1) {
    let brightPixels = 0

    for (let x = 0; x < frame.columns; x += 1) {
      if (frame.huPixels[y * frame.columns + x] > 250) {
        brightPixels += 1
      }
    }

    const brightFraction = brightPixels / frame.columns
    if (brightFraction > 0.45) {
      brightRun += 1
      if (brightRun >= 4) {
        return Math.max(0, frame.rows - y + 2)
      }
    } else {
      brightRun = 0
    }
  }

  return 0
}

export function DicomViewport({ activeSeries }: Props) {
  const viewerAreaRef = useRef<HTMLDivElement | null>(null)
  const axialRef = useRef<HTMLCanvasElement | null>(null)
  const coronalRef = useRef<HTMLCanvasElement | null>(null)
  const sagittalRef = useRef<HTMLCanvasElement | null>(null)
  const axialAltRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const dragWindowRef = useRef({ center: 40, width: 400 })
  const dragViewportRef = useRef<ViewportState>(getInitialViewportState())
  const measurementStartRef = useRef<Point | null>(null)
  const resizeModeRef = useRef<null | 'mprVertical' | 'mprHorizontal' | 'gridX' | 'gridY'>(
    null,
  )

  const [activeTool, setActiveTool] = useState<ToolMode>('windowLevel')
  const [preset, setPreset] = useState<PresetMode>('soft')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('diagnostic')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('mpr')
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)
  const [clipPlaneX, setClipPlaneX] = useState(0)
  const [clipPlaneY, setClipPlaneY] = useState(0)
  const [clipPlaneZ, setClipPlaneZ] = useState(0)
  const [removeTable, setRemoveTable] = useState(true)
  const [suppressBone, setSuppressBone] = useState(true)
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
  const [measurement, setMeasurement] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [measurementPreview, setMeasurementPreview] = useState<Point | null>(null)
  const [viewerSize, setViewerSize] = useState({ width: 900, height: 640 })
  const [mprVerticalSplit, setMprVerticalSplit] = useState(0.72)
  const [mprHorizontalSplit, setMprHorizontalSplit] = useState(0.5)
  const [gridSplitX, setGridSplitX] = useState(0.58)
  const [gridSplitY, setGridSplitY] = useState(0.52)

  const paneRects = useMemo((): PaneMap => {
    const splitterWidth = 8
    const width = viewerSize.width
    const height = viewerSize.height

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
  ])

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

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!activeSeries || activeSeries.files.length === 0) {
        setFrames([])
        setViewerError('')
        return
      }

      try {
        setViewerError('')
        const loaded = await Promise.all(activeSeries.files.map((item) => loadFrame(item.file)))

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

        setFrames(sorted)
        setCrosshair({ x: centerX, y: centerY, z: centerZ })
        setClipStart(0)
        setClipEnd(sorted.length - 1)
        setClipPlaneX(0)
        setClipPlaneY(0)
        setClipPlaneZ(0)
        setMeasurement(null)
        setMeasurementPreview(null)
        setViewportStates({
          axial: getInitialViewportState(),
          coronal: getInitialViewportState(),
          sagittal: getInitialViewportState(),
          axialAlt: getInitialViewportState(),
        })

        const presetWindow = getPresetWindow(preset)
        setWindowCenter(first.windowCenter || presetWindow.center)
        setWindowWidth(first.windowWidth || presetWindow.width)
      } catch (error) {
        if (cancelled) return
        setFrames([])
        setViewerError(
          error instanceof Error ? error.message : 'Не удалось открыть серию в viewer.',
        )
      }
    }

    run()

    return () => {
      cancelled = true
    }
    // preset намеренно не в deps: смена пресета не должна перечитывать серию с диска.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeries])

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

  const tableCutRows = useMemo(() => {
    if (workspaceMode === 'diagnostic' || !removeTable) return 0
    return estimateTableCutRows(frames)
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
    return buildAxialPixels(frames[crosshair.z])
  }, [frames, crosshair.z])

  const coronalData = useMemo(() => {
    if (frames.length === 0) return null
    return buildCoronalPixels(frames, crosshair.y, zSpacing)
  }, [frames, crosshair.y, zSpacing])

  const sagittalData = useMemo(() => {
    if (frames.length === 0) return null
    return buildSagittalPixels(frames, crosshair.x, zSpacing)
  }, [frames, crosshair.x, zSpacing])

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

  const measurementText = useMemo(() => {
    if (!measurement || frames.length === 0) return 'Нет измерения'
    const frame = frames[crosshair.z]
    const dx = (measurement.end.x - measurement.start.x) * frame.pixelSpacingX
    const dy = (measurement.end.y - measurement.start.y) * frame.pixelSpacingY
    return `${Math.sqrt(dx * dx + dy * dy).toFixed(1)} мм`
  }, [measurement, frames, crosshair.z])

  function resetView() {
    const presetWindow = getPresetWindow(preset)
    setWindowCenter(presetWindow.center)
    setWindowWidth(presetWindow.width)
    setViewportStates({
      axial: getInitialViewportState(),
      coronal: getInitialViewportState(),
      sagittal: getInitialViewportState(),
      axialAlt: getInitialViewportState(),
    })
    setMeasurement(null)
    setMeasurementPreview(null)
  }

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

  function prepareCanvas(canvas: HTMLCanvasElement | null, rect: PaneRect) {
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
    context.imageSmoothingEnabled = false
    return context
  }

  function getDrawMetrics(viewport: ViewportKind, data: ViewportImage, rect: PaneRect) {
    const state = viewportStates[viewport]
    const fitScale = Math.min(rect.width / data.worldWidth, rect.height / data.worldHeight)
    const drawScale = fitScale * state.zoom
    const drawWidth = data.worldWidth * drawScale
    const drawHeight = data.worldHeight * drawScale
    const baseX = (rect.width - drawWidth) / 2 + state.panX
    const baseY = (rect.height - drawHeight) / 2 + state.panY

    return { drawScale, drawWidth, drawHeight, baseX, baseY }
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

    const context = prepareCanvas(canvas, rect)
    if (!context) return

    const frame = frames[0]
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
        frame.photometricInterpretation,
        windowCenter,
        windowWidth,
        workspaceMode,
      ),
      0,
      0,
    )

    context.clearRect(0, 0, rect.width, rect.height)
    context.fillStyle = '#050608'
    context.fillRect(0, 0, rect.width, rect.height)

    const metrics = getDrawMetrics(viewport, data, rect)
    context.drawImage(
      offscreen,
      metrics.baseX,
      metrics.baseY,
      metrics.drawWidth,
      metrics.drawHeight,
    )

    let verticalWorld = 0
    let horizontalWorld = 0

    if (viewport === 'axial' || viewport === 'axialAlt') {
      verticalWorld = crosshair.x * frame.pixelSpacingX
      horizontalWorld = crosshair.y * frame.pixelSpacingY
    } else if (viewport === 'coronal') {
      verticalWorld = crosshair.x * frame.pixelSpacingX
      horizontalWorld = crosshair.z * zSpacing
    } else {
      verticalWorld = crosshair.y * frame.pixelSpacingY
      horizontalWorld = crosshair.z * zSpacing
    }

    context.strokeStyle = '#d8ba4d'
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(metrics.baseX + verticalWorld * metrics.drawScale, metrics.baseY)
    context.lineTo(
      metrics.baseX + verticalWorld * metrics.drawScale,
      metrics.baseY + metrics.drawHeight,
    )
    context.stroke()

    context.beginPath()
    context.moveTo(metrics.baseX, metrics.baseY + horizontalWorld * metrics.drawScale)
    context.lineTo(
      metrics.baseX + metrics.drawWidth,
      metrics.baseY + horizontalWorld * metrics.drawScale,
    )
    context.stroke()

    context.fillStyle = '#d8ba4d'
    context.font = '600 13px Inter, sans-serif'
    const title = viewport === 'axialAlt' ? 'AXIAL 2' : viewport.toUpperCase()
    context.fillText(title, 12, 22)

    if ((viewport === 'axial' || viewport === 'axialAlt') && (measurement || measurementPreview)) {
      const start = measurement?.start || measurementStartRef.current
      const end = measurement?.end || measurementPreview

      if (start && end) {
        const startCanvas = {
          x: metrics.baseX + start.x * frame.pixelSpacingX * metrics.drawScale,
          y: metrics.baseY + start.y * frame.pixelSpacingY * metrics.drawScale,
        }
        const endCanvas = {
          x: metrics.baseX + end.x * frame.pixelSpacingX * metrics.drawScale,
          y: metrics.baseY + end.y * frame.pixelSpacingY * metrics.drawScale,
        }

        context.strokeStyle = '#1bc5ff'
        context.lineWidth = 2
        context.beginPath()
        context.moveTo(startCanvas.x, startCanvas.y)
        context.lineTo(endCanvas.x, endCanvas.y)
        context.stroke()
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
    viewportStates,
    windowCenter,
    windowWidth,
    crosshair,
    measurement,
    measurementPreview,
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
  ])

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
    const frame = frames[0]
    const metrics = getDrawMetrics(viewport, data, pane)

    if (viewport === 'axial' || viewport === 'axialAlt') {
      return {
        x: clamp((pointX - metrics.baseX) / metrics.drawScale / frame.pixelSpacingX, 0, data.width - 1),
        y: clamp((pointY - metrics.baseY) / metrics.drawScale / frame.pixelSpacingY, 0, data.height - 1),
      }
    }

    if (viewport === 'coronal') {
      return {
        x: clamp((pointX - metrics.baseX) / metrics.drawScale / frame.pixelSpacingX, 0, data.width - 1),
        y: clamp((pointY - metrics.baseY) / metrics.drawScale / zSpacing, 0, data.height - 1),
      }
    }

    return {
      x: clamp((pointX - metrics.baseX) / metrics.drawScale / frame.pixelSpacingY, 0, data.width - 1),
      y: clamp((pointY - metrics.baseY) / metrics.drawScale / zSpacing, 0, data.height - 1),
    }
  }

  function updateCrosshairFromPoint(viewport: ViewportKind, point: Point) {
    if (viewport === 'axial' || viewport === 'axialAlt') {
      setCrosshair((value) => ({
        ...value,
        x: Math.round(point.x),
        y: Math.round(point.y),
      }))
      return
    }

    if (viewport === 'coronal') {
      setCrosshair((value) => ({
        ...value,
        x: Math.round(point.x),
        z: Math.round(point.y),
      }))
      return
    }

    setCrosshair((value) => ({
      ...value,
      y: Math.round(point.x),
      z: Math.round(point.y),
    }))
  }

  function handlePointerDown(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    setActiveViewport(viewport)
    setSingleViewport(viewport === 'axialAlt' ? 'axial' : viewport)
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    dragWindowRef.current = { center: windowCenter, width: windowWidth }
    dragViewportRef.current = { ...viewportStates[viewport] }

    const point = getMousePoint(event, viewport, data)
    if (workspaceMode === 'diagnostic') {
      updateCrosshairFromPoint(viewport, point)
    }

    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt')) {
      measurementStartRef.current = point
      setMeasurement(null)
      setMeasurementPreview(point)
    }
  }

  function handlePointerMove(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    const dragStart = dragStartRef.current
    if (!dragStart) return

    const deltaX = event.clientX - dragStart.x
    const deltaY = event.clientY - dragStart.y

    if (activeTool === 'windowLevel') {
      setWindowWidth(clamp(dragWindowRef.current.width + deltaX * 3, 1, 4000))
      setWindowCenter(clamp(dragWindowRef.current.center + deltaY * 3, -2000, 3000))
      return
    }

    if (activeTool === 'pan') {
      setViewportStates((value) => ({
        ...value,
        [viewport]: {
          ...value[viewport],
          panX: dragViewportRef.current.panX + deltaX,
          panY: dragViewportRef.current.panY + deltaY,
        },
      }))
      return
    }

    if (activeTool === 'zoom') {
      setViewportStates((value) => ({
        ...value,
        [viewport]: {
          ...value[viewport],
          zoom: clamp(dragViewportRef.current.zoom + deltaY * -0.01, 0.2, 8),
        },
      }))
      return
    }

    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt')) {
      setMeasurementPreview(getMousePoint(event, viewport, data))
    }
  }

  function handlePointerUp(
    event: React.MouseEvent<HTMLCanvasElement>,
    viewport: ViewportKind,
    data: ViewportImage,
  ) {
    if (activeTool === 'length' && (viewport === 'axial' || viewport === 'axialAlt') && measurementStartRef.current) {
      setMeasurement({ start: measurementStartRef.current, end: getMousePoint(event, viewport, data) })
    }

    dragStartRef.current = null
    measurementStartRef.current = null
    setMeasurementPreview(null)
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>, viewport: ViewportKind) {
    event.preventDefault()

    if (activeTool === 'zoom') {
      setViewportStates((value) => ({
        ...value,
        [viewport]: {
          ...value[viewport],
          zoom: clamp(value[viewport].zoom + (event.deltaY < 0 ? 0.12 : -0.12), 0.2, 8),
        },
      }))
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

    setCrosshair((value) => {
      if (viewport === 'axial' || viewport === 'axialAlt') {
        return { ...value, z: clamp(value.z + (event.deltaY > 0 ? 1 : -1), 0, frames.length - 1) }
      }

      if (viewport === 'coronal') {
        return { ...value, y: clamp(value.y + (event.deltaY > 0 ? 1 : -1), 0, frames[0].rows - 1) }
      }

      return { ...value, x: clamp(value.x + (event.deltaY > 0 ? 1 : -1), 0, frames[0].columns - 1) }
    })
  }

  function startResize(mode: 'mprVertical' | 'mprHorizontal' | 'gridX' | 'gridY') {
    resizeModeRef.current = mode
  }

  function renderCanvas(viewport: ViewportKind, title: string) {
    const data = viewportImages[viewport]
    const rect = paneRects[viewport]
    const isHidden = rect.width <= 0 || rect.height <= 0

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
        <canvas
          ref={(node) => {
            if (viewport === 'axial') axialRef.current = node
            if (viewport === 'coronal') coronalRef.current = node
            if (viewport === 'sagittal') sagittalRef.current = node
            if (viewport === 'axialAlt') axialAltRef.current = node
          }}
          className={`viewer-surface ${getCanvasCursor(activeTool)}`}
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
          onMouseLeave={(event) =>
            handlePointerUp(
              event,
              viewport,
              data || { width: 1, height: 1, worldWidth: 1, worldHeight: 1, pixels: new Float32Array(1) },
            )
          }
          onWheel={(event) => handleWheel(event, viewport)}
        />
        <div className="viewport-overlay-label">{title}</div>
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

  return (
    <section className={isVolumeMode ? 'viewer-card workstation-card volume-mode' : 'viewer-card workstation-card'}>
      <div className="viewer-topbar">
        <div>
          <p className="section-label">Активная серия</p>
          <h3>{activeSeries.seriesDescription}</h3>
        </div>
        <div className="viewer-meta-chip">
          <span>{activeSeries.modality}</span>
          <span>{activeSeries.files.length} срезов</span>
        </div>
      </div>

      <div className="workstation-shell">
        <div className="workstation-main">
          <div className={isVolumeMode ? 'viewer-statusbar compact' : 'viewer-statusbar'}>
            <span>Режим: {workspaceMode === 'diagnostic' ? '2D' : workspaceMode === 'cta3d' ? 'CTA 3D' : 'Airways 3D'}</span>
            {isVolumeMode ? (
              <>
                <span>Срезы: {clipBounds.start + 1}-{clipBounds.end + 1}</span>
                <span>Инструмент: {getToolLabel(activeTool)}</span>
              </>
            ) : (
              <>
                <span>Инструмент: {getToolLabel(activeTool)}</span>
                <span>Окно: {singleViewport === 'axialAlt' ? 'axial' : singleViewport}</span>
                <span>WL: {Math.round(windowWidth)}/{Math.round(windowCenter)}</span>
                <span>Z: {crosshair.z + 1}</span>
                <span>Измерение: {measurementText}</span>
                <span>Spacing Z: {zSpacing.toFixed(2)} мм</span>
              </>
            )}
          </div>

          {viewerError ? <p className="viewer-error">{viewerError}</p> : null}

          <div className="viewer-toolbar-inline">
            <div className="segmented-control">
              {WORKSPACE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={workspaceMode === item.id ? 'segment-button active' : 'segment-button'}
                  onClick={() => {
                    setWorkspaceMode(item.id)
                    if (item.id !== 'diagnostic') {
                      setLayoutMode('mpr')
                      setPreset(item.id === 'cta3d' ? 'vessels' : 'lungs')
                    }
                  }}
                  type="button"
                >
                  <span className="tool-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {!isVolumeMode ? (
              <>
                <div className="segmented-control">
                  {LAYOUT_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      className={layoutMode === item.id ? 'segment-button active' : 'segment-button'}
                      onClick={() => setLayoutMode(item.id)}
                      type="button"
                    >
                      <span className="tool-icon">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>

                <div className="segmented-control">
                  {WINDOW_BUTTONS.map((item) => (
                    <button
                      key={item.id}
                      className={singleViewport === item.id ? 'segment-button active' : 'segment-button'}
                      onClick={() => {
                        setSingleViewport(item.id)
                        setActiveViewport(item.id)
                        setLayoutMode('single')
                      }}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="viewer-stage-shell">
            {workspaceMode === 'diagnostic' ? (
              <div className="viewer-stage" ref={viewerAreaRef}>
                {layoutMode === 'single'
                  ? renderCanvas(singleViewport, singleViewport.toUpperCase())
                  : (
                    <>
                      {renderCanvas('axial', 'AXIAL')}
                      {renderCanvas('coronal', 'CORONAL')}
                      {renderCanvas('sagittal', 'SAGITTAL')}
                      {layoutMode === 'grid' ? renderCanvas('axialAlt', 'AXIAL 2') : null}
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
              <VolumeViewport
                activeSeries={activeSeries}
                mode={workspaceMode}
                clipStart={clipBounds.start}
                clipEnd={clipBounds.end}
                removeTable={removeTable}
                suppressBone={suppressBone}
                clipX={clipPlaneX}
                clipY={clipPlaneY}
                clipZ={clipPlaneZ}
              />
            )}
          </div>
        </div>

        <aside className="vertical-toolbar">
          <div className="toolbar-section">
            <span className="toolbar-title">Инструменты</span>
            {TOOL_ITEMS.map((item) => (
              <button
                key={item.id}
                className={activeTool === item.id ? 'vertical-tool active' : 'vertical-tool'}
                onClick={() => setActiveTool(item.id)}
                type="button"
              >
                <span className="vertical-tool-icon">{item.icon}</span>
                <span className="vertical-tool-label">{item.label}</span>
              </button>
            ))}
          </div>

          {isVolumeMode ? (
            <>
              <div className="toolbar-section">
                <span className="toolbar-title">3D</span>
                <label className="vertical-slider-control">
                  <span>Начало</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, frames.length - 1)}
                    value={clipBounds.start}
                    onChange={(event) =>
                      setClipStart(Math.min(Number(event.target.value), clipBounds.end))
                    }
                  />
                  <strong>{clipBounds.start + 1}</strong>
                </label>
                <label className="vertical-slider-control">
                  <span>Конец</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, frames.length - 1)}
                    value={clipBounds.end}
                    onChange={(event) =>
                      setClipEnd(Math.max(Number(event.target.value), clipBounds.start))
                    }
                  />
                  <strong>{clipBounds.end + 1}</strong>
                </label>
                <button
                  className={removeTable ? 'vertical-tool active' : 'vertical-tool'}
                  onClick={() => setRemoveTable((value) => !value)}
                  type="button"
                >
                  <span className="vertical-tool-label">Auto table</span>
                </button>
                {workspaceMode === 'cta3d' ? (
                  <button
                    className={suppressBone ? 'vertical-tool active' : 'vertical-tool'}
                    onClick={() => setSuppressBone((value) => !value)}
                    type="button"
                  >
                    <span className="vertical-tool-label">Hide bones</span>
                  </button>
                ) : null}
              </div>

              <div className="toolbar-section">
                <span className="toolbar-title">Clipping</span>
                <label className="vertical-slider-control compact">
                  <span>X</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(clipPlaneX * 100)}
                    onChange={(event) => setClipPlaneX(Number(event.target.value) / 100)}
                  />
                </label>
                <label className="vertical-slider-control compact">
                  <span>Y</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(clipPlaneY * 100)}
                    onChange={(event) => setClipPlaneY(Number(event.target.value) / 100)}
                  />
                </label>
                <label className="vertical-slider-control compact">
                  <span>Z</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(clipPlaneZ * 100)}
                    onChange={(event) => setClipPlaneZ(Number(event.target.value) / 100)}
                  />
                </label>
              </div>
            </>
          ) : null}

          <div className="toolbar-section">
            <span className="toolbar-title">Пресеты</span>
            {PRESET_ITEMS.map((item) => (
              <button
                key={item.id}
                className={preset === item.id ? 'vertical-tool active' : 'vertical-tool'}
                onClick={() => {
                  setPreset(item.id)
                  const w = getPresetWindow(item.id)
                  setWindowCenter(w.center)
                  setWindowWidth(w.width)
                }}
                type="button"
              >
                <span className="vertical-tool-icon">{item.icon}</span>
                <span className="vertical-tool-label">{item.label}</span>
              </button>
            ))}
          </div>

          {!isVolumeMode ? (
            <div className="toolbar-section">
              <span className="toolbar-title">Окна</span>
              {WINDOW_BUTTONS.map((item) => (
                <button
                  key={item.id}
                  className={activeViewport === item.id ? 'vertical-tool is-subtle active' : 'vertical-tool is-subtle'}
                  onClick={() => {
                    setActiveViewport(item.id)
                    setSingleViewport(item.id)
                  }}
                  type="button"
                >
                  <span className="vertical-tool-label">{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="toolbar-section">
            <button className="vertical-tool reset" onClick={resetView} type="button">
              <span className="vertical-tool-icon">↺</span>
              <span className="vertical-tool-label">Сброс</span>
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
