import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchResponseDto } from './match-response.dto';

export class MatchListResponseDto {
  @ApiProperty({ type: () => MatchResponseDto, isArray: true })
  items!: MatchResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;
}
