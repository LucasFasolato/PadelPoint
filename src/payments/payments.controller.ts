// src/payments/payments.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { SimulatePaymentDto } from './dto/simulate-payment.dto';
import { MockPaymentWebhookDto } from './dto/mock-webhook.dto';

import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';

type AuthUser = { userId: string; email: string; role: string };

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ---------------------------
  // MODO A: con JWT (admins/users)
  // ---------------------------
  @UseGuards(JwtAuthGuard)
  @Post('intents')
  createIntent(@Req() req: Request, @Body() dto: CreatePaymentIntentDto) {
    const user = req.user as AuthUser;
    return this.paymentsService.createIntent({
      userId: user.userId,
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
      reservationId: dto.reservationId,
      currency: dto.currency,
      checkoutToken: dto.checkoutToken, // opcional
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('intents/:id/simulate-success')
  simulateSuccess(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const user = req.user as AuthUser;
    return this.paymentsService.simulateSuccess({
      userId: user.userId,
      intentId: id,
      checkoutToken: dto.checkoutToken,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('intents/:id/simulate-failure')
  simulateFailure(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const user = req.user as AuthUser;
    return this.paymentsService.simulateFailure({
      userId: user.userId,
      intentId: id,
      checkoutToken: dto.checkoutToken,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('intents/:id')
  getIntent(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.paymentsService.getIntent({
      userId: user.userId,
      intentId: id,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('intents')
  findByReference(
    @Req() req: Request,
    @Query('referenceType') referenceType?: string,
    @Query('referenceId') referenceId?: string,
  ) {
    const user = req.user as AuthUser;
    return this.paymentsService.findByReference({
      userId: user.userId,
      referenceType,
      referenceId,
    });
  }

  // ---------------------------
  // MODO B (PRO): Checkout público (sin login)
  // ---------------------------
  // Crear intent con checkoutToken (para RESERVATION)
  @Post('public/intents')
  createIntentPublic(@Body() dto: CreatePaymentIntentDto) {
    // userId = 'public' (no se usa para reservas guest)
    return this.paymentsService.createIntent({
      userId: 'public',
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
      reservationId: dto.reservationId,
      currency: dto.currency,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
  }

  // ---------------------------
  // Webhook mock (idempotente)
  // ---------------------------
  @Post('webhook/mock')
  webhookMock(@Body() dto: MockPaymentWebhookDto) {
    return this.paymentsService.handleMockWebhook({
      providerEventId: dto.providerEventId,
      intentId: dto.intentId,
      status: dto.status,
    });
  }

  @Post('public/intents/:id/simulate-success')
  simulateSuccessPublic(
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    return this.paymentsService.simulateSuccess({
      userId: 'public',
      intentId: id,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
  }

  @Post('public/intents/:id/simulate-failure')
  simulateFailurePublic(
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    return this.paymentsService.simulateFailure({
      userId: 'public',
      intentId: id,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
  }
}
