export const DECK_DRIFT_TOLERANCE_SECONDS = 0.075;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getComparableDuration(...durations) {
  const finiteDurations = durations.filter(duration => Number.isFinite(duration) && duration >= 0);
  return finiteDurations.length > 0 ? Math.min(...finiteDurations) : 0;
}

export function getSyncedDeckTime(
  sourceTime,
  nudgeMilliseconds,
  deckDuration = Number.MAX_SAFE_INTEGER,
) {
  const maxTime = Number.isFinite(deckDuration) ? Math.max(0, deckDuration) : Number.MAX_SAFE_INTEGER;
  return clamp(sourceTime + nudgeMilliseconds / 1000, 0, maxTime);
}

export function shouldCorrectDeckDrift(
  actualTime,
  expectedTime,
  tolerance = DECK_DRIFT_TOLERANCE_SECONDS,
) {
  return Math.abs(actualTime - expectedTime) > tolerance;
}
