import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UserNotificationsQueryDto {
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
