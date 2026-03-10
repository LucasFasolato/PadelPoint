import { MatchMessageResponseDto } from '../dto/match-message-response.dto';
import { MatchMessage } from '../entities/match-message.entity';

export function mapEntityToMatchMessageResponse(
  entity: MatchMessage,
): MatchMessageResponseDto {
  return {
    id: entity.id,
    senderUserId: entity.senderUserId,
    message: entity.message,
    createdAt: entity.createdAt.toISOString(),
  };
}
