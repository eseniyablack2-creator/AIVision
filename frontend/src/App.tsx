import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import {
  createInitialViewportStatesRecord,
  DicomViewport,
  type ComparisonWorkbenchProbeState,
  type DicomComparisonSync,
} from './components/DicomViewport'
import { ComparisonMetadataBar } from './components/ComparisonMetadataBar'
import { ComparisonPatientMismatchModal } from './components/ComparisonPatientMismatchModal'
import { SimilarCasesModal } from './components/SimilarCasesModal'
import type { SimilarCasesFocusContext } from './lib/similarCasesMock'
import { loadWorkstationPrefs } from './lib/sessionPrefs'
import { clearCornerstoneFileManager } from './lib/dicomSliceLoader'
import {
  formatDate,
  formatFileSize,
  buildSeriesWithRejects,
} from './lib/dicom'
import type { DicomSeries } from './lib/dicom'
import { patientIdsMismatch } from './lib/comparisonSeriesMeta'

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
type ApiStatus = 'idle' | 'checking' | 'ok' | 'error'

function initialComparisonWorkbenchProbe(): ComparisonWorkbenchProbeState {
  const p = loadWorkstationPrefs()
  return {
    clinicalViewModeId: p.clinicalViewModeId ?? 'soft_tissue',
    presetId: p.presetId,
    windowCenter: 40,
    windowWidth: 400,
  }
}

function App() {
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const comparisonFolderRef = useRef<HTMLInputElement | null>(null)
  const comparisonLeadWorkbenchRef = useRef<ComparisonWorkbenchProbeState>(initialComparisonWorkbenchProbe())
  const [isStudyRailCollapsed, setIsStudyRailCollapsed] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([])
  const [seriesList, setSeriesList] = useState<DicomSeries[]>([])
  const [activeSeriesUid, setActiveSeriesUid] = useState('')
  const [nativeSeriesUid, setNativeSeriesUid] = useState(() => loadWorkstationPrefs().enterprise3d?.nativeSeriesUid ?? '')
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanMessage, setScanMessage] = useState(
    'Выберите папку исследования, и приложение само найдет внутри DICOM-файлы.',
  )
  const [seriesQuery, setSeriesQuery] = useState('')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle')
  const [apiStatusText, setApiStatusText] = useState('API не проверен')

  const [comparisonSeriesList, setComparisonSeriesList] = useState<DicomSeries[]>([])
  const [comparisonActiveUid, setComparisonActiveUid] = useState('')
  const [comparisonPaneOpen, setComparisonPaneOpen] = useState(false)
  const [linkedSliceIndex, setLinkedSliceIndex] = useState(0)
  const [linkedWindowCenter, setLinkedWindowCenter] = useState(40)
  const [linkedWindowWidth, setLinkedWindowWidth] = useState(400)
  const [linkedCrosshairX, setLinkedCrosshairX] = useState(0)
  const [linkedCrosshairY, setLinkedCrosshairY] = useState(0)
  const [linkedViewportStates, setLinkedViewportStates] = useState(createInitialViewportStatesRecord)
  const [linkedClinicalViewModeId, setLinkedClinicalViewModeId] = useState(
    () => loadWorkstationPrefs().clinicalViewModeId ?? 'soft_tissue',
  )
  const [linkedPresetId, setLinkedPresetId] = useState(() => loadWorkstationPrefs().presetId)
  const [similarCasesOpen, setSimilarCasesOpen] = useState(false)
  const [similarCasesFocus, setSimilarCasesFocus] = useState<SimilarCasesFocusContext | null>(null)
  const [patientMismatchAcknowledgedKey, setPatientMismatchAcknowledgedKey] = useState('')

  const totalSize = useMemo(
    () => selectedFiles.reduce((sum, file) => sum + file.size, 0),
    [selectedFiles],
  )

  const hasStudyLoaded = seriesList.length > 0
  const activeSeries =
    seriesList.find((series) => series.seriesInstanceUid === activeSeriesUid) ?? null

  const nativeSeries =
    seriesList.find((series) => series.seriesInstanceUid === nativeSeriesUid) ?? null
  const filteredSeriesList = useMemo(() => {
    const q = seriesQuery.trim().toLowerCase()
    if (!q) return seriesList
    return seriesList.filter((s) => {
      const hay = [
        s.seriesDescription,
        s.modality,
        s.patientName,
        s.patientId ?? '',
        s.studyDate ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [seriesList, seriesQuery])

  const comparisonSeries =
    comparisonSeriesList.find((s) => s.seriesInstanceUid === comparisonActiveUid) ?? null

  const checkInferenceApi = useCallback(async () => {
    const raw = import.meta.env.VITE_PATHOLOGY_API_URL
    const base =
      typeof raw === 'string' && raw.trim().length > 0
        ? raw.trim().replace(/\/$/, '')
        : 'http://127.0.0.1:8000'

    setApiStatus('checking')
    setApiStatusText('Проверяем API...')

    try {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      const res = await fetch(`${base}/health`, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit',
      })
      window.clearTimeout(timeout)
      if (!res.ok) {
        setApiStatus('error')
        setApiStatusText(`API недоступен (${res.status})`)
        return
      }
      setApiStatus('ok')
      setApiStatusText('API подключен')
    } catch {
      setApiStatus('error')
      setApiStatusText('API недоступен')
    }
  }, [])

  const comparisonSessionKey =
    comparisonPaneOpen && activeSeries && comparisonSeries
      ? `${activeSeries.seriesInstanceUid}\u00a0${comparisonSeries.seriesInstanceUid}`
      : null

  const showPatientMismatchModal = Boolean(
    comparisonSessionKey &&
      activeSeries &&
      comparisonSeries &&
      patientIdsMismatch(activeSeries, comparisonSeries) &&
      patientMismatchAcknowledgedKey !== comparisonSessionKey,
  )

  useEffect(() => {
    if (!comparisonPaneOpen) setPatientMismatchAcknowledgedKey('')
  }, [comparisonPaneOpen])

  useEffect(() => {
    void checkInferenceApi()
  }, [checkInferenceApi])

  const comparisonWorkbenchProbe = useCallback((state: ComparisonWorkbenchProbeState) => {
    comparisonLeadWorkbenchRef.current = state
  }, [])

  const comparisonSync: DicomComparisonSync | null = useMemo(() => {
    if (!comparisonPaneOpen || !comparisonSeries || !activeSeries) return null
    return {
      linkedSliceIndex,
      onLinkedSliceIndexChange: setLinkedSliceIndex,
      linkedWindowCenter,
      linkedWindowWidth,
      onLinkedWindowChange: (c: number, w: number) => {
        setLinkedWindowCenter(c)
        setLinkedWindowWidth(w)
      },
      linkedClinicalViewModeId,
      onLinkedClinicalViewModeChange: setLinkedClinicalViewModeId,
      linkedPresetId,
      onLinkedPresetIdChange: setLinkedPresetId,
      linkedCrosshairX,
      linkedCrosshairY,
      onLinkedCrosshairPatch: (patch: Partial<{ x: number; y: number }>) => {
        setLinkedCrosshairX((prev) => (patch.x !== undefined ? patch.x : prev))
        setLinkedCrosshairY((prev) => (patch.y !== undefined ? patch.y : prev))
      },
      linkedViewportStates,
      onLinkedViewportStatesChange: setLinkedViewportStates,
    }
  }, [
    comparisonPaneOpen,
    comparisonSeries,
    activeSeries,
    linkedSliceIndex,
    linkedWindowCenter,
    linkedWindowWidth,
    linkedClinicalViewModeId,
    linkedPresetId,
    linkedCrosshairX,
    linkedCrosshairY,
    linkedViewportStates,
  ])

  useLayoutEffect(() => {
    if (!comparisonPaneOpen || !activeSeries || !comparisonSeries) return
    const w = comparisonLeadWorkbenchRef.current
    setLinkedClinicalViewModeId(w.clinicalViewModeId)
    setLinkedPresetId(w.presetId)
    setLinkedWindowCenter(w.windowCenter)
    setLinkedWindowWidth(w.windowWidth)
  }, [comparisonPaneOpen, activeSeries?.seriesInstanceUid, comparisonSeries?.seriesInstanceUid])

  useEffect(() => {
    if (!comparisonPaneOpen || !activeSeries || !comparisonSeries) return
    const n = Math.min(activeSeries.files.length, comparisonSeries.files.length)
    if (n <= 0) return
    setLinkedSliceIndex((z) => Math.min(z, n - 1))
  }, [comparisonPaneOpen, activeSeries, comparisonSeries])

  useEffect(() => {
    if (!comparisonPaneOpen) {
      setLinkedViewportStates(createInitialViewportStatesRecord())
      return
    }
    if (!activeSeries || !comparisonSeries) return
    setLinkedViewportStates(createInitialViewportStatesRecord())
    setLinkedCrosshairX(0)
    setLinkedCrosshairY(0)
  }, [
    comparisonPaneOpen,
    activeSeries?.seriesInstanceUid,
    comparisonSeries?.seriesInstanceUid,
  ])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])

    if (files.length === 0) {
      clearCornerstoneFileManager()
      setSelectedFiles([])
      setRejectedFiles([])
      setSeriesList([])
      setActiveSeriesUid('')
      setNativeSeriesUid('')
      setComparisonSeriesList([])
      setComparisonActiveUid('')
      setComparisonPaneOpen(false)
      setScanStatus('idle')
      setScanMessage(
        'Выберите папку исследования, и приложение само найдет внутри DICOM-файлы.',
      )
      return
    }

    setScanStatus('loading')
    setScanMessage('Идет проверка файлов, поиск DICOM и разбор серий исследования...')

    try {
      clearCornerstoneFileManager()
      const { accepted, rejected, seriesList: groupedSeries } = await buildSeriesWithRejects(files)

      setSelectedFiles(accepted)
      setRejectedFiles(rejected)
      setSeriesList(groupedSeries)
      setActiveSeriesUid(groupedSeries[0]?.seriesInstanceUid ?? '')
      // Best-effort auto-pick a likely native (NAC) series for DSA.
      if (groupedSeries.length > 0) {
        const byHint = groupedSeries.find((s) =>
          /nac|native|non[-\s]?contrast|без\s*контраста/i.test(s.seriesDescription || ''),
        )
        const pick = byHint ?? groupedSeries[0]
        setNativeSeriesUid(pick?.seriesInstanceUid ?? '')
      }
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

  async function handleComparisonFolderChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    try {
      const { seriesList: grouped } = await buildSeriesWithRejects(files)
      setComparisonSeriesList(grouped)
      setComparisonActiveUid(grouped[0]?.seriesInstanceUid ?? '')
      setComparisonPaneOpen(true)
    } catch {
      setComparisonSeriesList([])
      setComparisonActiveUid('')
    }
    event.target.value = ''
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
            <button
              type="button"
              className="nav-action-button"
              onClick={() => {
                if (comparisonSeries) setComparisonPaneOpen((v) => !v)
                else comparisonFolderRef.current?.click()
              }}
              title="Сравнение в динамике (§3): загрузите вторую папку DICOM"
            >
              {comparisonPaneOpen ? 'Скрыть сравнение' : 'Сравнение'}
            </button>
            <button
              type="button"
              className="nav-action-button"
              onClick={() => setSimilarCasesOpen(true)}
              title="Похожие случаи (§2, демо)"
            >
              Похожие случаи
            </button>
          </div>
          <div className="top-nav-right">
            <div className="api-health-box">
              <button
                className="api-health-button"
                type="button"
                onClick={() => void checkInferenceApi()}
                title="Проверить связь с backend API"
              >
                {apiStatus === 'checking' ? 'Проверка...' : 'Проверить API'}
              </button>
              <span className={`api-health-chip api-health-${apiStatus}`}>{apiStatusText}</span>
            </div>
            <span>{activeSeries?.patientName ?? 'Пациент не выбран'}</span>
            <span className="top-nav-dates">
              {activeSeries ? (
                <>
                  <span title="Текущее исследование">Тек.: {formatDate(activeSeries.studyDate)}</span>
                  {comparisonPaneOpen && comparisonSeries ? (
                    <span title="Сравнение"> · Сравн.: {formatDate(comparisonSeries.studyDate)}</span>
                  ) : null}
                </>
              ) : (
                ''
              )}
            </span>
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
        <input
          ref={comparisonFolderRef}
          className="upload-input"
          type="file"
          multiple
          onChange={handleComparisonFolderChange}
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
              <>
                <div className="series-search">
                  <input
                    className="series-search-input"
                    value={seriesQuery}
                    onChange={(e) => setSeriesQuery(e.target.value)}
                    placeholder="Поиск серии…"
                    aria-label="Поиск серии"
                  />
                  {seriesQuery ? (
                    <button type="button" className="series-search-clear" onClick={() => setSeriesQuery('')} title="Очистить">
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="series-list" role="list">
                  {filteredSeriesList.map((series) => {
                    const isActive = series.seriesInstanceUid === activeSeriesUid
                    return (
                      <button
                        className={isActive ? 'series-row active' : 'series-row'}
                        key={`${series.studyInstanceUid}-${series.seriesInstanceUid}`}
                        onClick={() => setActiveSeriesUid(series.seriesInstanceUid)}
                        type="button"
                        role="listitem"
                        title={`${series.seriesDescription || 'Серия'} · ${series.modality} · ${series.files.length} срез.`}
                      >
                        <div className="series-row-main">
                          <div className="series-row-title">
                            <span className="series-row-desc">{series.seriesDescription || 'Серия без описания'}</span>
                            <span className="series-row-meta">
                              {series.modality} · {series.files.length}
                            </span>
                          </div>
                          <div className="series-row-sub">
                            <span className="series-row-patient">
                              {(series.patientName || '').replace(/\^/g, ' ').replace(/\s+/g, ' ').trim()}
                            </span>
                            <span className="series-row-date">{formatDate(series.studyDate)}</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {filteredSeriesList.length === 0 ? (
                    <p className="empty-state">Ничего не найдено.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="empty-state">
                После выбора папки здесь появится список DICOM-серий.
              </p>
            )}

            {hasStudyLoaded && !isStudyRailCollapsed ? (
              <div className="comparison-rail-block">
                <p className="comparison-rail-title">Сравнение в динамике (§3)</p>
                <p className="comparison-rail-hint">
                  Загрузите вторую папку с DICOM (другое исследование). Срез и окно синхронизируются между
                  колонками; при двух колонках сверху показываются Patient ID, UID и отличия FOV/геометрии.
                </p>
                {comparisonSeriesList.length > 0 ? (
                  <>
                    <label className="comparison-rail-label" htmlFor="comparison-series-select">
                      Серия для сравнения
                    </label>
                    <select
                      id="comparison-series-select"
                      className="comparison-series-select"
                      value={comparisonActiveUid}
                      onChange={(e) => setComparisonActiveUid(e.target.value)}
                    >
                      {comparisonSeriesList.map((s) => (
                        <option key={s.seriesInstanceUid} value={s.seriesInstanceUid}>
                          {s.seriesDescription || 'Серия'} · {formatDate(s.studyDate)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="comparison-toggle-button"
                      onClick={() => setComparisonPaneOpen((v) => !v)}
                    >
                      {comparisonPaneOpen ? 'Одна колонка viewer' : 'Показать две колонки'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="comparison-load-button"
                    onClick={() => comparisonFolderRef.current?.click()}
                  >
                    Загрузить папку 2-го исследования
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <div
            className={
              comparisonPaneOpen && comparisonSeries
                ? 'viewer-comparison-with-meta'
                : 'viewer-comparison-with-meta single'
            }
          >
            {comparisonPaneOpen && comparisonSeries && activeSeries ? (
              <ComparisonMetadataBar primary={activeSeries} secondary={comparisonSeries} />
            ) : null}
            <div
              className={
                comparisonPaneOpen && comparisonSeries
                  ? 'viewer-comparison-grid'
                  : 'viewer-comparison-grid single'
              }
            >
              <DicomViewport
                activeSeries={activeSeries}
                nativeSeries={comparisonPaneOpen ? comparisonSeries : nativeSeries}
                allSeries={seriesList}
                nativeSeriesUid={nativeSeriesUid}
                onNativeSeriesUidChange={(uid) => {
                  setNativeSeriesUid(uid)
                }}
                comparisonSync={comparisonSync ?? null}
                comparisonSessionKey={comparisonSessionKey}
                viewerLabel={
                  comparisonPaneOpen && comparisonSeries ? 'Текущая серия' : undefined
                }
                onReportViewerFocus={setSimilarCasesFocus}
                comparisonWorkbenchProbe={comparisonWorkbenchProbe}
                suspendGlobalShortcuts={showPatientMismatchModal}
              />
              {comparisonPaneOpen && comparisonSeries ? (
                <DicomViewport
                  activeSeries={comparisonSeries}
                  nativeSeries={activeSeries}
                  comparisonSync={comparisonSync ?? null}
                  comparisonSessionKey={comparisonSessionKey}
                  viewerLabel="Серия сравнения"
                  suspendGlobalShortcuts={showPatientMismatchModal}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {activeSeries && comparisonSeries ? (
        <ComparisonPatientMismatchModal
          open={showPatientMismatchModal}
          primaryPatientId={activeSeries.patientId ?? ''}
          secondaryPatientId={comparisonSeries.patientId ?? ''}
          onContinue={() => {
            if (comparisonSessionKey) setPatientMismatchAcknowledgedKey(comparisonSessionKey)
          }}
          onHideComparison={() => setComparisonPaneOpen(false)}
        />
      ) : null}

      {activeSeries ? (
        <SimilarCasesModal
          open={similarCasesOpen}
          onClose={() => setSimilarCasesOpen(false)}
          seriesInstanceUid={activeSeries.seriesInstanceUid}
          focus={similarCasesFocus}
        />
      ) : null}

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
