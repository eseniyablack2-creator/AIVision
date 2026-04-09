import dicomParser from 'dicom-parser'

export type DicomTagRow = {
  tag: string
  value: string
}

function formatTagKey(hexKey: string) {
  const h = hexKey.startsWith('x') ? hexKey.slice(1) : hexKey
  if (h.length < 8) return hexKey
  const g = h.slice(0, 4)
  const e = h.slice(4, 8)
  return `(${g},${e})`
}

function readElementValue(dataSet: dicomParser.DataSet, tag: string): string {
  if (tag === 'x7fe00010') {
    const el = dataSet.elements.x7fe00010
    const n = el?.length ?? 0
    return `(Pixel Data, ${n} bytes)`
  }
  try {
    const s = dataSet.string(tag)
    if (s !== undefined && s.length > 0) {
      return s.length > 240 ? `${s.slice(0, 240)}…` : s
    }
  } catch {
    /* fall through */
  }
  try {
    const u = dataSet.uint16(tag)
    if (u !== undefined) return String(u)
  } catch {
    /* fall through */
  }
  try {
    const f = dataSet.floatString(tag)
    if (f !== undefined && f !== null && String(f) !== '') return String(f)
  } catch {
    /* fall through */
  }
  return '—'
}

/** Список тегов текущего файла для модального просмотра (без полного SR). */
export async function loadDicomTagRows(file: File): Promise<DicomTagRow[]> {
  const arrayBuffer = await file.arrayBuffer()
  const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer))
  const keys = Object.keys(dataSet.elements)
    .filter((k) => k.startsWith('x'))
    .sort((a, b) => a.localeCompare(b))
  return keys.map((tag) => ({
    tag: formatTagKey(tag),
    value: readElementValue(dataSet, tag),
  }))
}
