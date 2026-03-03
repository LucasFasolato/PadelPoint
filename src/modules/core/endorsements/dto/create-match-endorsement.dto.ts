import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlayerStrength } from '../enums/player-strength.enum';

export class CreateMatchEndorsementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toUserId!: string;

  @ApiProperty({
    isArray: true,
    enum: PlayerStrength,
    minItems: 1,
    maxItems: 2,
    example: [PlayerStrength.SMASH, PlayerStrength.DEFENSA],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsEnum(PlayerStrength, { each: true })
  strengths!: PlayerStrength[];
}
