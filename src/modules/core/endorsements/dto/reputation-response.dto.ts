import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerStrength } from '../enums/player-strength.enum';

export class CommitmentBadgeDto {
  @ApiProperty()
  earned!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['ENDORSEMENTS_30D', 'RATIO_30D'],
  })
  reason!: 'ENDORSEMENTS_30D' | 'RATIO_30D' | null;

  @ApiProperty({ description: 'Range 0..1' })
  ratio30d!: number;

  @ApiProperty()
  endorsementsGiven30d!: number;

  @ApiProperty()
  competitiveConfirmedMatches30d!: number;
}

export class TopReceivedStrengthDto {
  @ApiProperty({ enum: PlayerStrength, enumName: 'player_strength_enum' })
  strength!: PlayerStrength;

  @ApiProperty()
  count!: number;

  @ApiProperty({ description: 'Integer percentage 0..100' })
  percent!: number;
}

export class ReputationInsightsDto {
  @ApiProperty()
  unlocked!: boolean;

  @ApiProperty()
  givenCountLifetime!: number;

  @ApiPropertyOptional({ nullable: true, type: () => TopReceivedStrengthDto })
  topReceivedStrength!: TopReceivedStrengthDto | null;

  @ApiProperty()
  message!: string;
}

export class ReputationResponseDto {
  @ApiProperty({ type: () => CommitmentBadgeDto })
  commitmentBadge!: CommitmentBadgeDto;

  @ApiProperty({ type: () => ReputationInsightsDto })
  insights!: ReputationInsightsDto;
}
