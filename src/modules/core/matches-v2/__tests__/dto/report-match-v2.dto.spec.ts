import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { ReportMatchV2Dto } from '../../dto/report-match-v2.dto';

function validatePayload(payload: Record<string, unknown>): ValidationError[] {
  const instance = plainToInstance(ReportMatchV2Dto, payload);
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

describe('ReportMatchV2Dto', () => {
  it('accepts canonical sets payload', () => {
    const errors = validatePayload({
      playedAt: '2026-03-09T21:15:00.000Z',
      sets: [
        { a: 6, b: 4 },
        { a: 7, b: 5 },
      ],
    });

    expect(errors).toEqual([]);
  });

  it('rejects empty sets', () => {
    const errors = validatePayload({ sets: [] });

    expect(flattenErrors(errors)).toContain('sets');
  });

  it('rejects invalid set item', () => {
    const errors = validatePayload({
      sets: [
        { a: 8, b: 4 },
        { a: 6, b: 3 },
      ],
    });

    expect(flattenErrors(errors)).toContain('sets.0.a');
  });

  it('rejects legacy score.sets shape', () => {
    const errors = validatePayload({
      score: {
        sets: [
          { a: 6, b: 4 },
          { a: 6, b: 2 },
        ],
      },
    });

    const paths = flattenErrors(errors);
    expect(paths).toContain('score');
    expect(paths).toContain('sets');
  });
});
