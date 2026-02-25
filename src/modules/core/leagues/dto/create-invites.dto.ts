import { IsArray, IsEmail, IsOptional, IsUUID } from 'class-validator';

export class CreateInvitesDto {
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  userIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emails?: string[];
}
