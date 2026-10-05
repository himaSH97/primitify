import { copyLines, drawLines } from './blend'
import { computeColor } from './color'
import { copyBuffer } from './buffers'
import { hillClimb, type YieldControl } from './optimize'
import { SeededRandom, type RandomSource } from './rng'
import type { Scanline } from './scanline'
import { differencePartial } from './score'
import type { Shape } from './shapes/shape'
import { Triangle } from './shapes/triangle'
import { State } from './state'

export class AlgorithmWorker {
  readonly scratch: Uint8ClampedArray
  readonly random: RandomSource
  counter = 0
  score: number

  constructor(
    readonly target: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
    current: Uint8ClampedArray,
    score: number,
    random: RandomSource = new SeededRandom(),
    private readonly yieldControl: YieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
  ) {
    this.scratch = copyBuffer(current)
    this.current = current
    this.random = random
    this.score = score
  }

  init(current: Uint8ClampedArray, score: number): void {
    this.current = current
    this.score = score
    this.counter = 0
  }

  private current: Uint8ClampedArray

  energy(shape: Shape, alpha: number): number {
    this.counter += 1
    const lines: Scanline[] = shape.rasterize()
    const color = computeColor(this.target, this.current, this.width, this.height, lines, alpha)
    copyLines(this.scratch, this.current, this.width, this.height, lines)
    drawLines(this.scratch, this.width, this.height, color, lines)
    return differencePartial(
      this.target,
      this.current,
      this.scratch,
      this.width,
      this.height,
      this.score,
      lines,
    )
  }

  randomState(alpha: number): State {
    return new State(this, Triangle.random(this.width, this.height, this.random), alpha)
  }

  async bestRandomState(
    alpha: number,
    trials: number,
    yieldControl: YieldControl = this.yieldControl,
  ): Promise<State> {
    if (!Number.isSafeInteger(trials) || trials < 1) {
      throw new RangeError('Random trial count must be a positive integer.')
    }

    let bestState = this.randomState(alpha)
    let bestEnergy = bestState.energy()
    for (let trial = 1; trial < trials; trial += 1) {
      const candidate = this.randomState(alpha)
      const energy = candidate.energy()
      if (energy < bestEnergy) {
        bestState = candidate
        bestEnergy = energy
      }
      if ((trial + 1) % 8 === 0) await yieldControl()
    }
    return bestState
  }

  async bestHillClimbState(
    alpha: number,
    trials: number,
    maxAge: number,
    restarts: number,
    yieldControl: YieldControl = this.yieldControl,
  ): Promise<State> {
    if (!Number.isSafeInteger(restarts) || restarts < 1) {
      throw new RangeError('Hill-climb restart count must be a positive integer.')
    }

    let bestState: State | null = null
    let bestEnergy = Number.POSITIVE_INFINITY
    for (let restart = 0; restart < restarts; restart += 1) {
      const candidate = await this.bestRandomState(alpha, trials, yieldControl)
      const improved = await hillClimb(candidate, maxAge, yieldControl)
      const energy = improved.energy()
      if (energy < bestEnergy) {
        bestState = improved
        bestEnergy = energy
      }
    }

    if (!bestState) throw new Error('No candidate triangle was generated.')
    return bestState
  }
}