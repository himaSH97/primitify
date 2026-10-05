export interface RGBAColor {
  r: number
  g: number
  b: number
  a: number
}

export function assertImageBuffer(buffer: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.')
  }
  if (buffer.length !== width * height * 4) {
    throw new RangeError('RGBA buffer length does not match its dimensions.')
  }
}

function assertColor(color: RGBAColor): void {
  for (const channel of [color.r, color.g, color.b, color.a]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError('RGBA color channels must be integers from 0 to 255.')
    }
  }
}

export function createBuffer(width: number, height: number): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.')
  }
  return new Uint8ClampedArray(width * height * 4)
}

export function fillSolid(buffer: Uint8ClampedArray, color: RGBAColor): void {
  if (buffer.length === 0 || buffer.length % 4 !== 0) {
    throw new RangeError('RGBA buffer length must be a nonzero multiple of four.')
  }
  assertColor(color)
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = color.r
    buffer[index + 1] = color.g
    buffer[index + 2] = color.b
    buffer[index + 3] = color.a
  }
}

export function copyBuffer(source: Uint8ClampedArray): Uint8ClampedArray {
  if (source.length === 0 || source.length % 4 !== 0) {
    throw new RangeError('RGBA buffer length must be a nonzero multiple of four.')
  }
  return new Uint8ClampedArray(source)
}

export function getPixel(
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): RGBAColor {
  assertImageBuffer(buffer, width, height)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new RangeError('Pixel coordinates are outside the image bounds.')
  }
  const offset = (y * width + x) * 4
  return {
    r: buffer[offset] ?? 0,
    g: buffer[offset + 1] ?? 0,
    b: buffer[offset + 2] ?? 0,
    a: buffer[offset + 3] ?? 0,
  }
}