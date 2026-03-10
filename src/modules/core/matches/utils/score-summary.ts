import { SetDto } from '../dto/score.dto';

const SET_PATTERN =
  /(\d{1,2})\s*-\s*(\d{1,2})(?:\s*\((\d{1,2})(?:\s*-\s*(\d{1,2}))?\))?/g;

export function parseScoreSummary(
  summary: string | null | undefined,
): SetDto[] {
  if (typeof summary !== 'string') return [];
  const normalized = summary.replace(/[,/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sets: SetDto[] = [];
  for (const token of normalized.matchAll(SET_PATTERN)) {
    const a = Number.parseInt(token[1] ?? '', 10);
    const b = Number.parseInt(token[2] ?? '', 10);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;

    const set: SetDto = { a, b };
    const tb1Raw = token[3];
    const tb2Raw = token[4];
    const tb1 = tb1Raw != null ? Number.parseInt(tb1Raw, 10) : Number.NaN;
    const tb2 = tb2Raw != null ? Number.parseInt(tb2Raw, 10) : Number.NaN;

    if (!Number.isNaN(tb1) && !Number.isNaN(tb2)) {
      set.tbA = tb1;
      set.tbB = tb2;
    } else if (!Number.isNaN(tb1)) {
      if (a >= b) set.tbA = tb1;
      else set.tbB = tb1;
    }

    sets.push(set);
  }

  return sets;
}

export function buildScoreSummary(
  sets: Array<Pick<SetDto, 'a' | 'b'>>,
): string {
  if (!Array.isArray(sets) || sets.length === 0) return '';
  return sets
    .filter((set) => Number.isFinite(set?.a) && Number.isFinite(set?.b))
    .map((set) => `${set.a}-${set.b}`)
    .join(' ')
    .trim();
}
