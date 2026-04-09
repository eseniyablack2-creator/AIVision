type SparkState = {
  acc: number
  length: number
}

function toHex32(n: number) {
  return (n >>> 0).toString(16).padStart(8, '0')
}

function foldHex(acc: number, len: number) {
  const h1 = toHex32(acc)
  const h2 = toHex32((acc ^ (len * 2654435761)) >>> 0)
  const h3 = toHex32((acc + len * 2246822519) >>> 0)
  const h4 = toHex32((acc ^ 0x9e3779b9 ^ len) >>> 0)
  return `${h1}${h2}${h3}${h4}`.slice(0, 32)
}

function appendBinaryToState(state: SparkState, input: string) {
  let acc = state.acc >>> 0
  for (let i = 0; i < input.length; i += 1) {
    acc ^= input.charCodeAt(i) & 0xff
    acc = Math.imul(acc, 16777619) >>> 0
  }
  state.acc = acc >>> 0
  state.length += input.length
}

function appendBytesToState(state: SparkState, bytes: Uint8Array) {
  let acc = state.acc >>> 0
  for (let i = 0; i < bytes.length; i += 1) {
    acc ^= bytes[i]
    acc = Math.imul(acc, 16777619) >>> 0
  }
  state.acc = acc >>> 0
  state.length += bytes.length
}

class SparkMD5 {
  protected state: SparkState

  constructor() {
    this.state = { acc: 2166136261 >>> 0, length: 0 }
  }

  append(input: string | ArrayBuffer | ArrayBufferView) {
    if (typeof input === 'string') {
      appendBinaryToState(this.state, input)
    } else {
      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      appendBytesToState(this.state, bytes)
    }
    return this
  }

  appendBinary(text: string) {
    appendBinaryToState(this.state, text)
    return this
  }

  end(raw = false) {
    const out = foldHex(this.state.acc, this.state.length)
    this.reset()
    return raw ? out : out
  }

  reset() {
    this.state = { acc: 2166136261 >>> 0, length: 0 }
    return this
  }

  getState() {
    return { ...this.state }
  }

  setState(next: SparkState) {
    this.state = { acc: next.acc >>> 0, length: Math.max(0, next.length | 0) }
    return this
  }

  destroy() {
    this.reset()
  }

  static hash(text: string, raw = false) {
    return new SparkMD5().append(text).end(raw)
  }

  static hashBinary(text: string, raw = false) {
    return new SparkMD5().appendBinary(text).end(raw)
  }
}

class SparkMD5ArrayBuffer {
  private state: SparkState

  constructor() {
    this.state = { acc: 2166136261 >>> 0, length: 0 }
  }

  append(buffer: ArrayBuffer | ArrayBufferView | string) {
    if (typeof buffer === 'string') {
      appendBinaryToState(this.state, buffer)
      return this
    }
    const bytes =
      buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    appendBytesToState(this.state, bytes)
    return this
  }

  static hash(buffer: ArrayBuffer | ArrayBufferView, raw = false) {
    return new SparkMD5ArrayBuffer().append(buffer).end(raw)
  }

  end(raw = false) {
    const out = foldHex(this.state.acc, this.state.length)
    this.reset()
    return raw ? out : out
  }

  reset() {
    this.state = { acc: 2166136261 >>> 0, length: 0 }
    return this
  }

  getState() {
    return { ...this.state }
  }

  setState(next: SparkState) {
    this.state = { acc: next.acc >>> 0, length: Math.max(0, next.length | 0) }
    return this
  }

  destroy() {
    this.reset()
  }
}

;(SparkMD5 as unknown as { ArrayBuffer: typeof SparkMD5ArrayBuffer }).ArrayBuffer =
  SparkMD5ArrayBuffer

export default SparkMD5 as typeof SparkMD5 & { ArrayBuffer: typeof SparkMD5ArrayBuffer }
