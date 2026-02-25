import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AgendaUpdateBlockDto {
  @IsBoolean()
  blocked!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
