import './style.css'
import { averageColor, loadImage } from './imageLoad'
import { createBuffer, fillSolid, type RGBAColor } from './primitive/buffers'
import { differenceFull } from './primitive/score'
import { rasterizeTriangle, type TrianglePoint } from './primitive/triangleRasterizer'
import type { PixelImage, WorkerEvent, WorkerRequest } from './types'

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing workspace element: ${selector}`)
  return element
}

const statusText = getElement<HTMLElement>('#worker-status-text')
const statusDot = getElement<HTMLElement>('#status-dot')
const pingButton = getElement<HTMLButtonElement>('#ping-button')
const pingResult = getElement<HTMLElement>('#ping-result')
const fileInput = getElement<HTMLInputElement>('#image-file')
const uploadButton = getElement<HTMLButtonElement>('#upload-button')
const emptyUploadButton = getElement<HTMLButtonElement>('#empty-upload-button')
const dropZone = getElement<HTMLElement>('#drop-zone')
const emptyState = getElement<HTMLElement>('#empty-state')
const targetPreview = getElement<HTMLCanvasElement>('#target-preview')
const imageError = getElement<HTMLElement>('#image-error')
const imageInspector = getElement<HTMLElement>('#image-inspector')
const originalThumbnail = getElement<HTMLImageElement>('#original-thumbnail')
const imageName = getElement<HTMLElement>('#image-name')
const sourceDimensions = getElement<HTMLElement>('#source-dimensions')
const workDimensions = getElement<HTMLElement>('#work-dimensions')
const averageSwatch = getElement<HTMLElement>('#average-swatch')
const averageHex = getElement<HTMLElement>('#average-hex')
const workSize = getElement<HTMLSelectElement>('#work-size')
const previewStatus = getElement<HTMLElement>('#preview-status')
const previewIndicator = getElement<HTMLElement>('#preview-indicator')
const sourceLabel = getElement<HTMLElement>('#source-label')
const canvasLabel = getElement<HTMLElement>('#canvas-label')
const triangleDebugCanvas = getElement<HTMLCanvasElement>('#triangle-debug-preview')
const triangleDebugControls = getElement<HTMLElement>('#triangle-debug-controls')
const triangleDebugButton = getElement<HTMLButtonElement>('#triangle-debug-button')
const triangleDebugStatus = getElement<HTMLElement>('#triangle-debug-status')
const currentPreview = getElement<HTMLCanvasElement>('#current-preview')
const modelDebugControls = getElement<HTMLElement>('#model-debug-controls')
const targetTab = getElement<HTMLButtonElement>('#target-tab')
const currentTab = getElement<HTMLButtonElement>('#current-tab')
const shapeCountInput = getElement<HTMLInputElement>('#shape-count')
const runStartButton = getElement<HTMLButtonElement>('#run-start')
const runPauseButton = getElement<HTMLButtonElement>('#run-pause')
const runResumeButton = getElement<HTMLButtonElement>('#run-resume')
const runResetButton = getElement<HTMLButtonElement>('#run-reset')
const runStatus = getElement<HTMLElement>('#run-status')
const modelScore = getElement<HTMLElement>('#model-score')
const modelShapes = getElement<HTMLElement>('#model-shapes')
const modelEvaluations = getElement<HTMLElement>('#model-evaluations')
const outputSizeInput = getElement<HTMLSelectElement>('#output-size')
const downloadSvgButton = getElement<HTMLButtonElement>('#download-svg')

let sourceUrl: string | null = null
let selectedFile: File | null = null
let loadRequest = 0
let selectedTarget: PixelImage | null = null
let selectedBackground: RGBAColor | null = null
let initialScore = 0
let workerReady = false
let runState: 'idle' | 'running' | 'pausing' | 'paused' | 'done' = 'idle'
let worker: Worker
let svgHeader = ''
let svgFooter = ''
let svgFragments: string[] = []
let completedSvg = ''

function updateRunControls(): void {
  const busy = runState === 'running' || runState === 'pausing' || runState === 'paused'
  runStartButton.disabled = !workerReady || !selectedTarget || busy
  runPauseButton.disabled = runState !== 'running'
  runResumeButton.disabled = runState !== 'paused'
  runResetButton.disabled = !selectedTarget
  shapeCountInput.disabled = busy
  outputSizeInput.disabled = busy || svgFragments.length > 0
}

function clearSvg(): void {
  svgHeader = ''
  svgFooter = ''
  svgFragments = []
  completedSvg = ''
  downloadSvgButton.disabled = true
}

function assemblePartialSvg(): void {
  if (!svgHeader || svgFragments.length === 0) return
  completedSvg = [svgHeader, ...svgFragments, svgFooter].join('\n')
  downloadSvgButton.disabled = false
}

function restoreBackgroundPreview(): void {
  if (!selectedTarget || !selectedBackground) return
  currentPreview.width = selectedTarget.width
  currentPreview.height = selectedTarget.height
  const context = currentPreview.getContext('2d')
  if (!context) return
  const pixels = createBuffer(selectedTarget.width, selectedTarget.height)
  fillSolid(pixels, selectedBackground)
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), selectedTarget.width, selectedTarget.height), 0, 0)
}

function handleWorkerMessage({ data }: MessageEvent<WorkerEvent>): void {
  switch (data.type) {
    case 'ready':
      workerReady = true
      statusText.textContent = 'Worker online'
      statusDot.classList.add('is-online')
      statusDot.classList.remove('is-error')
      pingButton.disabled = false
      pingResult.textContent = 'Ready for a round-trip check'
      updateRunControls()
      break
    case 'pong':
      pingResult.textContent = `Round trip · ${Math.round(performance.now() - data.sentAt)} ms`
      break
    case 'preview': {
      const context = currentPreview.getContext('2d')
      if (!context) return
      currentPreview.width = data.width
      currentPreview.height = data.height
      context.putImageData(
        new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height),
        0,
        0,
      )
      showPreview('current')
      break
    }
    case 'progress':
      modelScore.textContent = data.score.toFixed(6)
      modelShapes.textContent = String(data.shapeIndex)
      modelEvaluations.textContent = String(
        Number(modelEvaluations.textContent) + data.evaluations,
      )
      runStatus.textContent = `Shape ${data.shapeIndex} / ${data.shapeCount} · score ${data.score.toFixed(6)}`
      previewStatus.textContent = `Shape ${data.shapeIndex} committed`
      break
    case 'runStarted':
      svgHeader = data.svgHeader
      svgFooter = data.svgFooter
      svgFragments = []
      completedSvg = ''
      runStatus.textContent = 'Searching in worker…'
      break
    case 'shapeAdded':
      svgFragments[data.index - 1] = data.svgFragment
      assemblePartialSvg()
      updateRunControls()
      break
    case 'paused':
      runState = 'paused'
      runStatus.textContent = `Paused after ${modelShapes.textContent} shapes`
      updateRunControls()
      break
    case 'resumed':
      runState = 'running'
      runStatus.textContent = 'Resuming search…'
      updateRunControls()
      break
    case 'done':
      runState = 'done'
      modelScore.textContent = data.finalScore.toFixed(6)
      completedSvg = data.svg
      downloadSvgButton.disabled = false
      runStatus.textContent = `Complete · ${modelShapes.textContent} shapes · score ${data.finalScore.toFixed(6)}`
      updateRunControls()
      break
    case 'aborted':
      runState = 'idle'
      runStatus.textContent = 'Run reset'
      updateRunControls()
      break
    case 'error':
      runState = 'idle'
      imageError.textContent = data.message
      imageError.hidden = false
      runStatus.textContent = 'Run stopped'
      updateRunControls()
      break
  }
}

function createWorker(): void {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  workerReady = false
  worker.addEventListener('message', handleWorkerMessage)
  worker.addEventListener('error', () => {
    workerReady = false
    runState = 'idle'
    statusText.textContent = 'Worker unavailable'
    statusDot.classList.remove('is-online')
    statusDot.classList.add('is-error')
    pingButton.disabled = true
    pingResult.textContent = 'Could not start the worker'
    imageError.textContent = 'The image worker stopped unexpectedly. Reload the page to try again.'
    imageError.hidden = false
    updateRunControls()
  })
  updateRunControls()
}

function resetRun(): void {
  worker.postMessage({ type: 'abort' } satisfies WorkerRequest)
  worker.terminate()
  createWorker()
  runState = 'idle'
  modelScore.textContent = initialScore.toFixed(6)
  modelShapes.textContent = '0'
  modelEvaluations.textContent = '0'
  clearSvg()
  restoreBackgroundPreview()
  showPreview('current')
  runStatus.textContent = 'Ready · Draft search'
  previewStatus.textContent = 'Current image reset'
  updateRunControls()
}

function showPreview(kind: 'target' | 'current'): void {
  const showTarget = kind === 'target'
  targetPreview.hidden = !showTarget
  currentPreview.hidden = showTarget
  triangleDebugCanvas.hidden = true
  targetTab.classList.toggle('is-selected', showTarget)
  targetTab.setAttribute('aria-pressed', String(showTarget))
  currentTab.classList.toggle('is-selected', !showTarget)
  currentTab.setAttribute('aria-pressed', String(!showTarget))
  canvasLabel.textContent = showTarget ? 'TARGET · READY' : 'CURRENT · PREVIEW'
}

function compareTriangleCoverage(width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || width < 16 || height < 16) return 'Canvas2D comparison needs an image at least 16 px wide and tall.'

  let seed = 0x5eed
  const random = (limit: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed % limit
  }
  const marginX = Math.max(1, Math.floor(width * 0.08))
  const marginY = Math.max(1, Math.floor(height * 0.08))
  const spanX = Math.max(1, width - marginX * 2)
  const spanY = Math.max(1, height - marginY * 2)
  let matchingTriangles = 0
  let comparedTriangles = 0

  for (let trial = 0; trial < 32; trial += 1) {
    let vertices: [TrianglePoint, TrianglePoint, TrianglePoint] = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ]
    let area = 0
    let attempts = 0
    do {
      vertices = [
        { x: marginX + random(spanX), y: marginY + random(spanY) },
        { x: marginX + random(spanX), y: marginY + random(spanY) },
        { x: marginX + random(spanX), y: marginY + random(spanY) },
      ]
      area = Math.abs(
        (vertices[1].x - vertices[0].x) * (vertices[2].y - vertices[0].y) -
        (vertices[1].y - vertices[0].y) * (vertices[2].x - vertices[0].x),
      )
      attempts += 1
    } while (area < width * height * 0.02 && attempts < 100)
    if (area < width * height * 0.02) continue

    const lines = rasterizeTriangle(vertices, width, height)
    const rasterPixels = lines.reduce((count, line) => count + line.x2 - line.x1 + 1, 0)
    context.clearRect(0, 0, width, height)
    context.beginPath()
    context.moveTo(vertices[0].x, vertices[0].y)
    context.lineTo(vertices[1].x, vertices[1].y)
    context.lineTo(vertices[2].x, vertices[2].y)
    context.closePath()
    context.fillStyle = '#f13d31'
    context.fill()
    const referencePixels = context.getImageData(0, 0, width, height).data
    let canvasPixels = 0
    for (let offset = 3; offset < referencePixels.length; offset += 4) {
      if ((referencePixels[offset] ?? 0) >= 128) canvasPixels += 1
    }
    if (Math.abs(rasterPixels - canvasPixels) / Math.max(canvasPixels, 1) <= 0.12) {
      matchingTriangles += 1
    }
    comparedTriangles += 1
  }

  return `Canvas2D pixel-count check · ${matchingTriangles}/${comparedTriangles} random triangles within 12%`
}

async function displayImage(file: File): Promise<void> {
  const request = ++loadRequest
  imageError.hidden = true
  previewStatus.textContent = 'Decoding image…'
  triangleDebugCanvas.hidden = true
  triangleDebugButton.disabled = true
  triangleDebugButton.textContent = 'Draw sample triangle'
  modelDebugControls.hidden = true
  clearSvg()
  if (runState === 'running' || runState === 'pausing' || runState === 'paused') {
    worker.postMessage({ type: 'abort' } satisfies WorkerRequest)
    worker.terminate()
    createWorker()
  }
  runState = 'idle'
  updateRunControls()

  try {
    const loaded = await loadImage(file, Number(workSize.value))
    if (request !== loadRequest) {
      URL.revokeObjectURL(loaded.sourceUrl)
      return
    }

    const context = targetPreview.getContext('2d')
    if (!context) {
      URL.revokeObjectURL(loaded.sourceUrl)
      throw new Error('This browser could not create the preview canvas.')
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    sourceUrl = loaded.sourceUrl
    selectedFile = file
    targetPreview.width = loaded.imageData.width
    targetPreview.height = loaded.imageData.height
    context.putImageData(loaded.imageData, 0, 0)
    targetPreview.hidden = false
    emptyState.hidden = true
    originalThumbnail.src = loaded.sourceUrl
    imageName.textContent = file.name
    sourceDimensions.textContent = `ORIGINAL  ${loaded.sourceWidth} × ${loaded.sourceHeight} PX`
    workDimensions.textContent = `${loaded.imageData.width} × ${loaded.imageData.height} PX`

    const color = averageColor(loaded.imageData)
    const hex = `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    averageSwatch.style.backgroundColor = hex
    averageHex.textContent = hex.toUpperCase()
    imageInspector.hidden = false
    sourceLabel.textContent = file.name
    canvasLabel.textContent = 'TARGET · READY'
    previewIndicator.classList.add('is-ready')
    previewStatus.textContent = 'Target image ready'
    uploadButton.innerHTML = 'Replace photo <span aria-hidden="true">↗</span>'
    triangleDebugControls.hidden = !import.meta.env.DEV
    triangleDebugButton.disabled = false
    triangleDebugStatus.textContent = 'Ready for a sample and Canvas2D coverage check.'

    selectedTarget = {
      width: loaded.imageData.width,
      height: loaded.imageData.height,
      data: loaded.imageData.data.slice(),
    }
    selectedBackground = { ...color, a: 255 }
    const backgroundPixels = createBuffer(loaded.imageData.width, loaded.imageData.height)
    fillSolid(backgroundPixels, selectedBackground)
    initialScore = differenceFull(loaded.imageData.data, backgroundPixels, loaded.imageData.width, loaded.imageData.height)
    restoreBackgroundPreview()
    modelScore.textContent = initialScore.toFixed(6)
    modelShapes.textContent = '0'
    modelEvaluations.textContent = '0'
    showPreview('target')
    modelDebugControls.hidden = false
    runStatus.textContent = 'Ready · Draft search'
    runState = 'idle'
    updateRunControls()
  } catch (error) {
    if (request !== loadRequest) return
    previewStatus.textContent = selectedFile ? 'Showing previous image' : 'Waiting for an image'
    imageError.textContent = error instanceof Error ? error.message : 'Could not load this image.'
    imageError.hidden = false
    triangleDebugControls.hidden = !import.meta.env.DEV || !selectedFile
    triangleDebugButton.disabled = !selectedFile
    modelDebugControls.hidden = !selectedTarget
    updateRunControls()
  }
}

targetTab.addEventListener('click', () => showPreview('target'))
currentTab.addEventListener('click', () => showPreview('current'))

runStartButton.addEventListener('click', () => {
  if (!selectedTarget || !selectedBackground || !workerReady) return
  const shapeCount = Number(shapeCountInput.value)
  if (!Number.isSafeInteger(shapeCount) || shapeCount < 1 || shapeCount > 500) {
    imageError.textContent = 'Choose between 1 and 500 shapes.'
    imageError.hidden = false
    return
  }

  imageError.hidden = true
  restoreBackgroundPreview()
  modelScore.textContent = initialScore.toFixed(6)
  modelShapes.textContent = '0'
  modelEvaluations.textContent = '0'
  clearSvg()
  runState = 'running'
  runStatus.textContent = 'Starting · Draft search'
  previewStatus.textContent = 'Searching in worker…'
  showPreview('current')
  updateRunControls()

  const request: WorkerRequest = {
    type: 'start',
    target: {
      width: selectedTarget.width,
      height: selectedTarget.height,
      data: selectedTarget.data.slice(),
    },
    config: {
      shapeCount,
      alpha: 128,
      randomTrials: 200,
      maxAge: 50,
      restarts: 4,
      outputSize: Number(outputSizeInput.value),
      background: selectedBackground,
    },
  }
  worker.postMessage(request)
})

runPauseButton.addEventListener('click', () => {
  runState = 'pausing'
  runStatus.textContent = 'Pausing after current search batch…'
  worker.postMessage({ type: 'pause' } satisfies WorkerRequest)
  updateRunControls()
})

runResumeButton.addEventListener('click', () => {
  runState = 'running'
  runStatus.textContent = 'Resuming search…'
  worker.postMessage({ type: 'resume' } satisfies WorkerRequest)
  updateRunControls()
})

runResetButton.addEventListener('click', resetRun)
shapeCountInput.addEventListener('change', updateRunControls)
outputSizeInput.addEventListener('change', () => {
  runStatus.textContent = `Next export will use ${outputSizeInput.value} px.`
})

downloadSvgButton.addEventListener('click', () => {
  if (!completedSvg) return
  const blob = new Blob([completedSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'primitify.svg'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
createWorker()

triangleDebugButton.addEventListener('click', () => {
  if (triangleDebugCanvas.hidden) {
    const width = targetPreview.width
    const height = targetPreview.height
    if (width < 3 || height < 3) return

    const vertices: [TrianglePoint, TrianglePoint, TrianglePoint] = [
      { x: Math.round(width * 0.18), y: Math.round(height * 0.2) },
      { x: Math.round(width * 0.82), y: Math.round(height * 0.27) },
      { x: Math.round(width * 0.52), y: Math.round(height * 0.82) },
    ]
    const lines = rasterizeTriangle(vertices, width, height)
    triangleDebugCanvas.width = width
    triangleDebugCanvas.height = height
    const context = triangleDebugCanvas.getContext('2d')
    if (!context) return
    const pixels = context.createImageData(width, height)
    let rasterPixels = 0
    for (const line of lines) {
      for (let column = line.x1; column <= line.x2; column += 1) {
        const offset = (line.y * width + column) * 4
        pixels.data[offset] = 245
        pixels.data[offset + 1] = 50
        pixels.data[offset + 2] = 43
        pixels.data[offset + 3] = 235
        rasterPixels += 1
      }
    }
    context.putImageData(pixels, 0, 0)
    triangleDebugCanvas.hidden = false
    triangleDebugButton.textContent = 'Clear sample triangle'
    triangleDebugStatus.textContent = `${lines.length} scanlines · ${rasterPixels} filled pixels · ${compareTriangleCoverage(width, height)}`
    canvasLabel.textContent = 'TARGET · RASTER'
    previewStatus.textContent = 'Sample triangle rasterized'
    return
  }

  triangleDebugCanvas.hidden = true
  triangleDebugButton.textContent = 'Draw sample triangle'
  triangleDebugStatus.textContent = 'Ready for a sample and Canvas2D coverage check.'
  canvasLabel.textContent = 'TARGET · READY'
  previewStatus.textContent = 'Target image ready'
})

function chooseImage(): void {
  fileInput.click()
}

uploadButton.addEventListener('click', chooseImage)
emptyUploadButton.addEventListener('click', chooseImage)
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files ?? []
  fileInput.value = ''
  if (file) void displayImage(file)
})

workSize.addEventListener('change', () => {
  if (selectedFile) void displayImage(selectedFile)
})

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropZone.classList.add('is-dragging')
})

dropZone.addEventListener('dragleave', (event) => {
  if (!dropZone.contains(event.relatedTarget as Node | null)) {
    dropZone.classList.remove('is-dragging')
  }
})

dropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropZone.classList.remove('is-dragging')
  const [file] = event.dataTransfer?.files ?? []
  if (file) void displayImage(file)
})

pingButton.addEventListener('click', () => {
  const sentAt = performance.now()
  pingResult.textContent = 'Checking connection…'
  worker.postMessage({ type: 'ping', sentAt })
})

window.addEventListener('beforeunload', () => worker.terminate())
window.addEventListener('beforeunload', () => {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl)
})