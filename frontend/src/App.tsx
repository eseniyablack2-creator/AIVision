import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import { DicomViewport } from './components/DicomViewport'
import {
  buildSeries,
  formatDate,
  formatFileSize,
  splitDicomFiles,
} from './lib/dicom'
import type { DicomSeries } from './lib/dicom'

const features = [
  'Автоматический отбор DICOM-файлов из выбранной папки',
  'Чтение метаданных и группировка по сериям',
  'Открытие активной серии в MPR-viewer',
  'Основа под клинические режимы, динамику и AI-подсказки',
]

const nextSteps = [
  'Сравнение в динамике side-by-side',
  'Больше радиологических пресетов и layout-режимов',
  '3D-реконструкция, MIP и сосудистые режимы',
]

type ScanStatus = 'idle' | 'loading' | 'done' | 'error'

function App() {
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [isStudyRailCollapsed, setIsStudyRailCollapsed] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([])
  const [seriesList, setSeriesList] = useState<DicomSeries[]>([])
  const [activeSeriesUid, setActiveSeriesUid] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanMessage, setScanMessage] = useState(
    'Выберите папку исследования, и приложение само найдет внутри DICOM-файлы.',
  )

  const totalSize = useMemo(
    () => selectedFiles.reduce((sum, file) => sum + file.size, 0),
    [selectedFiles],
  )

  const hasStudyLoaded = seriesList.length > 0
  const activeSeries =
    seriesList.find((series) => series.seriesInstanceUid === activeSeriesUid) ?? null

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])

    if (files.length === 0) {
      setSelectedFiles([])
      setRejectedFiles([])
      setSeriesList([])
      setActiveSeriesUid('')
      setScanStatus('idle')
      setScanMessage(
        'Выберите папку исследования, и приложение само найдет внутри DICOM-файлы.',
      )
      return
    }

    setScanStatus('loading')
    setScanMessage('Идет проверка файлов, поиск DICOM и разбор серий исследования...')

    try {
      const { accepted, rejected } = await splitDicomFiles(files)
      const groupedSeries = await buildSeries(accepted)

      setSelectedFiles(accepted)
      setRejectedFiles(rejected)
      setSeriesList(groupedSeries)
      setActiveSeriesUid(groupedSeries[0]?.seriesInstanceUid ?? '')
      setScanStatus('done')

      if (accepted.length > 0) {
        setScanMessage(
          `Найдено DICOM-файлов: ${accepted.length}. Распознано серий: ${groupedSeries.length}.`,
        )
      } else {
        setScanMessage(
          'Папка выбрана, но DICOM-файлы не распознаны. Возможно, у файлов нестандартный формат или вложенная структура.',
        )
      }
    } catch {
      setSelectedFiles([])
      setRejectedFiles([])
      setSeriesList([])
      setActiveSeriesUid('')
      setScanStatus('error')
      setScanMessage('Не удалось обработать папку. Попробуйте выбрать ее еще раз.')
    }
  }

  return (
    <main className={hasStudyLoaded ? 'app-shell study-loaded' : 'app-shell'}>
      {hasStudyLoaded ? (
        <header className="top-nav">
          <div className="top-nav-left">
            <span className="brand-mark">AIVision</span>
            <button
              className="nav-action-button"
              onClick={() => folderInputRef.current?.click()}
              type="button"
            >
              Исследования
            </button>
            <span>Размещение</span>
            <span>Обработка</span>
            <span>Инструменты</span>
            <span>Сравнение</span>
          </div>
          <div className="top-nav-right">
            <span>{activeSeries?.patientName ?? 'Пациент не выбран'}</span>
            <span>{activeSeries ? formatDate(activeSeries.studyDate) : ''}</span>
          </div>
        </header>
      ) : null}

      <section className="hero-panel">
        <p className="eyebrow">AIVision</p>
        <h1>Инструмент радиолога для КТ и DICOM</h1>
        <p className="lead">
          Мы собираем локальное приложение, которое само ищет DICOM в выбранной
          папке, собирает серии, открывает активную серию в viewer и дальше растет
          в режимы динамики, MPR, 3D и похожих случаев.
        </p>

        <div className="status-card">
          <span className="status-label">Текущий этап</span>
          <strong>Рабочая станция: MPR-viewer, layout-переключение и resize</strong>
        </div>
      </section>

      <section className="upload-panel">
        <input
          ref={folderInputRef}
          className="upload-input"
          type="file"
          multiple
          onChange={handleFileChange}
          {...({
            webkitdirectory: '',
            directory: '',
          } as Record<string, string>)}
        />

        {!hasStudyLoaded ? (
          <>
            <div className="upload-copy">
              <p className="section-label">Импорт исследования</p>
              <h2>Загрузите папку, затем откройте нужную серию</h2>
              <p>
                На этом шаге приложение уже умеет выбирать активную серию и
                открывать ее в viewer с базовой навигацией. Следующий слой -
                кликабельные crosshair, предсказуемая синхронизация и настоящая
                рабочая раскладка.
              </p>
            </div>

            <div className="upload-actions">
              <label className="upload-box">
                <input
                  className="upload-input"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  {...({
                    webkitdirectory: '',
                    directory: '',
                  } as Record<string, string>)}
                />
                <span className="upload-button">Выбрать папку исследования</span>
                <span className="upload-hint">
                  Подходит для папки КТ, где лежат все срезы и служебные файлы
                </span>
              </label>

              <div className={`scan-status scan-status-${scanStatus}`}>
                <span className="summary-label">Статус проверки</span>
                <strong>{scanMessage}</strong>
              </div>
            </div>

            <div className="upload-summary">
              <div>
                <span className="summary-label">DICOM найдено</span>
                <strong>{selectedFiles.length}</strong>
              </div>
              <div>
                <span className="summary-label">Серий распознано</span>
                <strong>{seriesList.length}</strong>
              </div>
              <div>
                <span className="summary-label">Прочих файлов исключено</span>
                <strong>{rejectedFiles.length}</strong>
              </div>
              <div>
                <span className="summary-label">Размер DICOM</span>
                <strong>{formatFileSize(totalSize)}</strong>
              </div>
            </div>
          </>
        ) : null}

        <div className={isStudyRailCollapsed ? 'workspace-grid rail-collapsed' : 'workspace-grid'}>
          <div className={isStudyRailCollapsed ? 'file-list-card study-rail collapsed' : 'file-list-card study-rail'}>
            <div className="file-list-header">
              <div className="study-rail-header-copy">
                <h3>Серии исследования</h3>
                {!isStudyRailCollapsed ? (
                  seriesList.length > 0 ? (
                    <span>Нажмите на карточку, чтобы открыть серию</span>
                  ) : (
                    <span>Серии пока не распознаны</span>
                  )
                ) : null}
              </div>
              <button
                className="rail-toggle-button"
                onClick={() => setIsStudyRailCollapsed((value) => !value)}
                type="button"
                aria-label={isStudyRailCollapsed ? 'Развернуть панель серий' : 'Свернуть панель серий'}
                title={isStudyRailCollapsed ? 'Развернуть панель серий' : 'Свернуть панель серий'}
              >
                {isStudyRailCollapsed ? '»' : '«'}
              </button>
            </div>

            {isStudyRailCollapsed ? (
              <div className="study-rail-collapsed-state">
                <span className="collapsed-count">{seriesList.length}</span>
                <span className="collapsed-label">серий</span>
              </div>
            ) : seriesList.length > 0 ? (
              <div className="series-grid">
                {seriesList.map((series) => {
                  const isActive = series.seriesInstanceUid === activeSeriesUid

                  return (
                    <button
                      className={isActive ? 'series-card active' : 'series-card'}
                      key={`${series.studyInstanceUid}-${series.seriesInstanceUid}`}
                      onClick={() => setActiveSeriesUid(series.seriesInstanceUid)}
                      type="button"
                    >
                      <div className="series-card-header">
                        <h4>{series.seriesDescription}</h4>
                        <span>{series.modality}</span>
                      </div>

                      <dl className="series-meta">
                        <div>
                          <dt>Пациент</dt>
                          <dd>{series.patientName}</dd>
                        </div>
                        <div>
                          <dt>Дата</dt>
                          <dd>{formatDate(series.studyDate)}</dd>
                        </div>
                        <div>
                          <dt>Срезов</dt>
                          <dd>{series.files.length}</dd>
                        </div>
                        <div>
                          <dt>Первая позиция</dt>
                          <dd>{series.files[0]?.instanceNumber || 0}</dd>
                        </div>
                      </dl>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="empty-state">
                После выбора папки здесь появится список DICOM-серий.
              </p>
            )}
          </div>

          <DicomViewport activeSeries={activeSeries} />
        </div>
      </section>

      {!hasStudyLoaded ? (
        <section className="grid-section">
          <article className="info-card">
            <h2>Что уже есть</h2>
            <ul>
              {features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>

          <article className="info-card accent-card">
            <h2>Что делаем дальше</h2>
            <ol>
              {nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        </section>
      ) : null}

      {!hasStudyLoaded ? (
        <section className="diagnosis-note">
          <h2>Путь к большой рабочей станции</h2>
          <p>
            Ваш целевой vision правильный: viewer должен становиться почти
            невидимым и освобождать врача от лишних кликов. Поэтому мы идем
            слоями: надежная загрузка, корректная геометрия, удобный workspace,
            потом динамика, MPR/3D и только после этого похожие случаи и AI.
          </p>
        </section>
      ) : null}
    </main>
  )
}

export default App
