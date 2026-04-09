declare module 'nifti-reader-js' {
  interface NiftiHeader {
    dims: number[]
    datatypeCode: number
    littleEndian?: boolean
    scl_slope?: number
    scl_inter?: number
    qform_code?: number
    sform_code?: number
    /** 4×4: world_mm = affine[row] · [i, j, k, 1] (как в nifti-js / nibabel). */
    affine?: number[][]
    pixDims?: number[]
  }
  const nifti: {
    isCompressed(data: ArrayBuffer): boolean
    decompress(data: ArrayBuffer): ArrayBuffer
    isNIFTI(data: ArrayBuffer): boolean
    readHeader(data: ArrayBuffer): NiftiHeader | null
    readImage(header: NiftiHeader, data: ArrayBuffer): ArrayBuffer
  }
  export default nifti
}
