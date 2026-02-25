import { IsIn } from 'class-validator';
import { LeagueRole } from '../league-role.enum';

export class UpdateMemberRoleDto {
  @IsIn([LeagueRole.OWNER, LeagueRole.MEMBER])
  role!: LeagueRole.OWNER | LeagueRole.MEMBER;
}
