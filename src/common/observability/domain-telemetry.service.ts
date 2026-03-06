import { Injectable, Logger } from '@nestjs/common';
import { logStructured } from './structured-log.util';

export type DomainTelemetryEvent =
  | 'league_match_reported'
  | 'league_match_confirmed'
  | 'league_match_rejected'
  | 'league_pending_confirmation_fetched'
  | 'inbox_pending_confirmation_opened'
  | 'league_standings_recomputed'
  | 'league_standings_snapshot_persisted'
  | 'ranking_intelligence_fetched'
  | 'suggested_rivals_fetched'
  | 'ranking_movement_feed_fetched';

export type DomainTelemetryPayload = {
  requestId?: string | null;
  userId?: string | null;
  leagueId?: string | null;
  matchId?: string | null;
  confirmationId?: string | null;
  durationMs?: number | null;
  outcome?: string | null;
  [key: string]: unknown;
};

@Injectable()
export class DomainTelemetryService {
  private readonly logger = new Logger(DomainTelemetryService.name);

  track(event: DomainTelemetryEvent, payload: DomainTelemetryPayload): void {
    logStructured(this.logger, 'log', {
      event: 'domain.telemetry',
      domainEvent: event,
      ...payload,
    });
  }
}
