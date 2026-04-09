declare module 'dcmjs' {
  const dcmjs: {
    data: {
      DicomMessage: {
        readFile: (buffer: ArrayBuffer) => { dict: unknown; meta?: unknown }
      }
      DicomMetaDictionary: {
        naturalizeDataset: (dict: unknown) => Record<string, unknown>
        namifyDataset: (meta: unknown) => Record<string, unknown>
        date: () => string
        time: () => string
        uid: () => string
        sopClassUIDsByName?: { SecondaryCaptureImage?: string }
      }
      datasetToDict: (dataset: unknown) => { write: (options?: { allowInvalidVRLength?: boolean }) => Uint8Array }
    }
  }
  export default dcmjs
}
