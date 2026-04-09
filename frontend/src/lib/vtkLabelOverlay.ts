import type { vtkVolumeProperty } from 'vtk.js/Sources/Rendering/Core/VolumeProperty'
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction'
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction'

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  }
  return [f(0), f(8), f(4)]
}

/**
 * Полупрозрачный цветной объём меток (multilabel как float scalar).
 */
export function configureLabelOverlayVolume(property: vtkVolumeProperty, opacity: number) {
  const op = Math.max(0, Math.min(0.82, opacity))
  const ofun = vtkPiecewiseFunction.newInstance()
  ofun.addPoint(-1e9, 0)
  ofun.addPoint(0.05, 0)
  ofun.addPoint(0.95, op)
  ofun.addPoint(1e9, op)

  const cfun = vtkColorTransferFunction.newInstance()
  cfun.addRGBPoint(-1e9, 0, 0, 0)
  cfun.addRGBPoint(0.05, 0, 0, 0)
  for (let lid = 1; lid <= 220; lid += 1) {
    const t = lid + 0.45
    const hue = (lid * 0.38196601125) % 1
    const [r, g, b] = hslToRgb(hue, 0.78, 0.5)
    cfun.addRGBPoint(t, r, g, b)
  }

  property.setRGBTransferFunction(0, cfun)
  property.setScalarOpacity(0, ofun)
  property.setInterpolationTypeToLinear()
  property.setShade(false)
  property.setUseGradientOpacity(0, false)
}
