/**
 * DICOM Pixel Data may start at an odd byte offset; TypedArray views require alignment.
 */
export function readPixels16(
  arrayBuffer: ArrayBuffer,
  byteOffset: number,
  pixelCount: number,
  pixelRepresentation: number,
): Int16Array | Uint16Array {
  const byteLength = pixelCount * 2
  const end = byteOffset + byteLength
  if (end > arrayBuffer.byteLength) {
    throw new Error('Pixel Data выходит за пределы буфера.')
  }

  if (byteOffset % 2 === 0) {
    return pixelRepresentation === 1
      ? new Int16Array(arrayBuffer, byteOffset, pixelCount)
      : new Uint16Array(arrayBuffer, byteOffset, pixelCount)
  }

  const copy = new ArrayBuffer(byteLength)
  new Uint8Array(copy).set(new Uint8Array(arrayBuffer, byteOffset, byteLength))
  return pixelRepresentation === 1
    ? new Int16Array(copy)
    : new Uint16Array(copy)
}

export function readPixels8(
  arrayBuffer: ArrayBuffer,
  byteOffset: number,
  pixelCount: number,
): Uint8Array {
  const end = byteOffset + pixelCount
  if (end > arrayBuffer.byteLength) {
    throw new Error('Pixel Data выходит за пределы буфера.')
  }
  return new Uint8Array(arrayBuffer, byteOffset, pixelCount)
}
