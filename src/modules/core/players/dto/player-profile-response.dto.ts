import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLAYER_PLAY_STYLE_TAGS } from '../utils/player-profile.constants';

export class PlayerLookingForResponseDto {
  @ApiProperty()
  partner!: boolean;

  @ApiProperty()
  rival!: boolean;
}

export class PlayerLocationResponseDto {
  @ApiPropertyOptional({ nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  province!: string | null;

  @ApiPropertyOptional({ nullable: true })
  country!: string | null;
}

export class PlayerProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 240 })
  bio!: string | null;

  @ApiProperty({ isArray: true, enum: PLAYER_PLAY_STYLE_TAGS })
  playStyleTags!: string[];

  @ApiProperty({ isArray: true })
  strengths!: string[];

  @ApiProperty({ type: () => PlayerLookingForResponseDto })
  lookingFor!: PlayerLookingForResponseDto;

  @ApiProperty({ type: () => PlayerLocationResponseDto })
  location!: PlayerLocationResponseDto;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

