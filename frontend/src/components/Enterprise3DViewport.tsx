import { Environment, OrbitControls, PerspectiveCamera, useGLTF } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { DicomSeries } from '../lib/dicom'
import { getSegmentationApiBase } from '../lib/inferenceApiBase'

export type Backend3DPresetId = 'aorta' | 'vessels_general' | 'bones' | 'lungs'
export type VolumeNavigationMode = 'rotate' | 'pan'

type Props = {
  activeSeries: DicomSeries
  nativeSeries?: DicomSeries | null
  presetId: Backend3DPresetId
  navigationMode?: VolumeNavigationMode
  useAllSlices?: boolean
  rebuildToken?: number
}

const MAX_PREVIEW_SLICES = 420
const REQUEST_TIMEOUT_MS = 120_000

function getApiBase(): string {
  return getSegmentationApiBase()
}

function pickPreviewStride(total: number): number {
  if (total > 2200) return 8
  if (total > 1600) return 6
  if (total > 1000) return 4
  if (total > 700) return 3
  return 1
}

function materialForPreset(presetId: Backend3DPresetId): THREE.MeshPhysicalMaterial {
  if (presetId === 'bones') {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#f4f2ea'),
      roughness: 0.92,
      metalness: 0,
      transmission: 0,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  }
  if (presetId === 'lungs') {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#f1b2b1'),
      roughness: 0.98,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  }
  // vessels / aorta
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#d97055'),
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0,
    reflectivity: 0.02,
    side: THREE.DoubleSide,
  })
}

function applyMaterial(root: THREE.Object3D, presetId: Backend3DPresetId) {
  const mat = materialForPreset(presetId)
  root.traverse((obj) => {
    const mesh = obj as unknown as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = mat
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}

function fitCameraToObject(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void } | null,
) {
  const box = new THREE.Box3().setFromObject(obj)
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const fov = (camera.fov * Math.PI) / 180
  const dist = (maxDim * 0.75) / Math.tan(fov / 2)
  const dir = new THREE.Vector3(0, -1, 0) // look from anterior-ish by default
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist * 1.25)).add(new THREE.Vector3(0, 0, dist * 0.15)))
  camera.near = Math.max(0.1, dist / 100)
  camera.far = dist * 20
  camera.updateProjectionMatrix()
  camera.lookAt(center)
  if (controls) {
    controls.target.copy(center)
    controls.update()
  }
}

function GlbModel({
  url,
  presetId,
  controlsRef,
}: {
  url: string
  presetId: Backend3DPresetId
  controlsRef: React.MutableRefObject<{
    target: THREE.Vector3
    update: () => void
  } | null>
}) {
  const { scene } = useGLTF(url)
  const { camera } = useThree()
  useEffect(() => {
    applyMaterial(scene, presetId)
    fitCameraToObject(
      scene,
      camera as THREE.PerspectiveCamera,
      controlsRef.current,
    )
  }, [scene, presetId])
  return <primitive object={scene} />
}

export function Enterprise3DViewport({
  activeSeries,
  nativeSeries = null,
  presetId,
  navigationMode = 'rotate',
  useAllSlices = true,
  rebuildToken = 0,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sentSlices, setSentSlices] = useState(0)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const modelUrlRef = useRef<string | null>(null)
  const controlsRef = useRef<{
    target: THREE.Vector3
    update: () => void
  } | null>(null)

  const enableRotate = navigationMode === 'rotate'
  const enablePan = navigationMode === 'pan'

  useEffect(() => {
    return () => {
      if (modelUrlRef.current) {
        URL.revokeObjectURL(modelUrlRef.current)
        modelUrlRef.current = null
      }
    }
  }, [])

  const buildModel = async () => {
    setLoading(true)
    setError('')
    try {
      if ((presetId === 'aorta' || presetId === 'vessels_general') && !nativeSeries) {
        throw new Error(
          'Для Aorta/Vessels нужна 2-я серия (Native / non-contrast). Включите 2 колонки и выберите нативную серию во 2-й колонке.',
        )
      }
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

      if (nativeSeries && (presetId === 'aorta' || presetId === 'vessels_general')) {
        // Native is required for strict vessels presets (bone subtraction).
        let nativeSelected = nativeSeries.files
        if (!useAllSlices) {
          const stride = pickPreviewStride(nativeSeries.files.length)
          nativeSelected = nativeSeries.files.filter((_, i) => i % stride === 0)
          if (nativeSelected.length > MAX_PREVIEW_SLICES) {
            const shrinkStride = Math.ceil(nativeSelected.length / MAX_PREVIEW_SLICES)
            nativeSelected = nativeSelected.filter((_, i) => i % shrinkStride === 0)
          }
        }
        for (const item of nativeSelected) form.append('native_files', item.file, item.file.name)
      }
      form.append('preset_id', presetId)

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
        const text = await res.text().catch(() => '')
        if (res.status === 400 && text.includes('requires native_files')) {
          throw new Error(
            'Для сосудистых режимов нужна 2-я серия (Native / non-contrast). Откройте сравнение и загрузите нативную серию во 2-й колонке.',
          )
        }
        throw new Error(text || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current)
      modelUrlRef.current = url
      setModelUrl(url)
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
  }, [activeSeries.seriesInstanceUid, presetId, useAllSlices, rebuildToken])

  return (
    <div className="true3d-shell">
      <Canvas
        shadows
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
        }}
      >
        <PerspectiveCamera makeDefault position={[0, -260, 120]} fov={40} />
        <color attach="background" args={['#05060a']} />

        <ambientLight intensity={0.42} color="#ffffff" />
        <directionalLight position={[140, -90, 190]} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[-160, 120, 120]} intensity={0.25} color="#b8ccff" />
        <directionalLight position={[0, 210, 60]} intensity={0.18} color="#ffe0d0" />
        <Environment preset="studio" blur={0.85} />

        {modelUrl ? <GlbModel key={modelUrl} url={modelUrl} presetId={presetId} controlsRef={controlsRef} /> : null}

        <OrbitControls
          ref={controlsRef as unknown as React.RefObject<never>}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          zoomSpeed={0.8}
          panSpeed={0.85}
          screenSpacePanning
          enableRotate={enableRotate}
          enablePan={enablePan}
          enableZoom
          mouseButtons={
            enablePan
              ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
              : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
          }
        />
      </Canvas>

      {loading ? <div className="true3d-overlay">Построение 3D… ({sentSlices} файлов)</div> : null}
      {error ? <div className="true3d-overlay error">{error}</div> : null}
    </div>
  )
}

