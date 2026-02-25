export const PLAYER_PLAY_STYLE_TAGS = [
  'aggressive',
  'defensive',
  'balanced',
  'counterpuncher',
  'net-player',
  'baseline',
  'left-side',
  'right-side',
  'lobber',
  'smash-focused',
  'tactical',
  'consistent',
] as const;

export type PlayerPlayStyleTag = (typeof PLAYER_PLAY_STYLE_TAGS)[number];

export const PLAYER_PROFILE_LIMITS = {
  bioMaxLength: 240,
  maxPlayStyleTags: 10,
  maxStrengths: 8,
  maxStrengthLength: 32,
  maxLocationFieldLength: 80,
} as const;

