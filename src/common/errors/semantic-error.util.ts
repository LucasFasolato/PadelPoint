import { SemanticError } from '@common/dto/semantic-error.dto';

export function semanticError(
  code: string,
  message: string,
  details?: unknown,
): SemanticError {
  if (details === undefined) {
    return { code, message };
  }
  return { code, message, details };
}
