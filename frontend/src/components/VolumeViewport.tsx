import { useEffect, useMemo, useRef, useState } from 'react'
import dicomParser from 'dicom-parser'
import type { DicomSeries } from '../lib/dicom'
import { readPixels16, readPixels8 } from '../lib/pixelData'

type Mode = 'cta3d' | 'airway3d'

type VolumeViewportProps = {
  activeSeries: DicomSeries
  mode: Mode
  clipStart: number
  clipEnd: number
  removeTable: boolean
  suppressBone: boolean
  clipX: number
  clipY: number
  clipZ: number
}

type LoadedFrame = {
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  spacingZ: number
  huPixels: Float32Array
}

type Projection = {
  width: number
  height: number
  worldWidth: number
  worldHeight: number
  pixels: Float32Array
}

type ViewState = {
  zoom: number
  panX: number
  panY: number
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

async function loadFrame(file: File): Promise<LoadedFrame> {
  const arrayBuffer = await file.arrayBuffer()
  const byteArray = new Uint8Array(arrayBuffer)
  const dataSet = dicomParser.parseDicom(byteArray)

  const rows = dataSet.uint16('x00280010') || 0
  const columns = dataSet.uint16('x00280011') || 0
  const bitsAllocated = dataSet.uint16('x00280100') || 16
  const pixelRepresentation = dataSet.uint16('x00280103') || 0
  const pixelSpacing = dataSet.string('x00280030')?.split('\\') || []
  const pixelSpacingY = Number.parseFloat(pixelSpacing[0] || '1') || 1
  const pixelSpacingX = Number.parseFloat(pixelSpacing[1] || '1') || 1
  const sliceThickness = parseDecimalString(dataSet.string('x00180050')) || 1
  const spacingZ = parseDecimalString(dataSet.string('x00180088')) || sliceThickness || 1
  const rescaleSlope = parseDecimalString(dataSet.string('x00281053')) || 1
  const rescaleIntercept = parseDecimalString(dataSet.string('x00281052'))
  const pixelDataElement = dataSet.elements.x7fe00010

  if (!pixelDataElement || pixelDataElement.encapsulatedPixelData) {
    throw new Error('Для 3D preview нужна несжатая серия DICOM с Pixel Data.')
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
    spacingZ,
    huPixels,
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
      if (frame.huPixels[y * frame.columns + x] > 250) brightPixels += 1
    }
    if (brightPixels / frame.columns > 0.45) {
      brightRun += 1
      if (brightRun >= 4) return Math.max(0, frame.rows - y + 2)
    } else {
      brightRun = 0
    }
  }

  return 0
}

function passesThreshold(value: number, mode: Mode, suppressBone: boolean) {
  if (mode === 'airway3d') return value >= -1100 && value <= -350
  if (suppressBone) return value >= 140 && value <= 520
  return value >= 140 && value <= 3000
}

function buildProjection(
  frames: LoadedFrame[],
  mode: Mode,
  removeTable: boolean,
  suppressBone: boolean,
  clipX: number,
  clipY: number,
  clipZ: number,
): Projection {
  const rows = frames[0].rows
  const columns = frames[0].columns
  const depth = frames.length
  const tableCutRows = removeTable ? estimateTableCutRows(frames) : 0
  const visibleRows = Math.max(1, rows - tableCutRows)
  const cropLeft = Math.floor(columns * clipX * 0.6)
  const cropTop = Math.floor(visibleRows * clipY * 0.6)
  const cropDepth = Math.floor(depth * clipZ * 0.6)
  const startX = clamp(cropLeft, 0, columns - 1)
  const startY = clamp(cropTop, 0, visibleRows - 1)
  const startZ = clamp(cropDepth, 0, depth - 1)

  const outWidth = columns - startX
  const outHeight = depth - startZ
  const output = new Float32Array(outWidth * outHeight)
  const fallback = mode === 'cta3d' ? -1024 : 1024
  output.fill(fallback)

  for (let z = startZ; z < depth; z += 1) {
    const sourceFrame = frames[z]
    const targetRow = depth - 1 - z
    for (let x = startX; x < columns; x += 1) {
      for (let y = startY; y < visibleRows; y += 1) {
        const value = sourceFrame.huPixels[y * columns + x]
        if (!passesThreshold(value, mode, suppressBone)) continue

        const outIndex = (targetRow - startZ) * outWidth + (x - startX)
        if (mode === 'cta3d') {
          if (value > output[outIndex]) output[outIndex] = value
        } else if (value < output[outIndex]) {
          output[outIndex] = value
        }
      }
    }
  }

  return {
    width: outWidth,
    height: outHeight,
    worldWidth: outWidth * frames[0].pixelSpacingX,
    worldHeight: outHeight * frames[0].spacingZ,
    pixels: output,
  }
}

function buildImageData(width: number, height: number, pixels: Float32Array, mode: Mode) {
  const imageData = new ImageData(width, height)
  const output = imageData.data
  const minValue = mode === 'cta3d' ? 120 : -1000
  const maxValue = mode === 'cta3d' ? 550 : -350
  const range = Math.max(maxValue - minValue, 1)

  for (let index = 0; index < pixels.length; index += 1) {
    const normalized = clamp((pixels[index] - minValue) / range, 0, 1)
    const gray = Math.round(normalized * 255)
    const offset = index * 4

    if (mode === 'cta3d') {
      output[offset] = Math.min(255, Math.round(gray * 1.06))
      output[offset + 1] = Math.min(255, Math.round(gray * 0.9))
      output[offset + 2] = Math.min(255, Math.round(gray * 0.7))
    } else {
      output[offset] = Math.round(gray * 0.74)
      output[offset + 1] = Math.round(gray * 0.84)
      output[offset + 2] = Math.min(255, Math.round(gray * 1.06))
    }
    output[offset + 3] = 255
  }

  return imageData
}

export function VolumeViewport({
  activeSeries,
  mode,
  clipStart,
  clipEnd,
  removeTable,
  suppressBone,
  clipX,
  clipY,
  clipZ,
}: VolumeViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragViewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 })

  const [frames, setFrames] = useState<LoadedFrame[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 })
  const [viewState, setViewState] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })

  const seriesFiles = useMemo(
    () => activeSeries.files.map((item) => item.file),
    [activeSeries],
  )

  useEffect(() => {
    if (!hostRef.current) return
    const element = hostRef.current
    const updateSize = () => {
      setViewportSize({
        width: Math.max(320, Math.floor(element.clientWidth)),
        height: Math.max(320, Math.floor(element.clientHeight)),
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
      setIsLoading(true)
      setError('')
      try {
        const loaded = await Promise.all(seriesFiles.map((file) => loadFrame(file)))
        if (cancelled) return
        const start = Math.max(0, Math.min(clipStart, clipEnd))
        const end = Math.min(loaded.length - 1, Math.max(clipStart, clipEnd))
        const clipped = loaded.slice(start, end + 1)
        if (clipped.length === 0) {
          throw new Error('Нет данных для выбранного диапазона срезов.')
        }
        setFrames(clipped)
      } catch (caughtError) {
        if (cancelled) return
        setFrames([])
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Не удалось построить 3D preview.',
        )
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [seriesFiles, clipStart, clipEnd])

  const projection = useMemo(() => {
    if (frames.length === 0) return null
    return buildProjection(frames, mode, removeTable, suppressBone, clipX, clipY, clipZ)
  }, [frames, mode, removeTable, suppressBone, clipX, clipY, clipZ])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host || !projection) return

    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.floor(viewportSize.width * dpr))
    const backingHeight = Math.max(1, Math.floor(viewportSize.height * dpr))

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth
      canvas.height = backingHeight
      canvas.style.width = `${viewportSize.width}px`
      canvas.style.height = `${viewportSize.height}px`
    }

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, viewportSize.width, viewportSize.height)
    context.fillStyle = '#020305'
    context.fillRect(0, 0, viewportSize.width, viewportSize.height)

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }
    const offscreen = offscreenRef.current
    offscreen.width = projection.width
    offscreen.height = projection.height
    const offscreenContext = offscreen.getContext('2d')
    if (!offscreenContext) return
    offscreenContext.putImageData(
      buildImageData(projection.width, projection.height, projection.pixels, mode),
      0,
      0,
    )

    const fitScale = Math.min(
      viewportSize.width / projection.worldWidth,
      viewportSize.height / projection.worldHeight,
    )
    const drawScale = fitScale * viewState.zoom
    const drawWidth = projection.worldWidth * drawScale
    const drawHeight = projection.worldHeight * drawScale
    const baseX = (viewportSize.width - drawWidth) / 2 + viewState.panX
    const baseY = (viewportSize.height - drawHeight) / 2 + viewState.panY

    context.drawImage(offscreen, baseX, baseY, drawWidth, drawHeight)

    context.strokeStyle = 'rgba(242, 212, 92, 0.6)'
    context.lineWidth = 1
    context.strokeRect(baseX, baseY, drawWidth, drawHeight)
  }, [projection, viewportSize, viewState, mode])

  function handlePointerDown(event: React.MouseEvent<HTMLCanvasElement>) {
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    dragViewRef.current = viewState
  }

  function handlePointerMove(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragStartRef.current) return
    const deltaX = event.clientX - dragStartRef.current.x
    const deltaY = event.clientY - dragStartRef.current.y
    setViewState({
      ...dragViewRef.current,
      panX: dragViewRef.current.panX + deltaX,
      panY: dragViewRef.current.panY + deltaY,
    })
  }

  function handlePointerUp() {
    dragStartRef.current = null
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault()
    setViewState((current) => ({
      ...current,
      zoom: clamp(current.zoom + (event.deltaY < 0 ? 0.12 : -0.12), 0.3, 6),
    }))
  }

  return (
    <div className="volume-viewport-shell" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="volume-viewport"
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onWheel={handleWheel}
      />
      {isLoading ? <div className="volume-overlay">Строю 3D preview...</div> : null}
      {error ? <div className="volume-overlay error">{error}</div> : null}
      {!error ? (
        <div className="volume-hint">
          ЛКМ: сдвиг, колесо: масштаб, режим: {mode === 'cta3d' ? 'CTA preview' : 'Airway preview'}
        </div>
      ) : null}
    </div>
  )
}
