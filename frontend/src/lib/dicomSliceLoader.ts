import * as cornerstone3D from '@cornerstonejs/core'
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader'
import dicomParser from 'dicom-parser'
import { readPixels16, readPixels8 } from './pixelData'

export type DecodedSlice = {
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  sliceThickness: number
  spacingBetweenSlices: number
  imagePositionZ: number | null
  /** Полный IPP (мм, LPS), если есть в DICOM. */
  imagePositionPatient: [number, number, number] | null
  /** IOP: направление строки, затем столбца (DICOM). */
  imageOrientationPatient: [number, number, number, number, number, number] | null
  windowCenter: number
  windowWidth: number
  huPixels: Float32Array
  photometricInterpretation: string
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

/** Полный Image Position Patient (LPS), мм. */
function parseImagePositionPatient(value?: string): [number, number, number] | null {
  if (!value) return null
  const parts = value.split('\\').map((p) => Number.parseFloat(p.trim()))
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0]!, parts[1]!, parts[2]!]
}

/** Image Orientation Patient: косинусы строки (1–3) и столбца (4–6). */
function parseImageOrientationPatient(value?: string): [number, number, number, number, number, number] | null {
  if (!value) return null
  const parts = value.split('\\').map((p) => Number.parseFloat(p.trim()))
  if (parts.length < 6 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!, parts[5]!]
}

function firstNumber(v: number | number[] | undefined, fallback: number) {
  if (v === undefined) return fallback
  return Array.isArray(v) ? (v[0] ?? fallback) : v
}

let decoderInit: Promise<void> | null = null

export async function ensureCornerstoneDicomDecoder(): Promise<void> {
  if (decoderInit) return decoderInit
  decoderInit = (async () => {
    await cornerstone3D.init()
    const workers = Math.min(
      6,
      Math.max(1, Math.floor((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4) / 2)),
    )
    cornerstoneDICOMImageLoader.init({
      maxWebWorkers: workers,
    })
  })()
  return decoderInit
}

function decodeRawFromBuffer(arrayBuffer: ArrayBuffer, dataSet: dicomParser.DataSet): DecodedSlice {
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
  const imagePositionPatient = parseImagePositionPatient(dataSet.string('x00200032'))
  const imageOrientationPatient = parseImageOrientationPatient(dataSet.string('x00200037'))
  const rescaleSlope = parseDecimalString(dataSet.string('x00281053')) || 1
  const rescaleIntercept = parseDecimalString(dataSet.string('x00281052'))
  const windowCenter = parseDecimalString(dataSet.string('x00281050')) || 40
  const windowWidth = parseDecimalString(dataSet.string('x00281051')) || 400

  const pixelDataElement = dataSet.elements.x7fe00010
  if (!pixelDataElement) {
    throw new Error('В DICOM нет Pixel Data.')
  }
  if (pixelDataElement.encapsulatedPixelData) {
    throw new Error('encapsulated')
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
  for (let i = 0; i < pixelCount; i += 1) {
    huPixels[i] = pixels[i] * rescaleSlope + rescaleIntercept
  }

  return {
    rows,
    columns,
    pixelSpacingX,
    pixelSpacingY,
    sliceThickness,
    spacingBetweenSlices,
    imagePositionZ,
    imagePositionPatient,
    imageOrientationPatient,
    windowCenter,
    windowWidth,
    huPixels,
    photometricInterpretation,
  }
}

async function decodeViaCornerstone(file: File): Promise<DecodedSlice> {
  await ensureCornerstoneDicomDecoder()
  const arrayBuffer = await file.arrayBuffer()
  let meta: dicomParser.DataSet | null = null
  try {
    meta = dicomParser.parseDicom(new Uint8Array(arrayBuffer))
  } catch {
    meta = null
  }
  const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file)
  try {
    const image = await cornerstone3D.imageLoader.loadImage(imageId, {
      priority: 5,
      requestType: 'interaction',
      ignoreCache: true,
    })
    if (image.color) {
      throw new Error('Цветной DICOM пока не поддержан в этом режиме.')
    }
    const pixelData = image.getPixelData()
    const rows = image.rows
    const columns = image.columns
    const count = rows * columns
    const slope = image.slope || 1
    const intercept = image.intercept ?? 0
    const huPixels = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      huPixels[i] = Number(pixelData[i]) * slope + intercept
    }

    const sliceThickness = meta
      ? parseDecimalString(meta.string('x00180050')) || image.sliceThickness || 1
      : image.sliceThickness || 1
    const spacingBetweenSlices = meta
      ? parseDecimalString(meta.string('x00180088')) || sliceThickness
      : sliceThickness
    const imagePositionZ = meta ? parseImagePositionZ(meta.string('x00200032')) : null
    const imagePositionPatient = meta ? parseImagePositionPatient(meta.string('x00200032')) : null
    const imageOrientationPatient = meta ? parseImageOrientationPatient(meta.string('x00200037')) : null
    const photometricInterpretation =
      meta?.string('x00280004')?.trim() || image.photometricInterpretation || 'MONOCHROME2'

    return {
      rows,
      columns,
      pixelSpacingX: image.columnPixelSpacing || 1,
      pixelSpacingY: image.rowPixelSpacing || 1,
      sliceThickness,
      spacingBetweenSlices,
      imagePositionZ,
      imagePositionPatient,
      imageOrientationPatient,
      windowCenter: firstNumber(image.windowCenter, 40),
      windowWidth: firstNumber(image.windowWidth, 400),
      huPixels,
      photometricInterpretation,
    }
  } finally {
    /* imageId привязан к fileManager; очистка при смене серии — purge в clearCornerstoneFileManager */
  }
}

/** Вызовите при смене исследования, чтобы не копить blob-ссылки в fileManager. */
export function clearCornerstoneFileManager() {
  try {
    const fm = cornerstoneDICOMImageLoader.wadouri?.fileManager
    if (fm && typeof fm.purge === 'function') {
      fm.purge()
    }
  } catch {
    /* до init() декодера или в нестандартной среде — не валим React */
  }
}

/**
 * Декодирование одного DICOM-кадра: быстрый путь без сжатия, иначе Cornerstone + WASM/веб-воркеры.
 */
export async function decodeDicomSlice(file: File): Promise<DecodedSlice> {
  const arrayBuffer = await file.arrayBuffer()
  const byteArray = new Uint8Array(arrayBuffer)
  let dataSet: dicomParser.DataSet
  try {
    dataSet = dicomParser.parseDicom(byteArray)
  } catch {
    return decodeViaCornerstone(file)
  }

  const pixelDataElement = dataSet.elements.x7fe00010
  if (!pixelDataElement) {
    return decodeViaCornerstone(file)
  }

  if (pixelDataElement.encapsulatedPixelData) {
    return decodeViaCornerstone(file)
  }

  try {
    return decodeRawFromBuffer(arrayBuffer, dataSet)
  } catch {
    return decodeViaCornerstone(file)
  }
}
