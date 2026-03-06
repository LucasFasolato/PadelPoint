import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TeamDto {
  @ApiProperty({ format: 'uuid' })
  player1Id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  player2Id?: string | null;
}

export class TeamsDto {
  @ApiProperty({ type: TeamDto })
  teamA!: TeamDto;

  @ApiProperty({ type: TeamDto })
  teamB!: TeamDto;
}

export class ParticipantDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({
    description: 'Display name for UI labels. Never a raw email.',
    example: 'Lucas Fasolato',
  })
  displayName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optional avatar URL if available',
  })
  avatarUrl?: string | null;
}
