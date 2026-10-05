import { describe, expect, it } from 'vitest'
import { cropScanlines } from './scanline'
import { rasterizeTriangle, type TrianglePoint } from './triangleRasterizer'

function rows(lines: ReturnType<typeof rasterizeTriangle>): number[][] {
  return lines.map(({ y: row, x1: firstColumn, x2: lastColumn }) => [row, firstColumn, lastColumn])
}

describe('triangle scanline rasterizer', () => {
  it('rasterizes flat-top and flat-bottom triangles with inclusive endpoints', () => {
    const topFlat = rasterizeTriangle([
      { x: 2, y: 1 }, { x: 5, y: 1 }, { x: 2, y: 4 },
    ], 8, 6)
    const bottomFlat = rasterizeTriangle([
      { x: 2, y: 1 }, { x: 2, y: 4 }, { x: 5, y: 4 },
    ], 8, 6)

    expect(rows(topFlat)).toEqual([[4, 2, 3], [3, 2, 4], [2, 2, 5]])
    expect(rows(bottomFlat)).toEqual([[1, 2, 2], [2, 2, 3], [3, 2, 4], [4, 2, 5]])
    expect(topFlat.every((line) => line.alpha === 0xffff)).toBe(true)
  })

  it('splits general triangles consistently across vertex orderings', () => {
    const vertices: [TrianglePoint, TrianglePoint, TrianglePoint] = [
      { x: 1, y: 1 }, { x: 6, y: 4 }, { x: 3, y: 8 },
    ]
    const expected = rows(rasterizeTriangle(vertices, 9, 10))
    const permutations: [TrianglePoint, TrianglePoint, TrianglePoint][] = [
      [vertices[0], vertices[2], vertices[1]],
      [vertices[1], vertices[0], vertices[2]],
      [vertices[1], vertices[2], vertices[0]],
      [vertices[2], vertices[0], vertices[1]],
      [vertices[2], vertices[1], vertices[0]],
    ]

    for (const permutation of permutations) {
      expect(rows(rasterizeTriangle(permutation, 9, 10))).toEqual(expected)
    }
  })

  it('clips scanlines against every image edge and reuses the supplied buffer', () => {
    const buffer = [
      { y: -1, x1: 0, x2: 2, alpha: 0xffff },
      { y: 0, x1: -2, x2: 2, alpha: 0xffff },
      { y: 1, x1: 2, x2: 8, alpha: 0xffff },
      { y: 2, x1: -4, x2: 8, alpha: 0xffff },
      { y: 3, x1: 0, x2: 2, alpha: 0xffff },
      { y: 1, x1: -5, x2: -1, alpha: 0xffff },
    ]
    const clipped = cropScanlines(buffer, 5, 3)

    expect(clipped).toBe(buffer)
    expect(rows(clipped)).toEqual([[0, 0, 2], [1, 2, 4], [2, 0, 4]])
  })

  it('keeps deterministic randomized triangles within bounds and vertex-order invariant', () => {
    let seed = 0x5eed
    const random = (limit: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed % limit
    }

    for (let index = 0; index < 100; index += 1) {
      let vertices: [TrianglePoint, TrianglePoint, TrianglePoint]
      do {
        vertices = [
          { x: random(40), y: random(40) },
          { x: random(40), y: random(40) },
          { x: random(40), y: random(40) },
        ]
      } while (
        (vertices[1].x - vertices[0].x) * (vertices[2].y - vertices[0].y) ===
        (vertices[1].y - vertices[0].y) * (vertices[2].x - vertices[0].x)
      )

      const output = rasterizeTriangle(vertices, 32, 32)
      expect(output.every((line) => line.y >= 0 && line.y < 32 && line.x1 >= 0 && line.x2 < 32)).toBe(true)
      expect(rows(rasterizeTriangle([vertices[2], vertices[0], vertices[1]], 32, 32))).toEqual(rows(output))
    }
  })

  it('returns no filled pixels for a degenerate triangle', () => {
    expect(rasterizeTriangle([
      { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 4 },
    ], 8, 8)).toEqual([])
  })
})