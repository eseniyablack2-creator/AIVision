/**
 * Экспорт текущего вида канваса как DICOM Secondary Capture (OT),
 * с контекстом пациента/исследования из исходного среза.
 */
import dcmjs from 'dcmjs'

const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1'
const SECONDARY_CAPTURE_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.7'

function naturalizedDatasetToBlob(dataset: Record<string, unknown>): Blob {
  const { datasetToDict } = dcmjs.data
  const dict = datasetToDict(dataset as never)
  const bytes = dict.write()
  return new Blob([new Uint8Array(bytes)], { type: 'application/dicom' })
}

function canvasToMono8(canvas: HTMLCanvasElement): { rows: number; columns: number; pixelData: ArrayBuffer } {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен')
  const columns = canvas.width
  const rows = canvas.height
  if (columns < 1 || rows < 1) throw new Error('Пустой холст')
  const im = ctx.getImageData(0, 0, columns, rows)
  const rgba = im.data
  const n = columns * rows
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    out[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2])
  }
  return {
    rows,
    columns,
    pixelData: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
  }
}

export type SecondaryCaptureExportOptions = {
  /** DICOM ImageComments (0018,4000) — кратко про наложенные аннотации и срез */
  imageComments?: string
}

/**
 * @param sourceDicomFile — файл активного среза (для метаданных и ссылки Source Image)
 */
export async function buildViewportSecondaryCaptureBlob(
  sourceDicomFile: File,
  canvas: HTMLCanvasElement,
  options?: SecondaryCaptureExportOptions,
): Promise<Blob> {
  const { DicomMessage, DicomMetaDictionary } = dcmjs.data
  const ab = await sourceDicomFile.arrayBuffer()
  let dicomData: ReturnType<typeof DicomMessage.readFile>
  try {
    dicomData = DicomMessage.readFile(ab)
  } catch {
    throw new Error('Не удалось прочитать исходный DICOM')
  }
  const src = DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<string, unknown>

  const { rows, columns, pixelData } = canvasToMono8(canvas)
  const date = DicomMetaDictionary.date()
  const time = DicomMetaDictionary.time()
  const sopClass =
    (DicomMetaDictionary as { sopClassUIDsByName?: { SecondaryCaptureImage?: string } }).sopClassUIDsByName
      ?.SecondaryCaptureImage ?? SECONDARY_CAPTURE_SOP_CLASS

  const sopInstanceUID = DicomMetaDictionary.uid()
  const seriesInstanceUID = DicomMetaDictionary.uid()

  const out: Record<string, unknown> = {
    _meta: { TransferSyntaxUID: EXPLICIT_VR_LE },
    SpecificCharacterSet: src.SpecificCharacterSet ?? 'ISO_IR 192',
    ImageType: ['DERIVED', 'SECONDARY'],
    SOPClassUID: sopClass,
    SOPInstanceUID: sopInstanceUID,
    InstanceCreationDate: date,
    InstanceCreationTime: time,
    StudyDate: src.StudyDate ?? date,
    StudyTime: src.StudyTime ?? time,
    AccessionNumber: src.AccessionNumber ?? '',
    Modality: 'OT',
    Manufacturer: 'AIVision',
    ManufacturerModelName: 'AIVision Web Viewer',
    InstitutionName: src.InstitutionName ?? '',
    ReferringPhysicianName: src.ReferringPhysicianName ?? '',
    StudyDescription: src.StudyDescription ?? '',
    SeriesDescription: `AIVision viewport SC ${date}`,
    PatientName: src.PatientName,
    PatientID: src.PatientID,
    PatientBirthDate: src.PatientBirthDate,
    PatientSex: src.PatientSex,
    StudyInstanceUID: src.StudyInstanceUID,
    SeriesInstanceUID: seriesInstanceUID,
    SeriesNumber: '998',
    InstanceNumber: '1',
    ConversionType: 'WSD',
    Rows: rows,
    Columns: columns,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    LossyImageCompression: '00',
    PixelData: pixelData,
  }

  const refClass = src.SOPClassUID
  const refInst = src.SOPInstanceUID
  if (typeof refClass === 'string' && refClass.length > 0 && typeof refInst === 'string' && refInst.length > 0) {
    out.SourceImageSequence = [
      {
        ReferencedSOPClassUID: refClass,
        ReferencedSOPInstanceUID: refInst,
      },
    ]
  }

  const ic = options?.imageComments?.trim()
  if (ic) {
    out.ImageComments = ic.length > 1022 ? `${ic.slice(0, 1019)}…` : ic
  }

  return naturalizedDatasetToBlob(out)
}
