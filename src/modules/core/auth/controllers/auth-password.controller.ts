import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PasswordResetService } from '../services/password-reset.service';
import { PasswordResetRateLimiter } from '../guards/password-reset-rate-limiter';
import { PasswordResetRequestDto } from '../dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from '../dto/password-reset-confirm.dto';

@Controller('auth/password')
export class AuthPasswordController {
  constructor(
    private readonly passwordReset: PasswordResetService,
    private readonly rateLimiter: PasswordResetRateLimiter,
  ) {}

  /** Always returns { ok: true } — never reveals whether the email exists. */
  @Post('reset/request')
  @HttpCode(200)
  async requestReset(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const ip = req.ip ?? 'unknown';
    if (this.rateLimiter.isLimited(dto.email, ip)) {
      // Silently rate-limited — return ok without sending the email
      return { ok: true };
    }
    return this.passwordReset.requestReset(dto.email);
  }

  @Post('reset/confirm')
  @HttpCode(200)
  async confirmReset(@Body() dto: PasswordResetConfirmDto): Promise<{ ok: true }> {
    return this.passwordReset.confirmReset(dto.token, dto.newPassword);
  }
}
