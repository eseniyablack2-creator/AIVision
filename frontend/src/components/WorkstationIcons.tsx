/** Compact SVG icons for the medical workstation. Unified stroke style. */

type IconProps = { className?: string; title?: string }

const stroke = 1.7
const common = {
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: stroke,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** 2D mode — monitor with scan lines */
export function Icon2D({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="3" y="4" width="18" height="13" rx="2" />
      <path {...common} d="M8 20h8M12 17v3" />
    </svg>
  )
}

/** 3D CTA — cube */
export function IconCTA3D({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 2 21 7v10l-9 5-9-5V7l9-5z" />
      <path {...common} d="M12 12v10M3 7l9 5 9-5" />
    </svg>
  )
}

/** Airways — trachea branching */
export function IconAirways({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3v8" />
      <path {...common} d="M12 11c-2 2-4 4-5 7M12 11c2 2 4 4 5 7" />
      <path {...common} d="M10 7h4" />
    </svg>
  )
}

/** Single viewport */
export function IconLayout1({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

/** Grid 2×2 */
export function IconLayoutGrid({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="3" y="3" width="8" height="8" rx="1.5" />
      <rect {...common} x="13" y="3" width="8" height="8" rx="1.5" />
      <rect {...common} x="3" y="13" width="8" height="8" rx="1.5" />
      <rect {...common} x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  )
}

/** MPR layout — big left + 2 small right */
export function IconLayoutMPR({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="3" y="3" width="11" height="18" rx="1.5" />
      <rect {...common} x="16" y="3" width="5" height="8" rx="1" />
      <rect {...common} x="16" y="13" width="5" height="8" rx="1" />
    </svg>
  )
}

/** Reset / refresh */
export function IconReset({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M4 12a8 8 0 0 1 14-5.3" />
      <path {...common} d="M20 12a8 8 0 0 1-14 5.3" />
      <path {...common} d="M18 3v4h-4" />
      <path {...common} d="M6 21v-4h4" />
    </svg>
  )
}

/** Axial plane — horizontal ellipse (top-down slice) */
export function IconPlaneAxial({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <ellipse {...common} cx="12" cy="12" rx="8" ry="5" />
      <path {...common} d="M12 7v10" strokeDasharray="2 2" opacity="0.6" />
    </svg>
  )
}

/** Coronal plane — front-facing rectangle */
export function IconPlaneCoronal({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="5" y="5" width="14" height="14" rx="2" />
      <path {...common} d="M5 12h14" strokeDasharray="2 2" opacity="0.6" />
    </svg>
  )
}

/** Sagittal plane — side profile slice */
export function IconPlaneSagittal({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M8 4c5 0 9 3.5 9 8s-4 8-9 8" />
      <path {...common} d="M8 4v16" />
    </svg>
  )
}

/** Window/Level — contrast circle (half-filled sun) */
export function IconWL({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <circle {...common} cx="12" cy="12" r="7" />
      <path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Pan — hand */
export function IconPan({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3v16M4 11h16" />
      <path {...common} d="M9 6l3-3 3 3M9 16l3 3 3-3M7 8l-3 3 3 3M17 8l3 3-3 3" />
    </svg>
  )
}

/** Zoom — magnifying glass with + */
export function IconZoom({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <circle {...common} cx="10.5" cy="10.5" r="6" />
      <path {...common} d="M15 15l5 5" />
      <path {...common} d="M8.5 10.5h4M10.5 8.5v4" />
    </svg>
  )
}

/** Flip horizontal */
export function IconFlipH({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3v18" strokeDasharray="2 2.5" />
      <path {...common} d="M5 7h3v10H5zM19 7h-3v10h3z" />
    </svg>
  )
}

/** Flip vertical */
export function IconFlipV({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M3 12h18" strokeDasharray="2 2.5" />
      <path {...common} d="M7 5v3h10V5zM7 19v-3h10v3z" />
    </svg>
  )
}

/** Interpolation toggle — smooth vs pixel grid */
export function IconInterp2d({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="4" y="4" width="7" height="7" />
      <rect {...common} x="13" y="4" width="7" height="7" />
      <rect {...common} x="4" y="13" width="7" height="7" />
      <path {...common} d="M13 13h7v7h-7z" opacity="0.35" />
      <path {...common} d="M11 11l2 2" />
    </svg>
  )
}

/** ROI rectangle — dashed selection box */
export function IconHuRoi({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="5" y="5" width="14" height="14" rx="1.5" strokeDasharray="3 2" />
      <path {...common} d="M9 12h6M12 9v6" opacity="0.6" />
    </svg>
  )
}

/** ROI polygon — freeform shape with vertex dots */
export function IconHuRoiPoly({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 4l6 4v7l-4 5h-4l-4-5V8l6-4z" strokeDasharray="3 2" />
      <circle cx="12" cy="4" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="20" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Лассо: обводка области (затемнение снаружи на срезе) */
export function IconViewLasso({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path
        {...common}
        d="M6 8c2-3 5-4 8-2s4 5 3 8-4 6-8 5-5-4-4-8c0-2 1-3 1-3"
      />
    </svg>
  )
}

/** Ruler — diagonal line with end caps */
export function IconRuler({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M5 19L19 5" />
      <path {...common} d="M5 19l2.5-1M5 19l1-2.5" />
      <path {...common} d="M19 5l-2.5 1M19 5l-1 2.5" />
      <path {...common} d="M8.5 15.5l1.5-1.5M11 13l1.5-1.5M13.5 10.5l1.5-1.5" opacity="0.5" />
    </svg>
  )
}

/** Angle — protractor arc between two rays */
export function IconAngle({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M5 19h14" />
      <path {...common} d="M5 19L15 5" />
      <path {...common} d="M5 19c0-3 1.5-5.5 4-7" opacity="0.6" />
    </svg>
  )
}

export function IconChevronDoubleLeft({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M13 7l-5 5 5 5M19 7l-5 5 5 5" />
    </svg>
  )
}

export function IconChevronDoubleRight({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M11 7l5 5-5 5M5 7l5 5-5 5" />
    </svg>
  )
}

/** Expand — outward arrows */
export function IconExpand({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}

/** Collapse — inward arrows */
export function IconCollapse({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6" />
      <path {...common} d="M10 4v6H4M14 4v6h6M10 20v-6H4M14 20v-6h6" />
    </svg>
  )
}

/** Save — floppy disk */
export function IconSave({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path {...common} d="M7 3v5h8V3M7 14h10v7H7z" />
    </svg>
  )
}

/** Export — upload arrow */
export function IconExport({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3v12M8 7l4-4 4 4" />
      <path {...common} d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  )
}

/** Segmentation overlay — brain/mask */
export function IconSeg({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3c4.4 0 8 3.6 8 8v5a4 4 0 01-4 4H8a4 4 0 01-4-4v-5c0-4.4 3.6-8 8-8z" />
      <path {...common} d="M12 3v17M8 9c2 1 4 1 6 0" opacity="0.5" />
    </svg>
  )
}

/** Play/Pause (cine) */
export function IconPlayPause({ className, title, playing }: IconProps & { playing?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      {playing ? (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        </>
      ) : (
        <path d="M7 4v16l13-8L7 4z" fill="currentColor" stroke="none" />
      )}
    </svg>
  )
}

/** DICOM tags */
export function IconTags({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M4 6h8l8 8-6 6-8-8V6z" />
      <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Camera snapshot */
export function IconSnapshot({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M3 7h2l2-3h10l2 3h2v12H3V7z" />
      <circle {...common} cx="12" cy="13" r="3.5" />
    </svg>
  )
}

/** Secondary Capture export */
export function IconSecondaryCapture({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="5" y="3" width="14" height="18" rx="1.5" />
      <path {...common} d="M5 7h14" />
      <path {...common} d="M9 12h6M9 15h4" />
    </svg>
  )
}

/** Small inline: HU shift */
export function IconInlineHU({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M4 8v8M4 12h6M10 8v8" />
      <path {...common} d="M14 8v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V8" />
    </svg>
  )
}

/** Small inline: opacity / brightness */
export function IconInlineOpacity({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <circle {...common} cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" opacity="0.35" stroke="none" />
    </svg>
  )
}

/** Small inline: camera reset */
export function IconInlineCamera({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M3 7h2l2-3h10l2 3h2v12H3V7z" />
      <circle {...common} cx="12" cy="13" r="3" />
    </svg>
  )
}

/** Small inline: clip / scissors */
export function IconInlineClip({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="4" y="3" width="16" height="18" rx="2" />
      <path {...common} d="M4 9h16M4 15h16" />
    </svg>
  )
}

/** Small inline: table */
export function IconInlineTable({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <rect {...common} x="3" y="14" width="18" height="4" rx="1" />
      <path {...common} d="M6 14V8M18 14V8" />
    </svg>
  )
}

/** Small inline: bone */
export function IconInlineBone({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M8 4a3 3 0 0 1 3 3l-1 5.5a2 2 0 0 0 4 0L13 7a3 3 0 0 1 6 0 3 3 0 0 1-3 3l-1.5 2.5 1.5 2.5a3 3 0 0 1 3 3 3 3 0 0 1-6 0l1-3.5a2 2 0 0 0-4 0l1 3.5a3 3 0 0 1-6 0 3 3 0 0 1 3-3l1.5-2.5L8 10a3 3 0 0 1-3-3 3 3 0 0 1 3-3z" />
    </svg>
  )
}

/** Small inline: vessel / artery */
export function IconInlineVessel({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path {...common} d="M12 3c0 3-4 5-4 9a4 4 0 0 0 8 0c0-4-4-6-4-9z" />
      <path {...common} d="M10 20c-1 1-2 1-3 1M14 20c1 1 2 1 3 1" />
    </svg>
  )
}
