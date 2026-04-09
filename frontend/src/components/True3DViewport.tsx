import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { DicomSeries } from '../lib/dicom'
import { ViewCubeSvg, type ViewCubeFace } from './ViewCubeSvg'

export type True3DPresetId = 'aorta' | 'vessels_clean' | 'vessels_contrast' | 'bones' | 'lungs_air'
export type True3DRenderMode = 'dvr' | 'mip' | 'avg'

type PresetDef = {
  id: True3DPresetId
  backendPreset: 'aorta' | 'vessels_general' | 'bones' | 'lungs'
  label: string
  color: string
}

const PRESETS: readonly PresetDef[] = [
  { id: 'aorta', backendPreset: 'aorta', label: 'Аорта CTA', color: '#ff8c42' },
  { id: 'vessels_clean', backendPreset: 'vessels_general', label: 'Сосуды (чисто)', color: '#ff8f8f' },
  { id: 'vessels_contrast', backendPreset: 'aorta', label: 'Сосуды + Ca', color: '#ffb06c' },
  { id: 'lungs_air', backendPreset: 'lungs', label: 'Легкие Air', color: '#86caee' },
  { id: 'bones', backendPreset: 'bones', label: 'Кости', color: '#efe6c8' },
]

type Props = {
  activeSeries: DicomSeries
  workspaceMode: 'cta3d' | 'airway3d'
  showOverlayControls?: boolean
  presetId?: True3DPresetId
  onPresetIdChange?: (value: True3DPresetId) => void
  renderMode?: True3DRenderMode
  onRenderModeChange?: (value: True3DRenderMode) => void
  brightness?: number
  onBrightnessChange?: (value: number) => void
  contrast?: number
  onContrastChange?: (value: number) => void
  opacity?: number
  onOpacityChange?: (value: number) => void
  useAllSlices?: boolean
  cubeFace?: ViewCubeFace
  onCubeFaceChange?: (face: ViewCubeFace) => void
  rebuildToken?: number
}

const MAX_PREVIEW_SLICES = 420
const REQUEST_TIMEOUT_MS = 120_000

function getApiBase(): string {
  const raw = import.meta.env.VITE_PATHOLOGY_API_URL
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim().replace(/\/$/, '')
  return 'http://127.0.0.1:8000'
}

function pickPreviewStride(total: number): number {
  if (total > 2200) return 8
  if (total > 1600) return 6
  if (total > 1000) return 4
  if (total > 700) return 3
  return 1
}

export function True3DViewport({
  activeSeries,
  workspaceMode,
  showOverlayControls = true,
  presetId: controlledPresetId,
  onPresetIdChange,
  renderMode: controlledRenderMode,
  onRenderModeChange,
  brightness: controlledBrightness,
  onBrightnessChange,
  contrast: controlledContrast,
  onContrastChange,
  opacity: controlledOpacity,
  onOpacityChange,
  useAllSlices = true,
  cubeFace,
  onCubeFaceChange,
  rebuildToken = 0,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)
  const frameRef = useRef<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastBuildAt, setLastBuildAt] = useState(0)
  const [sentSlices, setSentSlices] = useState(0)
  const [internalPresetId, setInternalPresetId] = useState<True3DPresetId>(
    workspaceMode === 'airway3d' ? 'lungs_air' : 'aorta',
  )
  const [internalRenderMode, setInternalRenderMode] = useState<True3DRenderMode>('dvr')
  const [internalBrightness, setInternalBrightness] = useState(1)
  const [internalContrast, setInternalContrast] = useState(1)
  const [internalOpacity, setInternalOpacity] = useState(1)
  const [internalFace, setInternalFace] = useState<ViewCubeFace>('anterior')

  const effectivePresetId = controlledPresetId ?? internalPresetId
  const effectiveRenderMode = controlledRenderMode ?? internalRenderMode
  const effectiveBrightness = controlledBrightness ?? internalBrightness
  const effectiveContrast = controlledContrast ?? internalContrast
  const effectiveOpacity = controlledOpacity ?? internalOpacity
  const effectiveFace = cubeFace ?? internalFace

  const setPresetId = (value: True3DPresetId) => {
    if (onPresetIdChange) onPresetIdChange(value)
    else setInternalPresetId(value)
  }
  const setRenderMode = (value: True3DRenderMode) => {
    if (onRenderModeChange) onRenderModeChange(value)
    else setInternalRenderMode(value)
  }
  const setBrightness = (value: number) => {
    if (onBrightnessChange) onBrightnessChange(value)
    else setInternalBrightness(value)
  }
  const setContrast = (value: number) => {
    if (onContrastChange) onContrastChange(value)
    else setInternalContrast(value)
  }
  const setOpacity = (value: number) => {
    if (onOpacityChange) onOpacityChange(value)
    else setInternalOpacity(value)
  }
  const setFace = (face: ViewCubeFace) => {
    if (onCubeFaceChange) onCubeFaceChange(face)
    else setInternalFace(face)
  }

  const activePreset = useMemo(
    () => PRESETS.find((p) => p.id === effectivePresetId) ?? PRESETS[0],
    [effectivePresetId],
  )

  useEffect(() => {
    setPresetId(workspaceMode === 'airway3d' ? 'lungs_air' : 'aorta')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode, activeSeries.seriesInstanceUid])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#050913')
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000)
    camera.position.set(0, -420, 180)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.zoomSpeed = 3.4
    controls.panSpeed = 1.2
    controls.rotateSpeed = 1.15
    controlsRef.current = controls

    scene.add(new THREE.AmbientLight('#d6d9ff', 0.72))
    const key = new THREE.DirectionalLight('#ffffff', 1.2)
    key.position.set(300, -220, 420)
    scene.add(key)
    const fill = new THREE.DirectionalLight('#88a3ff', 0.45)
    fill.position.set(-280, 240, 140)
    scene.add(fill)

    const resize = () => {
      if (!rendererRef.current || !cameraRef.current || !host) return
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      rendererRef.current.setSize(width, height, false)
      cameraRef.current.aspect = width / height
      cameraRef.current.updateProjectionMatrix()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      scene.clear()
      controlsRef.current = null
      rendererRef.current = null
      cameraRef.current = null
      sceneRef.current = null
      modelRef.current = null
    }
  }, [])

  const applyModelMaterial = (
    root: THREE.Object3D,
    color: string,
    mode: True3DRenderMode,
    bright: number,
    ctr: number,
    alpha: number,
  ) => {
    const rgb = new THREE.Color(color).multiplyScalar(bright)
    const finalOpacity = Math.max(0.08, Math.min(1, alpha))

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      if (!(mesh.material instanceof THREE.Material) || Array.isArray(mesh.material)) {
        mesh.material = new THREE.MeshStandardMaterial({ color: rgb })
      }
      const m = mesh.material as THREE.MeshStandardMaterial
      m.color = rgb
      m.transparent = finalOpacity < 0.99
      m.opacity = finalOpacity
      m.depthWrite = !m.transparent
      m.side = THREE.DoubleSide
      if (mode === 'mip') {
        m.emissive = rgb.clone().multiplyScalar(0.65 * ctr)
        m.roughness = 0.78
        m.metalness = 0.02
      } else if (mode === 'avg') {
        m.emissive = new THREE.Color('#000000')
        m.roughness = 0.9
        m.metalness = 0
      } else {
        m.emissive = new THREE.Color('#000000')
        m.roughness = Math.max(0.1, 0.62 / Math.max(ctr, 0.6))
        m.metalness = 0.08
      }
      m.needsUpdate = true
    })
  }

  const centerAndFrameModel = (root: THREE.Object3D) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    root.position.sub(center)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    camera.position.set(maxDim * 0.2, -maxDim * 1.25, maxDim * 0.55)
    camera.near = Math.max(0.1, maxDim / 1000)
    camera.far = maxDim * 20
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
    controls.update()
  }

  const setCameraByFace = (face: ViewCubeFace) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const model = modelRef.current
    if (!camera || !controls || !model) return
    const box = new THREE.Box3().setFromObject(model)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const d = Math.max(size.x, size.y, size.z, 1) * 1.4
    let pos = new THREE.Vector3(center.x, center.y - d, center.z + d * 0.35)
    let up = new THREE.Vector3(0, 0, 1)
    if (face === 'anterior') pos = new THREE.Vector3(center.x, center.y - d, center.z)
    if (face === 'posterior') pos = new THREE.Vector3(center.x, center.y + d, center.z)
    if (face === 'left') pos = new THREE.Vector3(center.x + d, center.y, center.z)
    if (face === 'right') pos = new THREE.Vector3(center.x - d, center.y, center.z)
    if (face === 'superior') {
      pos = new THREE.Vector3(center.x, center.y, center.z + d)
      up = new THREE.Vector3(0, -1, 0)
    }
    if (face === 'inferior') {
      pos = new THREE.Vector3(center.x, center.y, center.z - d)
      up = new THREE.Vector3(0, 1, 0)
    }
    camera.position.copy(pos)
    camera.up.copy(up)
    controls.target.copy(center)
    controls.update()
    setFace(face)
  }

  const buildModel = async () => {
    const scene = sceneRef.current
    if (!scene) return
    setLoading(true)
    setError('')
    try {
      const form = new FormData()
      let selected = activeSeries.files
      if (!useAllSlices) {
        const stride = pickPreviewStride(activeSeries.files.length)
        selected = activeSeries.files.filter((_, i) => i % stride === 0)
        if (selected.length > MAX_PREVIEW_SLICES) {
          const shrinkStride = Math.ceil(selected.length / MAX_PREVIEW_SLICES)
          selected = selected.filter((_, i) => i % shrinkStride === 0)
        }
      }
      setSentSlices(selected.length)
      for (const item of selected) form.append('contrast_files', item.file, item.file.name)
      form.append('preset_id', activePreset.backendPreset)

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const res = await fetch(`${getApiBase()}/v1/visualize`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      window.clearTimeout(timeoutId)
      if (!res.ok) {
        if (res.status === 404) throw new Error('3D endpoint not found: проверьте backend /v1/visualize')
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      try {
        const loader = new GLTFLoader()
        const gltf = await loader.loadAsync(url)
        if (modelRef.current) scene.remove(modelRef.current)
        const model = gltf.scene
        applyModelMaterial(
          model,
          activePreset.color,
          effectiveRenderMode,
          effectiveBrightness,
          effectiveContrast,
          effectiveOpacity,
        )
        scene.add(model)
        modelRef.current = model
        centerAndFrameModel(model)
      } finally {
        URL.revokeObjectURL(url)
      }
      setLastBuildAt(Date.now())
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        setError('3D строится слишком долго. Отключите режим "Все срезы" для быстрого превью.')
      } else {
        setError(caught instanceof Error ? caught.message : 'Ошибка построения 3D')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void buildModel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeries.seriesInstanceUid, effectivePresetId, useAllSlices, rebuildToken])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    applyModelMaterial(
      model,
      activePreset.color,
      effectiveRenderMode,
      effectiveBrightness,
      effectiveContrast,
      effectiveOpacity,
    )
  }, [activePreset.color, effectiveRenderMode, effectiveBrightness, effectiveContrast, effectiveOpacity])

  useEffect(() => {
    setCameraByFace(effectiveFace)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFace])

  return (
    <div className="true3d-shell">
      {showOverlayControls ? (
        <>
          <div className="true3d-toolbar">
            <div className="true3d-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={preset.id === effectivePresetId ? 'true3d-btn active' : 'true3d-btn'}
                  onClick={() => setPresetId(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button type="button" className="true3d-btn" onClick={() => void buildModel()} disabled={loading}>
              {loading ? 'Строим 3D…' : 'Обновить 3D'}
            </button>
          </div>
          <div className="true3d-subtoolbar">
            <div className="true3d-mode-group">
              <button type="button" className={effectiveRenderMode === 'dvr' ? 'true3d-btn active' : 'true3d-btn'} onClick={() => setRenderMode('dvr')}>DVR</button>
              <button type="button" className={effectiveRenderMode === 'mip' ? 'true3d-btn active' : 'true3d-btn'} onClick={() => setRenderMode('mip')}>MIP</button>
              <button type="button" className={effectiveRenderMode === 'avg' ? 'true3d-btn active' : 'true3d-btn'} onClick={() => setRenderMode('avg')}>AVG</button>
            </div>
            <label className="true3d-slider">Контраст
              <input type="range" min={0.7} max={2.2} step={0.05} value={effectiveContrast} onChange={(e) => setContrast(Number(e.target.value))} />
            </label>
            <label className="true3d-slider">Яркость
              <input type="range" min={0.6} max={1.8} step={0.05} value={effectiveBrightness} onChange={(e) => setBrightness(Number(e.target.value))} />
            </label>
            <label className="true3d-slider">Прозрачность
              <input type="range" min={0.12} max={1} step={0.02} value={effectiveOpacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
          </div>
        </>
      ) : null}

      <div className="true3d-canvas-wrap" ref={hostRef} />

      {showOverlayControls ? (
        <div className="true3d-viewcube">
          <ViewCubeSvg activeView={effectiveFace} onFaceSelect={(face) => setCameraByFace(face)} />
        </div>
      ) : null}

      <div className="true3d-footer">
        <span>{loading ? 'Построение 3D…' : `Режим: ${activePreset.label}`}</span>
        <span>
          {sentSlices > 0 ? `Срезов отправлено: ${sentSlices}/${activeSeries.files.length}` : ''}
          {lastBuildAt > 0 ? ` · ${new Date(lastBuildAt).toLocaleTimeString()}` : ''}
        </span>
      </div>

      {error ? <div className="true3d-error">{error}</div> : null}
    </div>
  )
}
