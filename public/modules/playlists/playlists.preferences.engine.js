export const PreferenceEntityType = Object.freeze({
  ARTIST: "ARTIST",
  GENRE: "GENRE",
  SUBGENRE: "SUBGENRE"
});

export const DEFAULT_ELO_RATING = 1000;
export const DEFAULT_ELO_K_FACTOR = 32;
export const PREFERENCE_CONFIDENCE_THRESHOLD = 20;
export const MAX_PREFERENCE_MODIFIER = 0.08;

export function calculateExpectedScore(currentRating, opponentRating) {
  const ratingDifference = opponentRating - currentRating;
  return 1 / (1 + Math.pow(10, ratingDifference / 400));
}

export function calculateNewElo(currentRating, opponentRating, didWin, kFactor = DEFAULT_ELO_K_FACTOR) {
  const expected = calculateExpectedScore(currentRating, opponentRating);
  const actual = didWin ? 1 : 0;
  return Math.round(currentRating + kFactor * (actual - expected));
}

export function confidenceScale(battleCount, threshold = PREFERENCE_CONFIDENCE_THRESHOLD) {
  if (typeof battleCount !== "number" || battleCount <= 0) return 0;
  return Math.min(battleCount / threshold, 1);
}

export function calculatePreferenceModifier(eloRating, battleCount, baseRating = DEFAULT_ELO_RATING) {
  if (typeof eloRating !== "number" || typeof battleCount !== "number") {
    return 1.0;
  }

  const confidence = confidenceScale(battleCount);
  const rawDelta = (eloRating - baseRating) / baseRating;
  const cappedDelta = Math.max(Math.min(rawDelta, 0.2), -0.2);
  const scaledDelta = cappedDelta * confidence * (MAX_PREFERENCE_MODIFIER / 0.2);

  return 1 + scaledDelta;
}

export function getEntityPreferenceModifier(entity) {
  if (!entity || typeof entity.elo_rating !== "number") {
    return 1.0;
  }

  return calculatePreferenceModifier(entity.elo_rating, entity.battle_count || 0);
}

export function getPreferenceScoreBreakdown({ baseScore, artistEntity, genreEntity, subgenreEntity }) {
  const artistModifier = getEntityPreferenceModifier(artistEntity);
  const genreModifier = getEntityPreferenceModifier(genreEntity);
  const subgenreModifier = getEntityPreferenceModifier(subgenreEntity);
  const finalScore = baseScore * artistModifier * genreModifier * subgenreModifier;

  return {
    baseScore,
    artistModifier,
    genreModifier,
    subgenreModifier,
    finalScore
  };
}
