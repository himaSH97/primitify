import { assertImageBuffer } from './buffers'
import { validateScanlines, type Scanline } from './scanline'

function pixelError(a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number): number {
  const red = (a[offset] ?? 0) - (b[offset] ?? 0)
  const green = (a[offset + 1] ?? 0) - (b[offset + 1] ?? 0)
  const blue = (a[offset + 2] ?? 0) - (b[offset + 2] ?? 0)
  const alpha = (a[offset + 3] ?? 0) - (b[offset + 3] ?? 0)
  return red * red + green * green + blue * blue + alpha * alpha
}

export function differenceFull(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  assertImageBuffer(a, width, height)
  assertImageBuffer(b, width, height)

  let total = 0
  for (let offset = 0; offset < a.length; offset += 4) {
    total += pixelError(a, b, offset)
  }
  return Math.sqrt(total / (width * height * 4)) / 255
}

export function differencePartial(
  target: Uint8ClampedArray,
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
  previousScore: number,
  lines: Scanline[],
): number {
  assertImageBuffer(target, width, height)
  assertImageBuffer(before, width, height)
  assertImageBuffer(after, width, height)
  validateScanlines(lines, width, height)
  if (!Number.isFinite(previousScore) || previousScore < 0) {
    throw new RangeError('Previous score must be a finite nonnegative value.')
  }

  let total = Math.trunc((previousScore * 255) ** 2 * (width * height * 4))
  for (const line of lines) {
    let offset = (line.y * width + line.x1) * 4
    for (let x = line.x1; x <= line.x2; x += 1) {
      total += pixelError(target, after, offset) - pixelError(target, before, offset)
      offset += 4
    }
  }

  return Math.sqrt(Math.max(0, total) / (width * height * 4)) / 255
}