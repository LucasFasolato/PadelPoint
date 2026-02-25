import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum DisputeResolution {
  CONFIRM_AS_IS = 'confirm_as_is',
  VOID_MATCH = 'void_match',
}

export class ResolveDisputeDto {
  @IsEnum(DisputeResolution)
  resolution!: DisputeResolution;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
