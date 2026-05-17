import { calculateExpectedScore, calculateNewElo, confidenceScale, calculatePreferenceModifier } from "./playlists.preferences.engine.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function round(value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function runTests() {
  assert(round(calculateExpectedScore(1000, 1000), 4) === 0.5, "Expected score for equal ratings should be 0.5");
  assert(calculateNewElo(1000, 1000, true) > 1000, "Winner should gain Elo against equal opponent");
  assert(calculateNewElo(1000, 1200, false) < 1000, "Loser should lose Elo against stronger opponent");
  assert(confidenceScale(0) === 0, "Zero battles should yield zero confidence");
  assert(confidenceScale(10) === 0.5, "Half threshold should yield half confidence");
  assert(confidenceScale(25) === 1, "Above threshold should cap confidence at 1");
  assert(round(calculatePreferenceModifier(1000, 0), 4) === 1.0, "No confidence should return neutral modifier");
  assert(calculatePreferenceModifier(1100, 20) > 1.0, "Positive Elo and full confidence should bias above neutral");
  assert(calculatePreferenceModifier(900, 20) < 1.0, "Negative Elo and full confidence should bias below neutral");

  console.log("All preference engine tests passed.");
}

runTests();
