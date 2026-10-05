import type { RandomSource } from './rng'
import type { Shape } from './shapes/shape'

export interface StateWorker {
  random: RandomSource
  energy(shape: Shape, alpha: number): number
}

export interface AnnealableState<TState> {
  energy(): number
  doMove(): TState
  undoMove(previous: TState): void
  copy(): TState
}

export class State implements AnnealableState<State> {
  alpha: number
  readonly mutateAlpha: boolean
  score = -1

  constructor(
    readonly worker: StateWorker,
    public shape: Shape,
    alpha: number,
    mutateAlpha = alpha === 0,
  ) {
    this.mutateAlpha = mutateAlpha
    this.alpha = alpha === 0 ? 128 : alpha
  }

  energy(): number {
    if (this.score < 0) this.score = this.worker.energy(this.shape, this.alpha)
    return this.score
  }

  doMove(): State {
    const previous = this.copy()
    this.shape.mutate()
    if (this.mutateAlpha) {
      this.alpha = Math.max(1, Math.min(255, this.alpha + this.worker.random.nextInt(21) - 10))
    }
    this.score = -1
    return previous
  }

  undoMove(previous: State): void {
    this.shape = previous.shape.copy()
    this.alpha = previous.alpha
    this.score = previous.score
  }

  copy(): State {
    const duplicate = new State(this.worker, this.shape.copy(), this.alpha, this.mutateAlpha)
    duplicate.score = this.score
    return duplicate
  }
}