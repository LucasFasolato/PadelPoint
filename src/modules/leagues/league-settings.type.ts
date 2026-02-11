export type TieBreaker = 'points' | 'wins' | 'setsDiff' | 'gamesDiff';

export interface LeagueSettings {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  tieBreakers: TieBreaker[];
  includeSources: {
    RESERVATION: boolean;
    MANUAL: boolean;
  };
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  tieBreakers: ['points', 'wins', 'setsDiff', 'gamesDiff'],
  includeSources: { RESERVATION: true, MANUAL: true },
};
