const getGlobalObject = () => {
  if (typeof globalThis !== 'undefined') return globalThis
  if (typeof window !== 'undefined') return window
  if (typeof self !== 'undefined') return self
  return Function('return this')()
}

const globalObject = getGlobalObject()

export const implementation = globalObject
export const getPolyfill = () => globalObject
export const shim = () => globalObject
export default () => globalObject
