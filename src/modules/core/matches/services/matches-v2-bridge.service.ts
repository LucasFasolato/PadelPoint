import { Injectable } from '@nestjs/common';
import { MatchListResponseDto } from '../../matches-v2/dto/match-list-response.dto';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';

const LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE = 50;

@Injectable()
export class MatchesV2BridgeService {
  constructor(private readonly matchQueryService: MatchQueryService) {}

  async listMyMatches(userId: string): Promise<MatchListResponseDto> {
    const items = [];
    let cursor: string | undefined;

    // Lote 6 starts with the safe read delegation path. Legacy write flows
    // still own side effects such as notifications, standings and audit.
    // Legacy `/matches/me` does not accept cursor params yet. Exhaust the
    // canonical feed so the controller can delegate reads without truncation.
    do {
      const page = await this.matchQueryService.listMyMatches(userId, {
        cursor,
        limit: LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE,
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return {
      items,
      nextCursor: null,
    };
  }
}
