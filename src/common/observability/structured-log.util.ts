import { Logger } from '@nestjs/common';

type LogLevel = 'log' | 'warn' | 'error' | 'debug';

export function logStructured(
  logger: Logger,
  level: LogLevel,
  payload: Record<string, unknown>,
  trace?: string,
): void {
  const message = JSON.stringify(payload);
  if (level === 'error') {
    logger.error(message, trace);
    return;
  }
  logger[level](message);
}
