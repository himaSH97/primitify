import { describe, expect, it } from 'vitest'
import { createBuffer, fillSolid } from './buffers'
import { Model } from './model'
import { hillClimb } from './optimize'
import { SeededRandom } from './rng'
import { State, type AnnealableState, type StateWorker } from './state'
import { Triangle } from './shapes/triangle'

class DescendingState implements AnnealableState<DescendingState> {
  constructor(public value: number) {}

  energy(): number {
    return Math.abs(this.value)
  }

  doMove(): DescendingState {
    const previous = this.copy()
    if (this.value > 0) this.value -= 1
    else this.value += 1
    return previous
  }

  undoMove(previous: DescendingState): void {
    this.value = previous.value
  }

  copy(): DescendingState {
    return new DescendingState(this.value)
  }
}

describe('triangle optimization core', () => {
  it('creates valid triangles and keeps mutations within the permitted margin', () => {
    const random = new SeededRandom(1234)
    const triangle = Triangle.random(64, 48, random)
    expect(triangle.valid()).toBe(true)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      triangle.mutate()
      expect(triangle.valid()).toBe(true)
      expect(triangle.vertices.every((point) => point.x >= -16 && point.x <= 79 && point.y >= -16 && point.y <= 63)).toBe(true)
    }
  })

  it('hill-climbs to a local minimum and returns an independent best state', async () => {
    const result = await hillClimb(new DescendingState(8), 4)

    expect(result.value).toBe(0)
    expect(new DescendingState(8).value).toBe(8)
  })

  it('caches energy until a move and restores the cached state on rejection', () => {
    let evaluations = 0
    const shape = Triangle.random(32, 32, new SeededRandom(55))
    const worker: StateWorker = {
      random: new SeededRandom(56),
      energy: () => {
        evaluations += 1
        return 1
      },
    }
    const state = new State(worker, shape, 128)

    expect(state.energy()).toBe(1)
    expect(state.energy()).toBe(1)
    expect(evaluations).toBe(1)
    const previous = state.doMove()
    expect(state.score).toBe(-1)
    state.undoMove(previous)
    expect(state.energy()).toBe(1)
    expect(evaluations).toBe(1)
  })

  it('commits one model step without increasing score and changes the current image', async () => {
    const width = 64
    const height = 48
    const target = createBuffer(width, height)
    fillSolid(target, { r: 35, g: 80, b: 125, a: 255 })
    for (let row = 8; row < 40; row += 1) {
      for (let column = 10; column < 54; column += 1) {
        const offset = (row * width + column) * 4
        target[offset] = 225
        target[offset + 1] = 85
        target[offset + 2] = 45
      }
    }
    const background = { r: 35, g: 80, b: 125, a: 255 }
    const model = new Model(target, width, height, background, new SeededRandom(9001))
    const initialScore = model.score
    const initialPixels = new Uint8ClampedArray(model.current)
    let yields = 0

    const result = await model.step(
      160,
      { randomTrials: 25, maxAge: 12, restarts: 3 },
      async () => { yields += 1 },
    )

    expect(result.shapesAdded).toBe(1)
    expect(result.evaluations).toBeGreaterThan(0)
    expect(result.score).toBeLessThanOrEqual(initialScore)
    expect(model.current).not.toEqual(initialPixels)
    expect(yields).toBeGreaterThan(0)
  })

  it('serializes SVG with output-sized aspect ratio, background, transform, and triangle opacity', () => {
    const width = 64
    const height = 32
    const background = { r: 35, g: 80, b: 125, a: 255 }
    const target = createBuffer(width, height)
    fillSolid(target, background)
    const model = new Model(target, width, height, background, new SeededRandom(321))
    model.add(Triangle.random(width, height, new SeededRandom(654)), 128)

    const parts = model.svgParts(1024)
    const svg = model.toSVG(1024)

    expect(parts).toMatchObject({ width: 1024, height: 512, scale: 16 })
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1024" height="512">')
    expect(svg).toContain('<rect x="0" y="0" width="1024" height="512" fill="#23507d" />')
    expect(svg).toContain('<g transform="scale(16.000000) translate(0.5 0.5)">')
    expect(svg).toMatch(/<polygon fill="#[0-9a-f]{6}" fill-opacity="0\.501961" points="-?\d+,-?\d+ -?\d+,-?\d+ -?\d+,-?\d+" \/>/)
    expect(svg.endsWith('</g>\n</svg>')).toBe(true)
  })
})