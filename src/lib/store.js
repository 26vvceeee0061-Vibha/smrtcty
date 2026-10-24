import {
  CONTROL_DEFAULTS,
  DEFAULT_SCENARIO_ID,
} from '../data/scenarios.js';

export const DEFAULT_STATE = Object.freeze({
  scenarioId: DEFAULT_SCENARIO_ID,
  ...CONTROL_DEFAULTS,
});

/**
 * A tiny observable store. There is one canonical state object; every view is
 * rendered from a freshly derived model, so no duplicate state can go stale.
 */
export function createStore(initialState = DEFAULT_STATE) {
  let state = { ...DEFAULT_STATE, ...initialState };
  const listeners = new Set();

  function setState(patch) {
    const nextPatch = typeof patch === 'function' ? patch(state) : patch;
    if (!nextPatch) return;

    let changed = false;
    const nextState = { ...state };

    for (const [key, value] of Object.entries(nextPatch)) {
      if (!Object.is(nextState[key], value)) {
        nextState[key] = value;
        changed = true;
      }
    }

    if (!changed) return;

    state = nextState;
    for (const listener of listeners) listener(state);
  }

  return {
    getState() {
      return { ...state };
    },
    setState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      setState(DEFAULT_STATE);
    },
  };
}
