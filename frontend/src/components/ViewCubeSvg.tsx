import { type MouseEvent } from 'react'

export type ViewCubeFace = 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior'

const FACE_LETTER: Record<ViewCubeFace, string> = {
  anterior: 'A',
  posterior: 'P',
  left: 'L',
  right: 'R',
  superior: 'S',
  inferior: 'I',
}

type ViewCubeSvgProps = {
  activeView: ViewCubeFace
  onFaceSelect: (face: ViewCubeFace, e: MouseEvent) => void
}

/**
 * Плоская схема ориентации как в типичных DICOM-станциях: центр — текущий ортогональный вид,
 * вокруг — S/I и радиологические R/L (правый больной слева на экране), снизу — быстрый A/P.
 */
export function ViewCubeSvg({ activeView, onFaceSelect }: ViewCubeSvgProps) {
  const center = FACE_LETTER[activeView]

  const btn = (face: ViewCubeFace, letter: string, className: string) => (
    <button
      type="button"
      className={className + (activeView === face ? ' vo-btn-active' : '')}
      aria-pressed={activeView === face}
      onClick={(e) => onFaceSelect(face, e)}
    >
      {letter}
    </button>
  )

  return (
    <div className="view-orient-widget" role="group" aria-label="Ориентация 3D">
      <div className="view-orient-row">
        <span className="vo-spacer" aria-hidden />
        {btn('superior', 'S', 'vo-btn vo-btn-edge')}
        <span className="vo-spacer" aria-hidden />
      </div>
      <div className="view-orient-row vo-row-mid">
        {btn('right', 'R', 'vo-btn vo-btn-edge')}
        <div className="vo-center" aria-current="true">
          {center}
        </div>
        {btn('left', 'L', 'vo-btn vo-btn-edge')}
      </div>
      <div className="view-orient-row">
        <span className="vo-spacer" aria-hidden />
        {btn('inferior', 'I', 'vo-btn vo-btn-edge')}
        <span className="vo-spacer" aria-hidden />
      </div>
      <div className="view-orient-row vo-row-ap">
        {btn('anterior', 'A', 'vo-btn vo-btn-ap')}
        {btn('posterior', 'P', 'vo-btn vo-btn-ap')}
      </div>
    </div>
  )
}
