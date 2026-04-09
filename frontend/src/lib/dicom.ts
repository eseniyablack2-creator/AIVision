import dicomParser from 'dicom-parser'

export type ParsedDicomFile = {
  file: File
  fileName: string
  size: number
  studyInstanceUid: string
  seriesInstanceUid: string
  seriesDescription: string
  modality: string
  studyDate: string
  instanceNumber: number
  imagePositionZ: number | null
  patientName: string
  /** (0010,0020) */
  patientId: string
  rows: number
  columns: number
  pixelSpacingX: number
  pixelSpacingY: number
  sliceThicknessMm: number | null
  spacingBetweenSlicesMm: number | null
}

export type DicomSeries = {
  seriesInstanceUid: string
  studyInstanceUid: string
  seriesDescription: string
  modality: string
  studyDate: string
  patientName: string
  patientId: string
  files: ParsedDicomFile[]
}

function readString(
  dataSet: dicomParser.DataSet,
  tag: string,
  fallback: string,
) {
  return dataSet.string(tag)?.trim() || fallback
}

function readNumber(dataSet: dicomParser.DataSet, tag: string) {
  const raw = dataSet.string(tag)
  if (!raw) return 0

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function readImagePositionZ(dataSet: dicomParser.DataSet) {
  const raw = dataSet.string('x00200032')
  if (!raw) return null

  const parsed = Number.parseFloat(raw.split('\\')[2] ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

function parseDecimalTag(dataSet: dicomParser.DataSet, tag: string): number | null {
  const raw = dataSet.string(tag)
  if (!raw) return null
  const first = raw.split('\\')[0]?.trim() ?? ''
  const parsed = Number.parseFloat(first)
  return Number.isFinite(parsed) ? parsed : null
}

function readPixelSpacingMm(dataSet: dicomParser.DataSet): { x: number; y: number } {
  const raw = dataSet.string('x00280030')?.split('\\') ?? []
  const row = Number.parseFloat(raw[0] || '0')
  const col = Number.parseFloat(raw[1] || '0')
  const y = Number.isFinite(row) && row > 0 ? row : 1
  const x = Number.isFinite(col) && col > 0 ? col : 1
  return { x, y }
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  return `${(size / (1024 * 1024)).toFixed(2)} МБ`
}

export function formatDate(value: string) {
  if (!value || value.length !== 8) return 'Не указана'
  return `${value.slice(6, 8)}.${value.slice(4, 6)}.${value.slice(0, 4)}`
}

export async function isDicomFile(file: File) {
  const normalized = file.name.toLowerCase()

  if (normalized.endsWith('.dcm') || normalized.endsWith('.dicom')) {
    return true
  }

  try {
    const header = await file.slice(0, 512).arrayBuffer()
    const bytes = new Uint8Array(header)

    if (bytes.length >= 132) {
      const signature = String.fromCharCode(
        bytes[128],
        bytes[129],
        bytes[130],
        bytes[131],
      )

      if (signature === 'DICM') {
        return true
      }
    }

    const full = await file.arrayBuffer()
    dicomParser.parseDicom(new Uint8Array(full))
    return true
  } catch {
    return false
  }
}

export async function splitDicomFiles(files: File[]) {
  const accepted: File[] = []
  const rejected: File[] = []

  for (const file of files) {
    if (await isDicomFile(file)) {
      accepted.push(file)
    } else {
      rejected.push(file)
    }
  }

  return { accepted, rejected }
}

export async function parseDicomFile(
  file: File,
): Promise<ParsedDicomFile | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const byteArray = new Uint8Array(arrayBuffer)
    const dataSet = dicomParser.parseDicom(byteArray)

    const rows = dataSet.uint16('x00280010') ?? 0
    const columns = dataSet.uint16('x00280011') ?? 0
    const ps = readPixelSpacingMm(dataSet)
    const sliceTh = parseDecimalTag(dataSet, 'x00180050')
    const spBetween = parseDecimalTag(dataSet, 'x00180088')

    return {
      file,
      fileName: file.name || 'Без имени',
      size: file.size,
      studyInstanceUid: readString(dataSet, 'x0020000d', 'unknown-study'),
      seriesInstanceUid: readString(dataSet, 'x0020000e', 'unknown-series'),
      seriesDescription: readString(dataSet, 'x0008103e', 'Серия без названия'),
      modality: readString(dataSet, 'x00080060', 'Не указана'),
      studyDate: readString(dataSet, 'x00080020', ''),
      instanceNumber: readNumber(dataSet, 'x00200013'),
      imagePositionZ: readImagePositionZ(dataSet),
      patientName: readString(dataSet, 'x00100010', 'Не указан'),
      patientId: readString(dataSet, 'x00100020', ''),
      rows,
      columns,
      pixelSpacingX: ps.x,
      pixelSpacingY: ps.y,
      sliceThicknessMm: sliceTh,
      spacingBetweenSlicesMm: spBetween,
    }
  } catch {
    return null
  }
}

export async function buildSeries(files: File[]) {
  const parsedFiles = await Promise.all(files.map((file) => parseDicomFile(file)))
  const validFiles = parsedFiles.filter((file): file is ParsedDicomFile => file !== null)
  const seriesMap = new Map<string, DicomSeries>()

  for (const item of validFiles) {
    const existing = seriesMap.get(item.seriesInstanceUid)

    if (existing) {
      existing.files.push(item)
      continue
    }

    seriesMap.set(item.seriesInstanceUid, {
      seriesInstanceUid: item.seriesInstanceUid,
      studyInstanceUid: item.studyInstanceUid,
      seriesDescription: item.seriesDescription,
      modality: item.modality,
      studyDate: item.studyDate,
      patientName: item.patientName,
      patientId: item.patientId,
      files: [item],
    })
  }

  return Array.from(seriesMap.values())
    .map((series) => ({
      ...series,
      files: [...series.files].sort((a, b) => {
        if (a.instanceNumber > 0 && b.instanceNumber > 0) {
          return a.instanceNumber - b.instanceNumber
        }

        if (a.imagePositionZ !== null && b.imagePositionZ !== null) {
          return a.imagePositionZ - b.imagePositionZ
        }

        return a.fileName.localeCompare(b.fileName)
      }),
    }))
    .sort((a, b) => b.files.length - a.files.length)
}

/**
 * Более надёжный разбор папки: не делаем двойное чтение файла (isDicomFile -> parseDicomFile),
 * а сразу пытаемся распарсить метаданные. Это заметно увеличивает долю «подхваченных» срезов
 * на больших исследованиях и ускоряет импорт.
 */
export async function buildSeriesWithRejects(files: File[]) {
  const parsed = await Promise.all(files.map((file) => parseDicomFile(file)))
  const accepted: ParsedDicomFile[] = []
  const rejected: File[] = []
  for (let i = 0; i < files.length; i += 1) {
    const p = parsed[i]
    if (p) accepted.push(p)
    else rejected.push(files[i]!)
  }

  const seriesMap = new Map<string, DicomSeries>()
  for (const item of accepted) {
    const existing = seriesMap.get(item.seriesInstanceUid)
    if (existing) {
      existing.files.push(item)
    } else {
      seriesMap.set(item.seriesInstanceUid, {
        seriesInstanceUid: item.seriesInstanceUid,
        studyInstanceUid: item.studyInstanceUid,
        seriesDescription: item.seriesDescription,
        modality: item.modality,
        studyDate: item.studyDate,
        patientName: item.patientName,
        patientId: item.patientId,
        files: [item],
      })
    }
  }

  const seriesList = Array.from(seriesMap.values())
    .map((series) => ({
      ...series,
      files: [...series.files].sort((a, b) => {
        if (a.instanceNumber > 0 && b.instanceNumber > 0) {
          return a.instanceNumber - b.instanceNumber
        }
        if (a.imagePositionZ !== null && b.imagePositionZ !== null) {
          return a.imagePositionZ - b.imagePositionZ
        }
        return a.fileName.localeCompare(b.fileName)
      }),
    }))
    .sort((a, b) => b.files.length - a.files.length)

  return {
    accepted: accepted.map((p) => p.file),
    rejected,
    seriesList,
  }
}
