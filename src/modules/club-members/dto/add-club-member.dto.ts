import { IsEmail, IsEnum } from 'class-validator';
import { ClubMemberRole } from '../enums/club-member-role.enum';

export class AddClubMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(ClubMemberRole)
  role!: ClubMemberRole;
}
