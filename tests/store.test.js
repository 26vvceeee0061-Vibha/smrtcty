import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STATE, createStore } from '../src/lib/store.js';

test('store exposes one canonical state and notifies subscribers on change', () => {
  const store = createStore();
  const notifications = [];

  const unsubscribe = store.subscribe((state) => {
    notifications.push(state);
  });

  store.setState({ scenarioId: 'grid-lock' });
  store.setState({ scenarioId: 'grid-lock' });

  assert.equal(store.getState().scenarioId, 'grid-lock');
  assert.equal(notifications.length, 1);

  unsubscribe();
  store.setState({ demandPressure: 110 });
  assert.equal(notifications.length, 1);
  assert.equal(store.getState().demandPressure, 110);
});

test('reset restores the initial scenario and input defaults', () => {
  const store = createStore();

  store.setState({
    scenarioId: 'infrastructure-crunch',
    demandPressure: 120,
    waterAvailability: 70,
    gridCapacity: 80,
  });

  store.reset();

  assert.deepEqual(store.getState(), { ...DEFAULT_STATE });
});
