import { Model } from './primitive/model'
import { SeededRandom } from './primitive/rng'
import type { WorkerEvent, WorkerRequest } from './types'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerEvent, transfer?: Transferable[]) => void
}

let running = false
let paused = false
let abortRequested = false
let pauseAnnounced = false

function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function checkpoint(): Promise<void> {
  await yieldToMessages()
  if (abortRequested) throw new Error('Run aborted.')
  if (paused && !pauseAnnounced) {
    pauseAnnounced = true
    workerScope.postMessage({ type: 'paused' })
  }
  while (paused && !abortRequested) await new Promise((resolve) => setTimeout(resolve, 25))
  if (abortRequested) throw new Error('Run aborted.')
}

async function run(
  target: Extract<WorkerRequest, { type: 'start' }>['target'],
  config: Extract<WorkerRequest, { type: 'start' }>['config'],
): Promise<void> {
  abortRequested = false
  paused = false
  pauseAnnounced = false
  running = true

  try {
    const model = new Model(
      target.data,
      target.width,
      target.height,
      config.background,
      new SeededRandom(),
    )
    const svgParts = model.svgParts(config.outputSize)
    workerScope.postMessage({
      type: 'runStarted',
      svgHeader: svgParts.header,
      svgFooter: svgParts.footer,
    })

    for (let shapeIndex = 1; shapeIndex <= config.shapeCount; shapeIndex += 1) {
      await checkpoint()
      const result = await model.step(
        config.alpha,
        {
          randomTrials: config.randomTrials,
          maxAge: config.maxAge,
          restarts: config.restarts,
        },
        checkpoint,
      )
      if (abortRequested) throw new Error('Run aborted.')

      const preview = model.current.slice()
      workerScope.postMessage({
        type: 'preview',
        width: model.width,
        height: model.height,
        buffer: preview.buffer,
      }, [preview.buffer])
      workerScope.postMessage({
        type: 'progress',
        shapeIndex,
        shapeCount: config.shapeCount,
        score: result.score,
        evaluations: result.evaluations,
      })
      for (let index = shapeIndex - result.shapesAdded; index < shapeIndex; index += 1) {
        workerScope.postMessage({
          type: 'shapeAdded',
          index: index + 1,
          svgFragment: model.svgFragment(index),
        })
      }
    }

    workerScope.postMessage({
      type: 'done',
      finalScore: model.score,
      svg: model.toSVG(config.outputSize),
    })
  } catch (error) {
    if (abortRequested) {
      workerScope.postMessage({ type: 'aborted' })
    } else {
      workerScope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'The image run failed.',
      })
    }
  } finally {
    running = false
    paused = false
    pauseAnnounced = false
    abortRequested = false
  }
}

workerScope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'ping':
      workerScope.postMessage({ type: 'pong', sentAt: data.sentAt })
      break
    case 'start':
      if (running) {
        workerScope.postMessage({ type: 'error', message: 'A run is already in progress.' })
      } else {
        void run(data.target, data.config)
      }
      break
    case 'pause':
      if (running) paused = true
      break
    case 'resume':
      if (running && paused) {
        paused = false
        pauseAnnounced = false
        workerScope.postMessage({ type: 'resumed' })
      }
      break
    case 'abort':
      abortRequested = true
      paused = false
      break
  }
}

workerScope.postMessage({ type: 'ready' })