import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECK_DRIFT_TOLERANCE_SECONDS,
  getComparableDuration,
  getSyncedDeckTime,
  shouldCorrectDeckDrift,
} from './integratedComparatorModel.js';

test('uses the shorter finite deck duration', () => {
  assert.equal(getComparableDuration(125.5, 123.25), 123.25);
  assert.equal(getComparableDuration(Number.NaN, 42), 42);
  assert.equal(getComparableDuration(Number.NaN, Number.POSITIVE_INFINITY), 0);
});

test('applies nudge while keeping the synced deck time in range', () => {
  assert.equal(getSyncedDeckTime(10, 25, 30), 10.025);
  assert.equal(getSyncedDeckTime(0.02, -50, 30), 0);
  assert.equal(getSyncedDeckTime(29.98, 50, 30), 30);
});

test('corrects only drift beyond the playback tolerance', () => {
  assert.equal(shouldCorrectDeckDrift(10, 10 + DECK_DRIFT_TOLERANCE_SECONDS), false);
  assert.equal(shouldCorrectDeckDrift(10, 10.076), true);
});
