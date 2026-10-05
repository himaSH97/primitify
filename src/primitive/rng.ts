export interface RandomSource {
  nextFloat(): number
  nextInt(maxExclusive: number): number
  normal(): number
}

export class SeededRandom implements RandomSource {
  private state: number

  constructor(seed = Date.now()) {
    this.state = seed >>> 0
  }

  nextFloat(): number {
    let value = (this.state += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError('Random integer limit must be a positive integer.')
    }
    return Math.floor(this.nextFloat() * maxExclusive)
  }

  normal(): number {
    const first = Math.max(this.nextFloat(), Number.EPSILON)
    const second = this.nextFloat()
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second)
  }
}