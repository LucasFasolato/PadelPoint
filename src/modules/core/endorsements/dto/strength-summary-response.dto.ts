import { ApiProperty } from '@nestjs/swagger';
import { PlayerStrength } from '../enums/player-strength.enum';

export class StrengthSummaryItemDto {
  @ApiProperty({ enum: PlayerStrength, enumName: 'player_strength_enum' })
  strength!: PlayerStrength;

  @ApiProperty()
  count!: number;

  @ApiProperty({ description: 'Integer percentage 0..100' })
  percent!: number;
}

export class StrengthSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  days!: number;

  @ApiProperty()
  totalVotes!: number;

  @ApiProperty({ type: () => StrengthSummaryItemDto, isArray: true })
  strengths!: StrengthSummaryItemDto[];
}
