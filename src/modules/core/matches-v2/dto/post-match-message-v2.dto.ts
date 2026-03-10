import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

function normalizeRequiredTrimmedString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim();
}

export class PostMatchMessageV2Dto {
  @ApiProperty({
    maxLength: 500,
    description: 'Canonical logistical message for a match thread.',
  })
  @Transform(({ value }) => normalizeRequiredTrimmedString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message!: string;
}
