export interface Scanline {
  y: number
  x1: number
  x2: number
  alpha: number
}

export const SCANLINE_ALPHA_MAX = 0xffff

export function cropScanlines(lines: Scanline[], width: number, height: number): Scanline[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.')
  }

  let count = 0
  for (const line of lines) {
    if (
      !Number.isInteger(line.y) || !Number.isInteger(line.x1) || !Number.isInteger(line.x2) ||
      !Number.isInteger(line.alpha) || line.alpha < 0 || line.alpha > SCANLINE_ALPHA_MAX
    ) {
      throw new RangeError('Scanline coordinates and alpha must be integers.')
    }
    if (line.y < 0 || line.y >= height || line.x1 >= width || line.x2 < 0) continue

    line.x1 = Math.max(0, line.x1)
    line.x2 = Math.min(width - 1, line.x2)
    if (line.x1 > line.x2) continue
    lines[count] = line
    count += 1
  }
  lines.length = count
  return lines
}

export function validateScanlines(lines: Scanline[], width: number, height: number): void {
  for (const line of lines) {
    if (
      !Number.isInteger(line.y) || line.y < 0 || line.y >= height ||
      !Number.isInteger(line.x1) || !Number.isInteger(line.x2) ||
      line.x1 < 0 || line.x1 > line.x2 || line.x2 >= width ||
      !Number.isInteger(line.alpha) || line.alpha < 0 || line.alpha > SCANLINE_ALPHA_MAX
    ) {
      throw new RangeError('Scanline is outside the image bounds or has invalid alpha.')
    }
  }
}