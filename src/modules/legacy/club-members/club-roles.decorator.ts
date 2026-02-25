import { SetMetadata } from '@nestjs/common';
import { ClubMemberRole } from './enums/club-member-role.enum';

export const CLUB_ROLES_KEY = 'club_roles';

export const ClubRoles = (...roles: ClubMemberRole[]) =>
  SetMetadata(CLUB_ROLES_KEY, roles);
