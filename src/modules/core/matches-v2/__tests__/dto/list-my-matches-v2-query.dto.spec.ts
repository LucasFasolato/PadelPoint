import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { ListMyMatchesV2QueryDto } from '../../dto/list-my-matches-v2-query.dto';
import { MatchStatus } from '../../enums/match-status.enum';

function validatePayload(payload: Record<string, unknown>): ValidationError[] {
  const instance = plainToInstance(ListMyMatchesV2QueryDto, payload);
  return validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function flattenErrors(
  errors: ValidationError[],
  parentPath?: string,
): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const ownMessages = error.constraints
      ? Object.keys(error.constraints).map(() => path)
      : [];
    const childMessages = error.children
      ? flattenErrors(error.children, path)
      : [];
    return [...ownMessages, ...childMessages];
  });
}

describe('ListMyMatchesV2QueryDto', () => {
  it('rejects out-of-range limit', () => {
    const errors = validatePayload({ limit: 51 });

    expect(flattenErrors(errors)).toContain('limit');
  });

  it('rejects invalid status', () => {
    const errors = validatePayload({ status: 'BROKEN_STATUS' });

    expect(flattenErrors(errors)).toContain('status');
  });

  it('rejects invalid leagueId uuid', () => {
    const errors = validatePayload({
      status: MatchStatus.CONFIRMED,
      leagueId: 'not-a-uuid',
    });

    expect(flattenErrors(errors)).toContain('leagueId');
  });
});
