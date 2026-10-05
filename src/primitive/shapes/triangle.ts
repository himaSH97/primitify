import { rasterizeTriangle, type TrianglePoint } from '../triangleRasterizer'
import type { RandomSource } from '../rng'
import type { Scanline } from '../scanline'
import type { Shape } from './shape'

type TriangleVertices = [TrianglePoint, TrianglePoint, TrianglePoint]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function angleDegrees(origin: TrianglePoint, first: TrianglePoint, second: TrianglePoint): number {
  const firstX = first.x - origin.x
  const firstY = first.y - origin.y
  const secondX = second.x - origin.x
  const secondY = second.y - origin.y
  const firstLength = Math.hypot(firstX, firstY)
  const secondLength = Math.hypot(secondX, secondY)
  if (firstLength === 0 || secondLength === 0) return Number.NaN

  const cosine = (firstX * secondX + firstY * secondY) / (firstLength * secondLength)
  return Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI
}

export class Triangle implements Shape {
  private readonly points: TriangleVertices
  private readonly scanlineBuffer: Scanline[] = []

  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly random: RandomSource,
    points: TriangleVertices,
  ) {
    this.points = points.map((point) => ({ ...point })) as TriangleVertices
  }

  static random(width: number, height: number, random: RandomSource): Triangle {
    if (width < 1 || height < 1) throw new RangeError('Triangle dimensions must be positive.')
    const firstX = random.nextInt(width)
    const firstY = random.nextInt(height)
    const vertices: TriangleVertices = [
      { x: firstX, y: firstY },
      { x: firstX + random.nextInt(31) - 15, y: firstY + random.nextInt(31) - 15 },
      { x: firstX + random.nextInt(31) - 15, y: firstY + random.nextInt(31) - 15 },
    ]
    const triangle = new Triangle(width, height, random, vertices)
    triangle.mutate()
    return triangle
  }

  get vertices(): TriangleVertices {
    return this.points.map((point) => ({ ...point })) as TriangleVertices
  }

  mutate(): void {
    const margin = 16
    do {
      const vertexIndex = this.random.nextInt(3)
      const vertex = this.points[vertexIndex]
      if (!vertex) continue

      vertex.x = clamp(vertex.x + Math.trunc(this.random.normal() * 16), -margin, this.width - 1 + margin)
      vertex.y = clamp(vertex.y + Math.trunc(this.random.normal() * 16), -margin, this.height - 1 + margin)
    } while (!this.valid())
  }

  valid(): boolean {
    const [first, second, third] = this.points
    const firstAngle = angleDegrees(first, second, third)
    const secondAngle = angleDegrees(second, first, third)
    const thirdAngle = 180 - firstAngle - secondAngle
    return firstAngle > 15 && secondAngle > 15 && thirdAngle > 15
  }

  copy(): Triangle {
    return new Triangle(this.width, this.height, this.random, this.points)
  }

  rasterize(): Scanline[] {
    return rasterizeTriangle(this.points, this.width, this.height, this.scanlineBuffer)
  }

  toSVG(attributes: string): string {
    const [first, second, third] = this.points
    return `<polygon ${attributes} points="${first.x},${first.y} ${second.x},${second.y} ${third.x},${third.y}" />`
  }
}