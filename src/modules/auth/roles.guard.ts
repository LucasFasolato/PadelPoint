import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from '../users/user-role.enum';

type AuthUser = { userId: string; email: string; role: UserRole };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;

    if (!user) throw new ForbiddenException('No auth user');
    if (!requiredRoles.includes(user.role))
      throw new ForbiddenException('Insufficient role');

    return true;
  }
}
