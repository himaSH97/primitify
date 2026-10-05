import { drawLines } from './blend'
import { type RGBAColor, assertImageBuffer, copyBuffer, createBuffer, fillSolid } from './buffers'
import { computeColor } from './color'
import { differenceFull, differencePartial } from './score'
import { SeededRandom, type RandomSource } from './rng'
import type { Shape } from './shapes/shape'
import { AlgorithmWorker } from './worker'
import { hillClimb, type YieldControl } from './optimize'

export interface SearchOptions {
  randomTrials: number
  maxAge: number
  restarts: number
  repeats?: number
  repeatAge?: number
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  randomTrials: 1000,
  maxAge: 100,
  restarts: 16,
  repeats: 0,
  repeatAge: 100,
}

export interface StepResult {
  score: number
  shapesAdded: number
  evaluations: number
}

export interface SvgParts {
  width: number
  height: number
  scale: number
  header: string
  footer: string
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}

export class Model {
  readonly target: Uint8ClampedArray
  readonly current: Uint8ClampedArray
  readonly shapes: Shape[] = []
  readonly colors: RGBAColor[] = []
  readonly scores: number[] = []
  readonly worker: AlgorithmWorker
  score: number

  constructor(
    target: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
    readonly background: RGBAColor,
    random: RandomSource = new SeededRandom(),
  ) {
    assertImageBuffer(target, width, height)
    this.target = copyBuffer(target)
    this.current = createBuffer(width, height)
    fillSolid(this.current, background)
    this.score = differenceFull(this.target, this.current, width, height)
    this.worker = new AlgorithmWorker(this.target, width, height, this.current, this.score, random)
  }

  add(shape: Shape, alpha: number): void {
    const before = copyBuffer(this.current)
    const lines = shape.rasterize()
    const color = computeColor(this.target, this.current, this.width, this.height, lines, alpha)
    drawLines(this.current, this.width, this.height, color, lines)
    this.score = differencePartial(
      this.target,
      before,
      this.current,
      this.width,
      this.height,
      this.score,
      lines,
    )
    this.shapes.push(shape.copy())
    this.colors.push(color)
    this.scores.push(this.score)
  }

  svgParts(outputSize = 1024): SvgParts {
    if (!Number.isSafeInteger(outputSize) || outputSize < 1) {
      throw new RangeError('SVG output size must be a positive integer.')
    }

    const aspect = this.width / this.height
    const width = aspect >= 1 ? outputSize : Math.trunc(outputSize * aspect)
    const artworkHeight = aspect >= 1 ? Math.trunc(outputSize / aspect) : outputSize
    const height = artworkHeight
    const scale = aspect >= 1 ? outputSize / this.width : outputSize / this.height
    const signatureFontSize = Math.max(1, Math.round(outputSize / 85))
    const background = `#${hexByte(this.background.r)}${hexByte(this.background.g)}${hexByte(this.background.b)}`

    return {
      width,
      height,
      scale,
      header: [
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}">`,
        `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}" />`,
        `<g transform="scale(${scale.toFixed(6)}) translate(0.5 0.5)">`,
      ].join('\n'),
      footer: [
        '</g>',
        `<text x="${width - 12}" y="${artworkHeight - 12}" fill="#fff" font-family="sans-serif" font-size="${signatureFontSize}" font-weight="700" text-anchor="end">Made with Primitify <tspan fill="#d86249">♥</tspan></text>`,
        '</svg>',
      ].join('\n'),
    }
  }

  svgFragment(index: number): string {
    const shape = this.shapes[index]
    const color = this.colors[index]
    if (!shape || !color) throw new RangeError('Shape index is outside the model.')

    const attributes = `fill="#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}" fill-opacity="${(color.a / 255).toFixed(6)}"`
    return shape.toSVG(attributes)
  }

  toSVG(outputSize = 1024): string {
    const parts = this.svgParts(outputSize)
    return [
      parts.header,
      ...this.shapes.map((_, index) => this.svgFragment(index)),
      parts.footer,
    ].join('\n')
  }

  async step(
    alpha: number,
    options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
    yieldControl?: YieldControl,
  ): Promise<StepResult> {
    const { randomTrials, maxAge, restarts, repeats = 0, repeatAge = 100 } = options
    if (!Number.isSafeInteger(repeats) || repeats < 0) {
      throw new RangeError('Repeat count must be a nonnegative integer.')
    }

    this.worker.init(this.current, this.score)
    let state = await this.worker.bestHillClimbState(alpha, randomTrials, maxAge, restarts, yieldControl)
    this.add(state.shape, state.alpha)
    let shapesAdded = 1
    let evaluations = this.worker.counter

    for (let repeat = 0; repeat < repeats; repeat += 1) {
      this.worker.init(this.current, this.score)
      const previousEnergy = state.energy()
      const improved = await hillClimb(state, repeatAge, yieldControl)
      const energy = improved.energy()
      evaluations += this.worker.counter
      if (energy === previousEnergy) break
      this.add(improved.shape, improved.alpha)
      state = improved
      shapesAdded += 1
    }

    return { score: this.score, shapesAdded, evaluations }
  }
}