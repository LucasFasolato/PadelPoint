import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';

import { CLUB_ROLES_KEY } from './club-roles.decorator';
import { ClubMember } from './club-member.entity';
import { ClubMemberRole } from './enums/club-member-role.enum';
import { UserRole } from '../users/user-role.enum';
import { Court } from '../courts/court.entity'; // 👈 ajustá path

type AuthUser = { userId: string; email: string; role: UserRole };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function extractAuthUser(req: Request): AuthUser | null {
  const u = (req as unknown as { user?: unknown }).user;
  if (!isRecord(u)) return null;

  const userId = getString(u, 'userId');
  const email = getString(u, 'email');
  const roleStr = getString(u, 'role');

  if (!userId || !email || !roleStr) return null;
  return { userId, email, role: roleStr as UserRole };
}

function extractClubId(req: Request): string | null {
  const body = (req as unknown as { body?: unknown }).body;

  return (
    getString(req.params, 'clubId') ??
    getString(req.query, 'clubId') ??
    getString(body, 'clubId') ??
    null
  );
}

function extractCourtId(req: Request): string | null {
  const body = (req as unknown as { body?: unknown }).body;

  return (
    getString(req.params, 'courtId') ??
    getString(req.query, 'courtId') ??
    getString(body, 'courtId') ??
    null
  );
}

@Injectable()
export class ClubAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ClubMember)
    private readonly clubMembersRepo: Repository<ClubMember>,
    @InjectRepository(Court)
    private readonly courtsRepo: Repository<Court>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const user = extractAuthUser(req);
    if (!user) throw new ForbiddenException('No auth user');

    // PLATFORM ADMIN bypass
    if (user.role === UserRole.ADMIN) return true;

    let clubId = extractClubId(req);

    // 🔑 Si no hay clubId, intentamos resolverlo desde courtId
    if (!clubId) {
      const courtId = extractCourtId(req);
      if (courtId) {
        const court = await this.courtsRepo.findOne({
          where: { id: courtId },
          relations: ['club'],
        });
        if (!court) throw new BadRequestException('Court not found');
        clubId = court.club.id;
      }
    }

    if (!clubId) {
      throw new BadRequestException('clubId or courtId is required');
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<ClubMemberRole[]>(CLUB_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const membership = await this.clubMembersRepo.findOne({
      where: { userId: user.userId, clubId, active: true },
    });

    if (!membership) throw new ForbiddenException('Not a member of this club');

    if (requiredRoles.length === 0) return true;

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient club role');
    }

    return true;
  }
}
