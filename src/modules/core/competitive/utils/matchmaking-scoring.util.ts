import type { PlayerLocation } from '../../players/entities/player-profile.entity';

export type MatchmakingScoreInput = {
  absDiff: number;
  range: number;
  matches30d: number;
  momentum30d: number;
  candidateLocation: PlayerLocation | null;
  myLocation: PlayerLocation | null;
  candidateTags: string[];
  myTags: string[];
};

export type MatchmakingScoreBreakdown = {
  total: number;
  eloScore: number;
  activityScore: number;
  momentumScore: number;
  locationScore: number;
  tagOverlapScore: number;
};

/**
 * Composite matchmaking score (0–100).
 *
 * eloScore      0–50  : closeness in ELO
 * activityScore 0–20  : recent match activity
 * momentumScore 0–15  : ELO momentum over last 30 days
 * locationScore 0–10  : proximity to requester
 * tagOverlapScore 0–5 : play-style tag Jaccard similarity
 */
export function computeMatchmakingScore(
  input: MatchmakingScoreInput,
): MatchmakingScoreBreakdown {
  const eloScore = Math.max(
    0,
    Math.min(50, 50 - (input.absDiff / input.range) * 50),
  );

  const activityScore = (Math.min(input.matches30d, 20) / 20) * 20;

  const momentumScore = Math.max(
    0,
    Math.min(15, ((input.momentum30d + 50) / 100) * 15),
  );

  let locationScore = 0;
  if (input.myLocation && input.candidateLocation) {
    const myCity = input.myLocation.city?.trim().toLowerCase();
    const myProvince = input.myLocation.province?.trim().toLowerCase();
    const myCountry = input.myLocation.country?.trim().toLowerCase();
    const candCity = input.candidateLocation.city?.trim().toLowerCase();
    const candProvince = input.candidateLocation.province?.trim().toLowerCase();
    const candCountry = input.candidateLocation.country?.trim().toLowerCase();

    if (myCity && candCity && myCity === candCity) {
      locationScore = 10;
    } else if (myProvince && candProvince && myProvince === candProvince) {
      locationScore = 6;
    } else if (myCountry && candCountry && myCountry === candCountry) {
      locationScore = 3;
    }
  }

  const tagOverlapScore =
    computeTagJaccard(input.candidateTags, input.myTags) * 5;

  return {
    total: eloScore + activityScore + momentumScore + locationScore + tagOverlapScore,
    eloScore,
    activityScore,
    momentumScore,
    locationScore,
    tagOverlapScore,
  };
}

/** Jaccard similarity between two tag arrays (case-sensitive). Returns 0 when both are empty. */
export function computeTagJaccard(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 && tagsB.length === 0) return 0;
  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  const intersectionSize = [...setA].filter((x) => setB.has(x)).length;
  const unionSize = new Set([...tagsA, ...tagsB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
