import { ApiProperty } from '@nestjs/swagger';

export class SkillRadarMetaDto {
  @ApiProperty({ minimum: 0 })
  matches30d!: number;

  @ApiProperty({ minimum: 0 })
  sampleSize!: number;

  @ApiProperty({ format: 'date-time' })
  computedAt!: string;
}

export class SkillRadarResponseDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  activity!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  momentum!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  consistency!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  dominance!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  resilience!: number;

  @ApiProperty({ type: () => SkillRadarMetaDto })
  meta!: SkillRadarMetaDto;
}
