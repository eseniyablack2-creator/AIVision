import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import {
  createInitialViewportStatesRecord,
  DicomViewport,
  type ComparisonWorkbenchProbeState,
  type DicomComparisonSync,
} from './components/DicomViewport.tsx'
import { ComparisonMetadataBar } from './components/ComparisonMetadataBar'
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
import {
  getExplicitPathologyApiBaseFromEnv,
  getInferenceHealthCheckCandidates,
} from './lib/inferenceApiBase'

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
  const filesOnlyInputRef = useRef<HTMLInputElement | null>(null)
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
  /** Выпадающее меню серии в левой панели (⋯). */
  const [seriesRowMenuUid, setSeriesRowMenuUid] = useState<string | null>(null)

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
    const candidates = getInferenceHealthCheckCandidates()
    const primary = candidates[0] ?? ''
    const explicitPathologyBase = getExplicitPathologyApiBaseFromEnv()
    const envOverride = explicitPathologyBase != null

    setApiStatus('checking')
    setApiStatusText('Проверяем API...')

    /** Прямой запрос к inference (CORS у API открыт). Обходит прокси Vite, если он не срабатывает. */
    const tryDirectLoopbackHealth = async (): Promise<boolean> => {
      if (envOverride) return false
      if (typeof window === 'undefined') return false
      const urls = ['http://127.0.0.1:8787/health', 'http://localhost:8787/health']
      for (const url of urls) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 5000)
        try {
          const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          })
          window.clearTimeout(timeout)
          if (!res.ok) continue
          const data = (await res.json().catch(() => null)) as { status?: string } | null
          if (data?.status === 'ok') {
            setApiStatus('ok')
            setApiStatusText('API подключен')
            return true
          }
        } catch {
          window.clearTimeout(timeout)
        }
      }
      return false
    }

    if (await tryDirectLoopbackHealth()) return

    /** Запрос к 127.0.0.1:8787 из процесса Vite (Node) — если браузер режет прямой :8787. */
    const tryViteNodeHealthProbe = async (): Promise<'ok' | 'api_down' | 'skip'> => {
      if (envOverride) return 'skip'
      if (typeof window === 'undefined') return 'skip'
      if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return 'skip'
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 6000)
      try {
        const res = await fetch('/__aivision_health_probe', {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        window.clearTimeout(timeout)
        const data = (await res.json().catch(() => null)) as {
          status?: string
          service?: string
          error?: string
          code?: string | null
        } | null
        // Достаточно status (как у tryDirectLoopbackHealth); service мог отличаться в форках/прокси.
        if (data?.status === 'ok') {
          setApiStatus('ok')
          setApiStatusText('API подключен')
          return 'ok'
        }
        if (data?.status === 'error' && data.service === 'aivision-health-probe') {
          setApiStatus('error')
          const detail = [data.error, data.code].filter(Boolean).join(' ')
          setApiStatusText(
            `Inference не запущен (порт 8787 с сервера Vite недоступен${detail ? `: ${detail}` : ''}). В папке AIVision выполните npm run dev:full и оставьте окно открытым, пока видите строку «Uvicorn running…».`,
          )
          return 'api_down'
        }
        return 'skip'
      } catch {
        window.clearTimeout(timeout)
        return 'skip'
      }
    }

    const probe = await tryViteNodeHealthProbe()
    if (probe === 'ok') return
    if (probe === 'api_down') return

    /** Сначала относительный URL — тот же host:port, что вкладка (устойчиво в Яндекс.Браузере и при localhost/127.0.0.1). */
    const tryRelativeProxyHealth = async (): Promise<boolean> => {
      if (envOverride) return false
      if (typeof window === 'undefined') return false
      const { protocol } = window.location
      if (protocol !== 'http:' && protocol !== 'https:') return false
      const path = `${import.meta.env.BASE_URL}__aivision_inference/health`.replace(/\/{2,}/g, '/')
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch(path, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        window.clearTimeout(timeout)
        if (!res.ok) return false
        const data = (await res.json().catch(() => null)) as { status?: string } | null
        if (!data || data.status !== 'ok') return false
        setApiStatus('ok')
        setApiStatusText('API подключен')
        return true
      } catch (e) {
        window.clearTimeout(timeout)
        if (import.meta.env.DEV) console.debug('[AIVision] /__aivision_inference/health', e)
        return false
      }
    }

    const tryOneBase = async (base: string): Promise<string | null> => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 5000)
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}/health`, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        window.clearTimeout(timeout)
        if (!res.ok) return null
        const data = (await res.json().catch(() => null)) as { status?: string } | null
        if (!data || data.status !== 'ok') return null
        return base
      } catch {
        window.clearTimeout(timeout)
        return null
      }
    }

    /** Несколько URL сразу: не ждём по очереди таймаут LAN/127.0.0.1; повторы — если API ещё поднимается. */
    const maxRounds = 10
    const pauseMs = 450
    for (let round = 0; round < maxRounds; round += 1) {
      if (await tryRelativeProxyHealth()) return
      const outcomes = await Promise.all(candidates.map((b) => tryOneBase(b)))
      const okBase = outcomes.find((x) => x != null) ?? null
      if (okBase) {
        setApiStatus('ok')
        setApiStatusText(okBase === primary ? 'API подключен' : `API подключен (${okBase})`)
        return
      }
      if (round < maxRounds - 1) {
        await new Promise<void>((r) => {
          window.setTimeout(r, pauseMs)
        })
      }
    }

    setApiStatus('error')
    if (envOverride) {
      const hint = explicitPathologyBase ?? String(import.meta.env.VITE_PATHOLOGY_API_URL).trim()
      setApiStatusText(
        `Не удалось достучаться до inference по VITE_PATHOLOGY_API_URL (${hint}). Убедитесь, что там верный базовый URL и GET …/health возвращает JSON с "status":"ok". Если хотите стандартный локальный режим (:8787 + прокси Vite), уберите переменную из .env и перезапустите dev.`,
      )
    } else {
      setApiStatusText(
        'Сайт не достучался до API (ни прямой :8787, ни прокси Vite). Проверьте: окно с npm run dev:full открыто и в нём есть «Uvicorn running»; в новой вкладке открывается http://127.0.0.1:8787/docs ; адрес страницы AIVision совпадает со строкой «Local:»; Ctrl+Shift+R.',
      )
    }
  }, [])

  const comparisonSessionKey =
    comparisonPaneOpen && activeSeries && comparisonSeries
      ? `${activeSeries.seriesInstanceUid}\u00a0${comparisonSeries.seriesInstanceUid}`
      : null

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

  useEffect(() => {
    if (!seriesRowMenuUid) return
    const onDocPointer = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (el?.closest('[data-series-menu-root]')) return
      setSeriesRowMenuUid(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSeriesRowMenuUid(null)
    }
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [seriesRowMenuUid])

  useEffect(() => {
    if (isStudyRailCollapsed) setSeriesRowMenuUid(null)
  }, [isStudyRailCollapsed])

  /** Убрать серию из рабочего списка (из памяти; файлы на диске не удаляются). */
  const removeStudySeries = useCallback(
    (seriesInstanceUid: string) => {
      setSeriesRowMenuUid(null)
      const victim = seriesList.find((s) => s.seriesInstanceUid === seriesInstanceUid)
      if (!victim) return

      const next = seriesList.filter((s) => s.seriesInstanceUid !== seriesInstanceUid)
      const victimFiles = new Set(victim.files.map((p) => p.file))
      setSelectedFiles((files) => files.filter((f) => !victimFiles.has(f)))
      setSeriesList(next)

      if (next.length === 0) {
        clearCornerstoneFileManager()
        setActiveSeriesUid('')
        setNativeSeriesUid('')
        return
      }

      const removedActive = activeSeriesUid === seriesInstanceUid
      const newActive = removedActive ? next[0]!.seriesInstanceUid : activeSeriesUid
      if (removedActive) {
        setActiveSeriesUid(newActive)
      }

      const nativeInvalid =
        nativeSeriesUid === seriesInstanceUid ||
        !next.some((s) => s.seriesInstanceUid === nativeSeriesUid)
      const nativeClashesActive = nativeSeriesUid === newActive
      if (nativeInvalid || (removedActive && nativeClashesActive)) {
        const pick = next.find((s) => s.seriesInstanceUid !== newActive) ?? next[0]!
        setNativeSeriesUid(pick.seriesInstanceUid)
      }
    },
    [seriesList, activeSeriesUid, nativeSeriesUid],
  )

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
      const { accepted, rejected, seriesList: groupedSeries } = await buildSeriesWithRejects(files, {
        onProgress: (done, total) => {
          setScanMessage(`Разбор DICOM: ${done} / ${total} файлов…`)
        },
      })

      setSelectedFiles(accepted)
      setRejectedFiles(rejected)
      setSeriesList(groupedSeries)
      const firstUid = groupedSeries[0]?.seriesInstanceUid ?? ''
      setActiveSeriesUid(firstUid)
      // NAC для DSA: только если явно по описанию и не та же серия, что активная (иначе DSA по одной КТ обнуляет 3D).
      if (groupedSeries.length > 0) {
        const byHint = groupedSeries.find((s) =>
          /nac|native|non[-\s]?contrast|без\s*контраста/i.test(s.seriesDescription || ''),
        )
        if (byHint && byHint.seriesInstanceUid !== firstUid) {
          setNativeSeriesUid(byHint.seriesInstanceUid)
        } else {
          setNativeSeriesUid('')
        }
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
    } catch (err) {
      console.error('DICOM import failed', err)
      setSelectedFiles([])
      setRejectedFiles([])
      setSeriesList([])
      setActiveSeriesUid('')
      setScanStatus('error')
      const detail = err instanceof Error ? err.message : String(err)
      setScanMessage(
        detail
          ? `Ошибка импорта: ${detail}. Если файлов очень много — закройте другие вкладки и повторите.`
          : 'Не удалось обработать выбранные файлы. Попробуйте снова или выберите меньше файлов за раз.',
      )
    } finally {
      const t = event.target
      if (t && 'value' in t) (t as HTMLInputElement).value = ''
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
              title="Выбрать папку с DICOM (рекомендуется)"
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
          ref={filesOnlyInputRef}
          className="upload-input"
          type="file"
          multiple
          accept=".dcm,.dicom,application/dicom"
          onChange={handleFileChange}
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
              <p className="upload-note">
                Нужна распакованная папка с файлами .dcm (не ZIP). В Chrome/Edge выберите именно папку с
                срезами. Очень большие исследования разбираются порциями; при падении вкладки закройте лишние
                программы и повторите.
              </p>
            </div>

            <div className="upload-actions">
              <div className="upload-import-block">
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
                <button
                  type="button"
                  className="upload-button upload-button-secondary"
                  onClick={() => filesOnlyInputRef.current?.click()}
                >
                  Или несколько файлов .dcm
                </button>
              </div>

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
                    <span>Карточка — открыть серию; меню ⋮ — убрать из списка (файлы на диске не удаляются)</span>
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
                    const menuOpen = seriesRowMenuUid === series.seriesInstanceUid
                    return (
                      <div
                        className={isActive ? 'series-row-card active' : 'series-row-card'}
                        key={`${series.studyInstanceUid}-${series.seriesInstanceUid}`}
                        role="listitem"
                      >
                        <button
                          className="series-row-body"
                          onClick={() => setActiveSeriesUid(series.seriesInstanceUid)}
                          type="button"
                          title={`${series.seriesDescription || 'Серия'} · ${series.modality} · ${series.files.length} срез.`}
                        >
                          <div className="series-row-main">
                            <div className="series-row-title-block">
                              <span className="series-row-desc">
                                {series.seriesDescription || 'Серия без описания'}
                              </span>
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
                        <div className="series-row-menu-root" data-series-menu-root="">
                          <button
                            type="button"
                            className="series-row-menu-trigger"
                            title="Действия со серией"
                            aria-label={`Меню: ${series.seriesDescription || 'серия'}`}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSeriesRowMenuUid((u) =>
                                u === series.seriesInstanceUid ? null : series.seriesInstanceUid,
                              )
                            }}
                          >
                            <svg
                              className="series-row-menu-icon"
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              aria-hidden={true}
                            >
                              <circle cx="8" cy="3" r="1.65" fill="currentColor" />
                              <circle cx="8" cy="8" r="1.65" fill="currentColor" />
                              <circle cx="8" cy="13" r="1.65" fill="currentColor" />
                            </svg>
                          </button>
                          {menuOpen ? (
                            <div className="series-row-dropdown" role="menu">
                              <button
                                type="button"
                                className="series-row-dropdown-item danger"
                                role="menuitem"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => removeStudySeries(series.seriesInstanceUid)}
                              >
                                Удалить из списка
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
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
              />
              {comparisonPaneOpen && comparisonSeries ? (
                <DicomViewport
                  activeSeries={comparisonSeries}
                  nativeSeries={activeSeries}
                  comparisonSync={comparisonSync ?? null}
                  comparisonSessionKey={comparisonSessionKey}
                  viewerLabel="Серия сравнения"
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

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
