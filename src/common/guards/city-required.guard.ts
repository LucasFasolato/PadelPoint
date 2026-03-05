import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_CITY_REQUIRED_KEY } from '@common/decorators/skip-city-required.decorator';
import { semanticError } from '@common/errors/semantic-error.util';

export const CITY_REQUIRED_ERROR = semanticError(
  'CITY_REQUIRED',
  'Set your city to use competitive features',
  { field: 'cityId' },
);

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

    throw new HttpException(CITY_REQUIRED_ERROR, HttpStatus.FORBIDDEN);
  }
}
