import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetDto {
  @ApiProperty({ example: 6 })
  a!: number;

  @ApiProperty({ example: 4 })
  b!: number;

  @ApiPropertyOptional({
    example: 7,
    description: 'Optional tiebreak games won by team A in this set',
  })
  tbA?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Optional tiebreak games won by team B in this set',
  })
  tbB?: number;
}

export class ScoreDto {
  @ApiProperty({
    example: '6-4 6-4',
    description: 'Human readable score summary',
  })
  summary!: string;

  @ApiProperty({ type: [SetDto] })
  sets!: SetDto[];
}
