import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { DisputeMatchV2Dto } from '../../dto/dispute-match-v2.dto';
import { MatchDisputeReasonCode } from '../../enums/match-dispute-reason-code.enum';

function validatePayload(payload: Record<string, unknown>): ValidationError[] {
  const instance = plainToInstance(DisputeMatchV2Dto, payload);
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

describe('DisputeMatchV2Dto', () => {
  it('requires reasonCode', () => {
    const errors = validatePayload({ message: 'wrong players' });

    expect(flattenErrors(errors)).toContain('reasonCode');
  });

  it('rejects legacy reason field drift', () => {
    const errors = validatePayload({
      reason: 'WRONG_SCORE',
      reasonCode: MatchDisputeReasonCode.WRONG_SCORE,
    });

    expect(flattenErrors(errors)).toContain('reason');
  });
});
