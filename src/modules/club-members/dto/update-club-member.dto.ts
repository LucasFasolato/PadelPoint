import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ClubMemberRole } from '../enums/club-member-role.enum';

export class UpdateClubMemberDto {
  @IsOptional()
  @IsEnum(ClubMemberRole)
  role?: ClubMemberRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
