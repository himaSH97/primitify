export interface LoadedImage {
  imageData: ImageData
  sourceUrl: string
  sourceWidth: number
  sourceHeight: number
}

const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const supportedExtensions = /\.(png|jpe?g|webp)$/i

export async function loadImage(file: File, maxSide: number): Promise<LoadedImage> {
  if (!supportedTypes.has(file.type) && !supportedExtensions.test(file.name)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }

  if (!Number.isFinite(maxSide) || maxSide < 1) {
    throw new Error('Working size must be at least 1 pixel.')
  }

  const sourceUrl = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.src = sourceUrl
    await image.decode()

    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('This browser could not create an image canvas.')
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    return {
      imageData: context.getImageData(0, 0, width, height),
      sourceUrl,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
    }
  } catch {
    URL.revokeObjectURL(sourceUrl)
    throw new Error('That image could not be decoded. Try another PNG, JPEG, or WebP file.')
  }
}

export function averageColor(imageData: ImageData): { r: number; g: number; b: number } {
  const pixelCount = imageData.width * imageData.height
  let red = 0
  let green = 0
  let blue = 0

  for (let index = 0; index < imageData.data.length; index += 4) {
    red += imageData.data[index] ?? 0
    green += imageData.data[index + 1] ?? 0
    blue += imageData.data[index + 2] ?? 0
  }

  return {
    r: Math.round(red / pixelCount),
    g: Math.round(green / pixelCount),
    b: Math.round(blue / pixelCount),
  }
}