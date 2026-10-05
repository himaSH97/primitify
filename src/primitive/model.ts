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
    const logoScale = width / 1024 * 0.5304
    const logoMargin = width / 1024 * 16
    const logoX = width - 312 * logoScale - logoMargin
    const logoY = height - 64 * logoScale - logoMargin
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
        '<defs>',
        '<clipPath id="footer-p-shape">',
        '<path clip-rule="evenodd" d="M13 10h21c12 0 19 7 19 17s-7 17-19 17H26v10H13V10zm13 12v10h8c4 0 6-2 6-5s-2-5-6-5h-8z" />',
        '</clipPath>',
        '</defs>',
        `<g transform="translate(${logoX.toFixed(3)} ${logoY.toFixed(3)}) scale(${logoScale.toFixed(6)})">`,
        '<text x="12" y="53" fill="#4b5a45" font-family="DM Sans, sans-serif" font-size="18" font-weight="600">Made with</text>',
        '<g transform="translate(104 0)">',
        '<path fill="#4b5a45" fill-rule="evenodd" d="M13 10h21c12 0 19 7 19 17s-7 17-19 17H26v10H13V10zm13 12v10h8c4 0 6-2 6-5s-2-5-6-5h-8z" />',
        '<g clip-path="url(#footer-p-shape)">',
        '<path d="M8 8 30 10 17 26z" fill="#718066" />',
        '<path d="M30 10 44 8 37 18z" fill="#65745a" />',
        '<path d="M30 10 37 18 17 26z" fill="#87927b" />',
        '<path d="M44 8 59 15 37 18z" fill="#6d7c62" />',
        '<path d="M59 15 53 27 37 18z" fill="#65745a" />',
        '<path d="M37 18 53 27 39 25z" fill="#5c6e54" />',
        '<path d="M8 8 17 26 8 37z" fill="#65745a" />',
        '<path d="M17 26 27 36 8 37z" fill="#718066" />',
        '<path d="M17 26 37 18 27 36z" fill="#6d7c62" />',
        '<path d="M37 18 39 25 27 36z" fill="#87927b" />',
        '<path d="M27 36 39 25 46 32z" fill="#718066" />',
        '<path d="M27 36 46 32 37 41z" fill="#5c6e54" />',
        '<path d="M46 32 57 37 37 41z" fill="#65745a" />',
        '<path d="M57 37 59 58 48 48z" fill="#718066" />',
        '<path d="M57 37 48 48 37 41z" fill="#6d7c62" />',
        '<path d="M8 37 27 36 15 48z" fill="#87927b" />',
        '<path d="M27 36 26 45 15 48z" fill="#65745a" />',
        '<path d="M8 37 15 48 8 59z" fill="#5c6e54" />',
        '<path d="M15 48 26 45 20 59z" fill="#718066" />',
        '<path d="M8 59 15 48 20 59z" fill="#65745a" />',
        '<path d="M20 59 26 45 30 59z" fill="#87927b" />',
        '<path d="M26 45 37 41 30 59z" fill="#6d7c62" />',
        '<path d="M37 41 48 48 30 59z" fill="#87927b" />',
        '<path d="M48 48 59 58 30 59z" fill="#65745a" />',
        '</g>',
        '<text x="53" y="54" fill="#22322b" font-family="DM Sans, sans-serif" font-size="32" font-weight="700">rimitify</text>',
        '</g>',
        '</g>',
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