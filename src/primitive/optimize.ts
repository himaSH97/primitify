import type { AnnealableState } from './state'

export type YieldControl = () => Promise<void>

export async function hillClimb<TState extends AnnealableState<TState>>(
  initial: TState,
  maxAge: number,
  yieldControl: YieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<TState> {
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) {
    throw new RangeError('Hill-climb age must be a nonnegative integer.')
  }

  let state = initial.copy()
  let bestState = state.copy()
  let bestEnergy = state.energy()

  let mutations = 0
  for (let age = 0; age < maxAge; age += 1) {
    const previous = state.doMove()
    const energy = state.energy()
    mutations += 1
    if (energy >= bestEnergy) {
      state.undoMove(previous)
    } else {
      bestEnergy = energy
      bestState = state.copy()
      age = -1
    }
    if (mutations % 8 === 0) await yieldControl()
  }

  return bestState
}