import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DisputeReasonCode } from '../dispute-reason.enum';

export class DisputeMatchDto {
  @IsEnum(DisputeReasonCode)
  reasonCode!: DisputeReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
