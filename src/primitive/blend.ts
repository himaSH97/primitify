import { assertImageBuffer, type RGBAColor } from './buffers'
import { SCANLINE_ALPHA_MAX, validateScanlines, type Scanline } from './scanline'

export function copyLines(
  destination: Uint8ClampedArray,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  lines: Scanline[],
): void {
  assertImageBuffer(destination, width, height)
  assertImageBuffer(source, width, height)
  validateScanlines(lines, width, height)

  for (const line of lines) {
    const start = (line.y * width + line.x1) * 4
    const end = (line.y * width + line.x2 + 1) * 4
    destination.set(source.subarray(start, end), start)
  }
}

export function drawLines(
  image: Uint8ClampedArray,
  width: number,
  height: number,
  color: RGBAColor,
  lines: Scanline[],
): void {
  assertImageBuffer(image, width, height)
  validateScanlines(lines, width, height)
  for (const channel of [color.r, color.g, color.b, color.a]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError('RGBA color channels must be integers from 0 to 255.')
    }
  }

  const maximum = SCANLINE_ALPHA_MAX
  const sourceAlpha = color.a * 0x101
  const source = [color.r, color.g, color.b].map((channel) => Math.floor(channel * 0x101 * color.a / 255))
  source.push(sourceAlpha)

  for (const line of lines) {
    const mask = line.alpha
    const remaining = (maximum - Math.floor(sourceAlpha * mask / maximum)) * 0x101
    let offset = (line.y * width + line.x1) * 4
    for (let x = line.x1; x <= line.x2; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const destination = image[offset + channel] ?? 0
        image[offset + channel] = Math.floor(
          Math.floor((destination * remaining + (source[channel] ?? 0) * mask) / maximum) / 256,
        )
      }
      offset += 4
    }
  }
}