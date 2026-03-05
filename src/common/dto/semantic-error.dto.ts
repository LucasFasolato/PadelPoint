import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SemanticErrorDto {
  @ApiProperty({ example: 'CITY_REQUIRED' })
  code!: string;

  @ApiProperty({ example: 'Set your city to use competitive features' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Optional context payload to make the error actionable.',
    example: { field: 'cityId' },
  })
  details?: unknown;
}

export type SemanticError = {
  code: string;
  message: string;
  details?: unknown;
};
