import { ApiProperty } from '@nestjs/swagger';
import { PlayerStrength } from '../enums/player-strength.enum';

export class CreateMatchEndorsementResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ format: 'uuid' })
  fromUserId!: string;

  @ApiProperty({ format: 'uuid' })
  toUserId!: string;

  @ApiProperty({
    isArray: true,
    enum: PlayerStrength,
    minItems: 1,
    maxItems: 2,
  })
  strengths!: PlayerStrength[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
