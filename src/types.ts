export interface PixelImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface RunConfig {
  shapeCount: number
  alpha: number
  randomTrials: number
  maxAge: number
  restarts: number
  outputSize: number
  background: { r: number; g: number; b: number; a: number }
}

export type WorkerRequest =
  | { type: 'start'; target: PixelImage; config: RunConfig }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'abort' }
  | { type: 'ping'; sentAt: number }

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'progress'; shapeIndex: number; shapeCount: number; score: number; evaluations: number }
  | { type: 'preview'; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'runStarted'; svgHeader: string; svgFooter: string }
  | { type: 'shapeAdded'; index: number; svgFragment: string }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'done'; finalScore: number; svg: string }
  | { type: 'aborted' }
  | { type: 'pong'; sentAt: number }
  | { type: 'error'; message: string }