import { IsIn } from 'class-validator';
import { LeagueRole } from '../league-role.enum';

export class UpdateMemberRoleDto {
  @IsIn([LeagueRole.ADMIN, LeagueRole.MEMBER])
  role!: LeagueRole.ADMIN | LeagueRole.MEMBER;
}
