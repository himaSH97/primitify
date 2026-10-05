import { assertImageBuffer, type RGBAColor } from './buffers'
import { validateScanlines, type Scanline } from './scanline'

export function computeColor(
  target: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number,
  lines: Scanline[],
  alpha: number,
): RGBAColor {
  assertImageBuffer(target, width, height)
  assertImageBuffer(current, width, height)
  validateScanlines(lines, width, height)

  if (lines.length === 0) return { r: 0, g: 0, b: 0, a: 0 }
  if (!Number.isInteger(alpha) || alpha < 1 || alpha > 255) {
    throw new RangeError('Shape alpha must be an integer from 1 to 255.')
  }

  const multiplier = Math.floor(0x101 * 255 / alpha)
  let redSum = 0
  let greenSum = 0
  let blueSum = 0
  let count = 0

  for (const line of lines) {
    let offset = (line.y * width + line.x1) * 4
    for (let x = line.x1; x <= line.x2; x += 1) {
      const targetRed = target[offset] ?? 0
      const targetGreen = target[offset + 1] ?? 0
      const targetBlue = target[offset + 2] ?? 0
      const currentRed = current[offset] ?? 0
      const currentGreen = current[offset + 1] ?? 0
      const currentBlue = current[offset + 2] ?? 0
      redSum += (targetRed - currentRed) * multiplier + currentRed * 0x101
      greenSum += (targetGreen - currentGreen) * multiplier + currentGreen * 0x101
      blueSum += (targetBlue - currentBlue) * multiplier + currentBlue * 0x101
      count += 1
      offset += 4
    }
  }

  const channel = (sum: number) => Math.max(0, Math.min(255, Math.floor(Math.trunc(sum / count) / 256)))
  return { r: channel(redSum), g: channel(greenSum), b: channel(blueSum), a: alpha }
}