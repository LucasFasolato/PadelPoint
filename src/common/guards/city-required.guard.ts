import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_CITY_REQUIRED_KEY } from '@common/decorators/skip-city-required.decorator';

export const CITY_REQUIRED_ERROR = {
  code: 'CITY_REQUIRED',
  message: 'Set your city to use competitive features',
} as const;

@Injectable()
export class CityRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_CITY_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: { cityId?: string | null } }>();
    const cityId = req.user?.cityId;
    if (typeof cityId === 'string' && cityId.trim().length > 0) {
      return true;
    }

    throw new HttpException(CITY_REQUIRED_ERROR, HttpStatus.CONFLICT);
  }
}
