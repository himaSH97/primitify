import { averageColor, loadImage } from './imageLoad'
import type { PixelImage, WorkerEvent, WorkerRequest } from './types'

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing concept element: ${selector}`)
  return element
}

const workerStatus = getElement<HTMLElement>('#worker-status')
const fileInput = getElement<HTMLInputElement>('#image-file')
const choosePhotoButton = getElement<HTMLButtonElement>('#choose-photo')
const workSize = getElement<HTMLSelectElement>('#work-size')
const shapeCount = getElement<HTMLSelectElement>('#shape-count')
const outputSize = getElement<HTMLSelectElement>('#output-size')
const projectName = getElement<HTMLElement>('#project-name')
const intro = getElement<HTMLElement>('#intro')
const comparison = getElement<HTMLElement>('#comparison')
const sourceImage = getElement<HTMLImageElement>('.original-image')
const sourceEmpty = getElement<HTMLElement>('#source-empty')
const sourceStamp = getElement<HTMLElement>('#source-stamp')
const emptyChoosePhotoButton = getElement<HTMLButtonElement>('#empty-choose-photo')
const sourceDimensions = getElement<HTMLElement>('#source-dimensions')
const sourceName = getElement<HTMLElement>('#source-name')
const workingDimensions = getElement<HTMLElement>('#working-dimensions')
const generatedPreview = getElement<HTMLCanvasElement>('#generated-preview')
const generatedVectorPreview = getElement<HTMLImageElement>('#generated-vector-preview')
const generatedEmpty = getElement<HTMLElement>('#generated-empty')
const generatedEmptyTitle = getElement<HTMLElement>('#generated-empty-title')
const generatedEmptyCopy = getElement<HTMLElement>('#generated-empty-copy')
const generatedStartButton = getElement<HTMLButtonElement>('#generated-start')
const generatedFrame = getElement<HTMLElement>('#generated-frame')
const frameStamp = getElement<HTMLElement>('#frame-stamp')
const renderProgressBadge = getElement<HTMLElement>('#render-progress')
const renderProgressRing = getElement<SVGCircleElement>('#render-progress-ring')
const renderProgressLabel = getElement<HTMLElement>('#render-progress-label')
const shapeProgress = getElement<HTMLElement>('#shape-progress')
const generationState = getElement<HTMLElement>('#generation-state')
const scoreValue = getElement<HTMLElement>('#score-value')
const runInfo = getElement<HTMLElement>('#run-info')
const runStatus = getElement<HTMLElement>('#run-status')
const startButton = getElement<HTMLButtonElement>('#start-run')
const resetButton = getElement<HTMLButtonElement>('#reset-run')
const exportFormat = getElement<HTMLSelectElement>('#export-format')
const exportButton = getElement<HTMLButtonElement>('#export-file')

type RunState = 'idle' | 'running' | 'pausing' | 'paused' | 'done'

let worker: Worker
let workerReady = false
let runState: RunState = 'idle'
let loading = false
let loadRequest = 0
let selectedFile: File | null = null
let sourceUrl: string | null = null
let selectedTarget: PixelImage | null = null
let selectedBackground: { r: number; g: number; b: number; a: number } | null = null
let svgHeader = ''
let svgFooter = ''
let svgFragments: string[] = []
let currentSvg = ''
let previewObjectUrl: string | null = null
let exporting = false

function setStatus(message: string, isError = false): void {
  runStatus.textContent = message
  runInfo.classList.toggle('is-error', isError)
}

function dismissIntro(): void {
  if (intro.hidden || intro.classList.contains('is-leaving')) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    intro.hidden = true
    return
  }

  intro.classList.add('is-leaving')
  const finishDismissal = (event: AnimationEvent) => {
    if (event.target !== intro || event.animationName !== 'dismiss-intro') return
    intro.hidden = true
    intro.classList.remove('is-leaving')
    intro.removeEventListener('animationend', finishDismissal)
  }
  intro.addEventListener('animationend', finishDismissal)
}

function animateEntrance(element: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  element.classList.remove('is-entering')
  void element.offsetWidth
  element.classList.add('is-entering')
  element.addEventListener('animationend', () => element.classList.remove('is-entering'), { once: true })
}

function updateControls(): void {
  const busy = runState === 'running' || runState === 'pausing' || runState === 'paused'
  startButton.disabled = !workerReady || !selectedTarget || loading || runState === 'pausing'
  workSize.disabled = busy || loading
  shapeCount.disabled = busy || loading
  outputSize.disabled = busy || loading
  choosePhotoButton.disabled = loading
  startButton.innerHTML = runState === 'paused'
    ? '<span aria-hidden="true">▶</span>Resume'
    : runState === 'running' || runState === 'pausing'
      ? '<span class="button-icon" aria-hidden="true">Ⅱ</span>Pause'
      : '<span aria-hidden="true">▶</span>Start'
  startButton.setAttribute('aria-label', runState === 'paused' ? 'Resume generation' : runState === 'running' ? 'Pause generation' : 'Start generation')
  generatedStartButton.disabled = !workerReady || !selectedTarget || loading || runState !== 'idle'
  resetButton.disabled = !selectedTarget || loading
  exportFormat.disabled = exporting
  exportButton.disabled = currentSvg.length === 0 || exporting
}

function clearSvg(): void {
  svgHeader = ''
  svgFooter = ''
  svgFragments = []
  currentSvg = ''
  setRenderProgress(null)
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
  previewObjectUrl = null
  generatedVectorPreview.hidden = true
  updateControls()
}

function renderVectorPreview(): void {
  if (!svgHeader || svgFragments.length === 0) return

  currentSvg = [svgHeader, ...svgFragments, svgFooter].join('\n')
  const previousUrl = previewObjectUrl
  const firstVectorFrame = generatedVectorPreview.hidden
  previewObjectUrl = URL.createObjectURL(new Blob([currentSvg], { type: 'image/svg+xml' }))
  generatedVectorPreview.onload = () => {
    if (previousUrl && previousUrl !== previewObjectUrl) URL.revokeObjectURL(previousUrl)
  }
  generatedVectorPreview.src = previewObjectUrl
  generatedVectorPreview.hidden = false
  if (firstVectorFrame) animateEntrance(generatedVectorPreview)
  generatedPreview.hidden = true
  generatedEmpty.hidden = true
  updateControls()
}

function assembleSvg(): void {
  if (!svgHeader || svgFragments.length === 0) return
  renderVectorPreview()
}

function drawBackground(): void {
  if (!selectedTarget || !selectedBackground) return
  const { width, height } = selectedTarget
  generatedPreview.width = width
  generatedPreview.height = height
  const context = generatedPreview.getContext('2d')
  if (!context) return

  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = selectedBackground.r
    pixels[offset + 1] = selectedBackground.g
    pixels[offset + 2] = selectedBackground.b
    pixels[offset + 3] = 255
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0)
  generatedEmpty.hidden = true
  generatedVectorPreview.hidden = true
  generatedPreview.hidden = false
}

function setRenderProgress(value: number | null): void {
  if (value === null) {
    renderProgressBadge.hidden = true
    generatedFrame.classList.remove('has-render-progress')
    renderProgressBadge.setAttribute('aria-valuenow', '0')
    renderProgressRing.style.strokeDashoffset = String(2 * Math.PI * 18)
    renderProgressLabel.textContent = '0%'
    return
  }

  const percentage = Math.max(0, Math.min(100, Math.round(value)))
  const circumference = 2 * Math.PI * 18
  renderProgressBadge.hidden = false
  generatedFrame.classList.add('has-render-progress')
  renderProgressBadge.setAttribute('aria-valuenow', String(percentage))
  renderProgressRing.style.strokeDashoffset = String(circumference * (1 - percentage / 100))
  renderProgressLabel.textContent = `${percentage}%`
}

function restartWorker(): void {
  worker?.terminate()
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  workerReady = false
  workerStatus.textContent = 'CONNECTING WORKER'
  worker.addEventListener('message', handleWorkerMessage)
  worker.addEventListener('error', () => {
    workerReady = false
    runState = 'idle'
    workerStatus.textContent = 'WORKER UNAVAILABLE'
    setStatus('The image worker stopped. Reload the page to try again.', true)
    updateControls()
  })
  updateControls()
}

function resetProgress(): void {
  setRenderProgress(null)
  const total = Number(shapeCount.value)
  shapeProgress.textContent = `TRIANGLES · 0 / ${total}`
  generationState.textContent = selectedTarget ? 'Ready to generate' : 'Waiting for an image'
  scoreValue.textContent = 'SCORE · —'
  frameStamp.textContent = '0 SHAPES'
}

function showReadyToRender(): void {
  generatedPreview.hidden = true
  generatedVectorPreview.hidden = true
  generatedEmpty.hidden = false
  generatedStartButton.hidden = false
  generatedEmptyTitle.textContent = 'Ready to render'
  generatedEmptyCopy.textContent = 'Start generation to build a faceted version of your photo.'
}

async function displayImage(file: File): Promise<void> {
  const requestId = ++loadRequest
  loading = true
  if (runState === 'running' || runState === 'pausing' || runState === 'paused') {
    restartWorker()
  }
  runState = 'idle'
  clearSvg()
  setStatus('Preparing working image…')
  updateControls()

  try {
    const loaded = await loadImage(file, Number(workSize.value))
    if (requestId !== loadRequest) {
      URL.revokeObjectURL(loaded.sourceUrl)
      return
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    sourceUrl = loaded.sourceUrl
    selectedFile = file
    sourceImage.src = sourceUrl
    sourceImage.alt = file.name
    sourceImage.hidden = false
    animateEntrance(sourceImage)
    sourceEmpty.hidden = true
    sourceStamp.hidden = false
    comparison.classList.remove('is-empty')
    dismissIntro()
    sourceDimensions.textContent = `SOURCE · ${loaded.sourceWidth} × ${loaded.sourceHeight} PX`
    sourceName.textContent = file.name
    projectName.textContent = file.name
    workingDimensions.textContent = `${loaded.imageData.width} × ${loaded.imageData.height} WORKING`
    generatedFrame.setAttribute('aria-label', `Geometric render of ${file.name}`)
    choosePhotoButton.firstChild!.textContent = 'Replace photo '

    const average = averageColor(loaded.imageData)
    selectedBackground = { ...average, a: 255 }
    selectedTarget = {
      width: loaded.imageData.width,
      height: loaded.imageData.height,
      data: loaded.imageData.data.slice(),
    }
    showReadyToRender()
    resetProgress()
    runState = 'idle'
    setStatus('Image ready · start generation')
  } catch (error) {
    if (requestId !== loadRequest) return
    setStatus(error instanceof Error ? error.message : 'Could not load this image.', true)
  } finally {
    if (requestId === loadRequest) {
      loading = false
      updateControls()
    }
  }
}

function startRun(): void {
  if (!selectedTarget || !selectedBackground || !workerReady || loading) return
  const total = Number(shapeCount.value)
  runState = 'running'
  clearSvg()
  resetProgress()
  generationState.textContent = 'Searching for first shape…'
  setStatus('Building image · search running in worker')
  drawBackground()
  setRenderProgress(0)
  updateControls()

  const request: WorkerRequest = {
    type: 'start',
    target: { ...selectedTarget, data: selectedTarget.data.slice() },
    config: {
      shapeCount: total,
      alpha: 128,
      randomTrials: 100,
      maxAge: 40,
      restarts: 2,
      outputSize: Number(outputSize.value),
      background: selectedBackground,
    },
  }
  worker.postMessage(request)
}

function handlePrimaryAction(): void {
  if (runState === 'paused') {
    worker.postMessage({ type: 'resume' } satisfies WorkerRequest)
  } else if (runState === 'running') {
    runState = 'pausing'
    setStatus('Pausing after current search batch…')
    worker.postMessage({ type: 'pause' } satisfies WorkerRequest)
    updateControls()
  } else {
    startRun()
  }
}

function resetRun(): void {
  if (!selectedTarget) return
  restartWorker()
  runState = 'idle'
  clearSvg()
  resetProgress()
  showReadyToRender()
  setStatus('Image reset · ready to generate')
  updateControls()
}

function downloadBlob(blob: Blob, extension: 'svg' | 'png'): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${selectedFile?.name.replace(/\.[^.]+$/, '') || 'primitify'}.${extension}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function createPngBlob(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('The generated SVG has no exportable dimensions.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not create an export canvas.')
    context.drawImage(image, 0, 0)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('The browser could not encode the PNG.'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function downloadCurrentImage(): Promise<void> {
  if (!currentSvg || exporting) return
  exporting = true
  updateControls()
  const format = exportFormat.value

  try {
    const blob = format === 'png'
      ? await createPngBlob(currentSvg)
      : new Blob([currentSvg], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(blob, format === 'png' ? 'png' : 'svg')
    setStatus(`${format.toUpperCase()} export ready`)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}.`, true)
  } finally {
    exporting = false
    updateControls()
  }
}

function handleWorkerMessage({ data }: MessageEvent<WorkerEvent>): void {
  switch (data.type) {
    case 'ready':
      workerReady = true
      workerStatus.textContent = 'WORKER READY'
      updateControls()
      break
    case 'runStarted':
      svgHeader = data.svgHeader
      svgFooter = data.svgFooter
      svgFragments = []
      currentSvg = ''
      break
    case 'preview': {
      const context = generatedPreview.getContext('2d')
      if (!context) return
      generatedPreview.width = data.width
      generatedPreview.height = data.height
      context.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), 0, 0)
      generatedPreview.hidden = false
      generatedEmpty.hidden = true
      break
    }
    case 'progress': {
      const percentage = Math.round((data.shapeIndex / data.shapeCount) * 100)
      shapeProgress.textContent = `TRIANGLES · ${data.shapeIndex} / ${data.shapeCount}`
      generationState.textContent = 'Improving composition'
      scoreValue.textContent = `SCORE · ${data.score.toFixed(4)}`
      frameStamp.textContent = `${data.shapeIndex} SHAPES`
      setRenderProgress(percentage)
      setStatus(`Building image · ${data.shapeIndex} of ${data.shapeCount} shapes`)
      break
    }
    case 'shapeAdded':
      svgFragments[data.index - 1] = data.svgFragment
      assembleSvg()
      break
    case 'paused':
      runState = 'paused'
      generationState.textContent = 'Generation paused'
      setStatus(`Paused · ${shapeProgress.textContent?.replace('TRIANGLES · ', '')} shapes`)
      updateControls()
      break
    case 'resumed':
      runState = 'running'
      generationState.textContent = 'Improving composition'
      setStatus('Building image · search resumed')
      updateControls()
      break
    case 'done':
      runState = 'done'
      currentSvg = data.svg
      scoreValue.textContent = `SCORE · ${data.finalScore.toFixed(4)}`
      generationState.textContent = 'Composition complete'
      setRenderProgress(100)
      setStatus('Generation complete · SVG ready to export')
      updateControls()
      break
    case 'aborted':
      runState = 'idle'
      updateControls()
      break
    case 'error':
      runState = 'idle'
      generationState.textContent = 'Generation stopped'
      setRenderProgress(null)
      if (selectedTarget) showReadyToRender()
      setStatus(data.message, true)
      updateControls()
      break
    case 'pong':
      break
  }
}

function choosePhoto(): void {
  fileInput.click()
}

choosePhotoButton.addEventListener('click', choosePhoto)
emptyChoosePhotoButton.addEventListener('click', choosePhoto)
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files ?? []
  fileInput.value = ''
  if (file) void displayImage(file)
})
workSize.addEventListener('change', () => {
  if (selectedFile) void displayImage(selectedFile)
  else workingDimensions.textContent = `WORKING SIZE · ${workSize.value} PX MAX`
})
shapeCount.addEventListener('change', () => {
  if (runState === 'done') resetRun()
  else resetProgress()
})
startButton.addEventListener('click', handlePrimaryAction)
generatedStartButton.addEventListener('click', handlePrimaryAction)
resetButton.addEventListener('click', resetRun)
exportButton.addEventListener('click', () => void downloadCurrentImage())
window.addEventListener('beforeunload', () => {
  worker.terminate()
  if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
})

restartWorker()
resetProgress()