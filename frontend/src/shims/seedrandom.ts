type SeedFn = ((seed?: string | number, options?: unknown) => SeededRng) & {
  alea?: (seed?: string | number, options?: unknown) => SeededRng
  xor128?: (seed?: string | number, options?: unknown) => SeededRng
  xorshift7?: (seed?: string | number, options?: unknown) => SeededRng
  xorwow?: (seed?: string | number, options?: unknown) => SeededRng
  xor4096?: (seed?: string | number, options?: unknown) => SeededRng
  tychei?: (seed?: string | number, options?: unknown) => SeededRng
}

type SeededRng = (() => number) & {
  int32: () => number
  double: () => number
  quick: () => number
}

function hashSeed(input: string | number | undefined): number {
  const text = String(input ?? 'aivision-seed')
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function makeMulberry32(seed: number): SeededRng {
  let t = seed >>> 0

  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }

  const rng = (() => next()) as SeededRng
  rng.quick = () => next()
  rng.double = () => next()
  rng.int32 = () => ((next() * 0x100000000) | 0)
  return rng
}

const seedrandom = ((seed?: string | number) => makeMulberry32(hashSeed(seed))) as SeedFn

seedrandom.alea = seedrandom
seedrandom.xor128 = seedrandom
seedrandom.xorshift7 = seedrandom
seedrandom.xorwow = seedrandom
seedrandom.xor4096 = seedrandom
seedrandom.tychei = seedrandom

export default seedrandom
