/**
 * Экспорт файлов с безопасными именами (без ФИО из имени файла).
 * Полная деидентификация тегов DICOM требует отдельного конвейера (dcm4che, pydicom).
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function sanitizeFilename(_originalName: string, studyUid: string, index: number) {
  const safe = studyUid.replace(/[^a-zA-Z0-9.-]/g, '').slice(-16) || 'study'
  return `AIVision_${safe}_${String(index).padStart(5, '0')}.dcm`
}

export async function zipFilesAsAnonymous(
  files: File[],
  studyInstanceUid: string,
): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (let i = 0; i < files.length; i += 1) {
    const buf = await files[i].arrayBuffer()
    zip.file(sanitizeFilename(files[i].name, studyInstanceUid, i), buf)
  }
  return zip.generateAsync({ type: 'blob' })
}
