import { useEffect, useState } from 'react'
import { loadDicomTagRows, type DicomTagRow } from '../lib/dicomTagsList'

type Props = {
  open: boolean
  onClose: () => void
  file: File | null
  title?: string
}

export function DicomTagsModal({ open, onClose, file, title }: Props) {
  const [rows, setRows] = useState<DicomTagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !file) {
      setRows([])
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void loadDicomTagRows(file).then(
      (list) => {
        if (!cancelled) {
          setRows(list)
          setLoading(false)
        }
      },
      () => {
        if (!cancelled) {
          setRows([])
          setError('Не удалось разобрать DICOM (сжатый или нестандартный поток).')
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, file])

  if (!open) return null

  return (
    <div className="dicom-tags-overlay" role="dialog" aria-modal="true" aria-labelledby="dicom-tags-title">
      <button type="button" className="dicom-tags-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="dicom-tags-panel">
        <div className="dicom-tags-header">
          <h2 id="dicom-tags-title">{title ?? 'DICOM-теги'}</h2>
          <button type="button" className="dicom-tags-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        {file ? (
          <p className="dicom-tags-file">{file.name}</p>
        ) : (
          <p className="dicom-tags-file">Файл не выбран</p>
        )}
        {loading ? <p className="dicom-tags-loading">Чтение тегов…</p> : null}
        {error ? <p className="dicom-tags-error">{error}</p> : null}
        {!loading && !error && rows.length > 0 ? (
          <div className="dicom-tags-table-wrap">
            <table className="dicom-tags-table">
              <thead>
                <tr>
                  <th>Тег</th>
                  <th>Значение</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.tag}-${i}`}>
                    <td className="dicom-tags-td-tag">{r.tag}</td>
                    <td className="dicom-tags-td-val">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
