import type { Scanline } from '../scanline'

export interface Shape {
  mutate(): void
  valid(): boolean
  copy(): Shape
  rasterize(): Scanline[]
  toSVG(attributes: string): string
}