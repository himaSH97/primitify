import { describe, expect, it } from 'vitest'
import { copyLines, drawLines } from './blend'
import { computeColor } from './color'
import { copyBuffer, createBuffer, fillSolid, getPixel } from './buffers'
import { differenceFull, differencePartial } from './score'
import type { Scanline } from './scanline'

const fullLine: Scanline = { y: 0, x1: 0, x2: 1, alpha: 0xffff }

describe('RGBA buffers', () => {
  it('creates, fills, copies, and reads pixels with bounds checks', () => {
    const buffer = createBuffer(2, 1)
    fillSolid(buffer, { r: 12, g: 34, b: 56, a: 255 })
    const copy = copyBuffer(buffer)

    expect([...buffer]).toEqual([12, 34, 56, 255, 12, 34, 56, 255])
    expect(getPixel(copy, 2, 1, 1, 0)).toEqual({ r: 12, g: 34, b: 56, a: 255 })
    expect(() => getPixel(copy, 2, 1, 2, 0)).toThrow(RangeError)
    expect(() => createBuffer(0, 1)).toThrow(RangeError)
  })
})

describe('pixel scoring and blending', () => {
  it('computes full RGBA RMSE for a hand-built 2x2 image', () => {
    const target = createBuffer(2, 2)
    const current = copyBuffer(target)
    current[0] = 255

    expect(differenceFull(target, current, 2, 2)).toBe(0.25)
  })

  it('computes the best opaque RGB color for a horizontal scanline', () => {
    const target = new Uint8ClampedArray([
      100, 50, 25, 255,
      200, 100, 50, 255,
    ])
    const current = createBuffer(2, 1)
    fillSolid(current, { r: 0, g: 0, b: 0, a: 255 })

    expect(computeColor(target, current, 2, 1, [fullLine], 255)).toEqual({
      r: 150,
      g: 75,
      b: 37,
      a: 255,
    })
  })

  it('copies and alpha blends only pixels covered by the scanline', () => {
    const image = createBuffer(2, 1)
    fillSolid(image, { r: 0, g: 0, b: 0, a: 255 })
    const scratch = copyBuffer(image)
    copyLines(scratch, image, 2, 1, [fullLine])
    drawLines(scratch, 2, 1, { r: 255, g: 0, b: 0, a: 128 }, [fullLine])

    expect([...scratch]).toEqual([128, 0, 0, 255, 128, 0, 0, 255])
    expect([...image]).toEqual([0, 0, 0, 255, 0, 0, 0, 255])
  })

  it('matches partial score to a full recompute after one known draw', () => {
    const target = new Uint8ClampedArray([
      100, 50, 25, 255,
      200, 100, 50, 255,
    ])
    const before = createBuffer(2, 1)
    fillSolid(before, { r: 0, g: 0, b: 0, a: 255 })
    const after = copyBuffer(before)
    const initialScore = differenceFull(target, before, 2, 1)
    const color = computeColor(target, before, 2, 1, [fullLine], 128)
    drawLines(after, 2, 1, color, [fullLine])

    const partial = differencePartial(target, before, after, 2, 1, initialScore, [fullLine])
    const full = differenceFull(target, after, 2, 1)
    expect(Math.abs(partial - full)).toBeLessThan(1e-12)
  })

  it('updates score when only one pixel changes', () => {
    const target = createBuffer(2, 1)
    const before = copyBuffer(target)
    const after = copyBuffer(before)
    after[0] = 255
    const line: Scanline = { y: 0, x1: 0, x2: 0, alpha: 0xffff }

    expect(differencePartial(target, before, after, 2, 1, 0, [line]))
      .toBe(differenceFull(target, after, 2, 1))
  })

  it('handles rounding at a one-unit pixel difference', () => {
    const target = createBuffer(2, 1)
    target[0] = 1
    const before = createBuffer(2, 1)
    const after = copyBuffer(target)
    const score = differenceFull(target, before, 2, 1)
    const line: Scanline = { y: 0, x1: 0, x2: 0, alpha: 0xffff }

    expect(differencePartial(target, before, after, 2, 1, score, [line])).toBe(0)
  })
})