import { cropScanlines, SCANLINE_ALPHA_MAX, type Scanline } from './scanline'

export interface TrianglePoint {
  x: number
  y: number
}

type TriangleVertices = readonly [TrianglePoint, TrianglePoint, TrianglePoint]

function appendLine(lines: Scanline[], y: number, firstX: number, secondX: number): void {
  const x1 = Math.min(firstX, secondX)
  const x2 = Math.max(firstX, secondX)
  lines.push({ y, x1, x2, alpha: SCANLINE_ALPHA_MAX })
}

function rasterizeBottom(
  top: TrianglePoint,
  firstBottom: TrianglePoint,
  secondBottom: TrianglePoint,
  lines: Scanline[],
): void {
  const firstSlope = (firstBottom.x - top.x) / (firstBottom.y - top.y)
  const secondSlope = (secondBottom.x - top.x) / (secondBottom.y - top.y)
  let firstX = top.x
  let secondX = top.x

  for (let row = top.y; row <= firstBottom.y; row += 1) {
    appendLine(lines, row, Math.trunc(firstX), Math.trunc(secondX))
    firstX += firstSlope
    secondX += secondSlope
  }
}

function rasterizeTop(
  firstTop: TrianglePoint,
  secondTop: TrianglePoint,
  bottom: TrianglePoint,
  lines: Scanline[],
): void {
  const firstSlope = (bottom.x - firstTop.x) / (bottom.y - firstTop.y)
  const secondSlope = (bottom.x - secondTop.x) / (bottom.y - secondTop.y)
  let firstX = bottom.x
  let secondX = bottom.x

  for (let row = bottom.y; row > firstTop.y; row -= 1) {
    firstX -= firstSlope
    secondX -= secondSlope
    appendLine(lines, row, Math.trunc(firstX), Math.trunc(secondX))
  }
}

export function rasterizeTriangle(
  vertices: TriangleVertices,
  width: number,
  height: number,
  buffer: Scanline[] = [],
): Scanline[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.')
  }
  for (const point of vertices) {
    if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) {
      throw new RangeError('Triangle vertices must have integer coordinates.')
    }
  }

  buffer.length = 0
  const [first, second, third] = [...vertices].sort((left, right) => left.y - right.y)
  if (!first || !second || !third || first.y === third.y) return buffer

  const area = (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
  if (area === 0) return buffer

  if (second.y === third.y) {
    rasterizeBottom(first, second, third, buffer)
  } else if (first.y === second.y) {
    rasterizeTop(first, second, third, buffer)
  } else {
    const splitX = first.x + Math.trunc(
      ((second.y - first.y) / (third.y - first.y)) * (third.x - first.x),
    )
    const split = { x: splitX, y: second.y }
    rasterizeBottom(first, second, split, buffer)
    rasterizeTop(second, split, third, buffer)
  }

  return cropScanlines(buffer, width, height)
}