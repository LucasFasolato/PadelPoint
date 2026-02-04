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
import { AdminListPaymentIntentsDto } from './dto/admin-list-payment-intents.dto';
import { PaymentIntent } from './payment-intent.entity';

import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/roles.guard';
import { Roles } from '../modules/auth/roles.decorator';
import { UserRole } from '../modules/users/user-role.enum';

type AuthUser = { userId: string; email: string; role: string };

type PaymentIntentPublicResponse = {
  id: string;
  userId: string | null;
  amount: string;
  currency: string;
  status: string; // lower-case
  referenceType: string;
  referenceId: string;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  receiptToken: string | null;
};

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private serializeIntent(
    intent: PaymentIntent & { receiptToken?: string | null },
  ): PaymentIntentPublicResponse {
    return {
      id: intent.id,
      userId: intent.userId ?? null,
      amount: intent.amount,
      currency: intent.currency,
      status: String(intent.status).toLowerCase(),
      referenceType: String(intent.referenceType),
      referenceId: intent.referenceId,
      expiresAt: intent.expiresAt ? intent.expiresAt.toISOString() : null,
      paidAt: intent.paidAt ? intent.paidAt.toISOString() : null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
      receiptToken: intent.receiptToken ?? null,
    };
  }

  private serializeIntentResult(result: {
    ok: boolean;
    intent: PaymentIntent;
    receiptToken?: string | null;
  }) {
    return {
      ok: result.ok,
      intent: {
        ...this.serializeIntent(result.intent),
        receiptToken: result.receiptToken ?? null,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('intents')
  async createIntent(@Req() req: Request, @Body() dto: CreatePaymentIntentDto) {
    const user = req.user as AuthUser;
    const intent = await this.paymentsService.createIntent({
      userId: user.userId,
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
      reservationId: dto.reservationId,
      currency: dto.currency,
      checkoutToken: dto.checkoutToken,
    });
    return this.serializeIntent(intent);
  }

  @UseGuards(JwtAuthGuard)
  @Post('intents/:id/simulate-success')
  async simulateSuccess(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const user = req.user as AuthUser;
    const result = await this.paymentsService.simulateSuccess({
      userId: user.userId,
      intentId: id,
      checkoutToken: dto.checkoutToken,
    });
    return this.serializeIntentResult(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('intents/:id/simulate-failure')
  async simulateFailure(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const user = req.user as AuthUser;
    const result = await this.paymentsService.simulateFailure({
      userId: user.userId,
      intentId: id,
      checkoutToken: dto.checkoutToken,
    });
    return this.serializeIntentResult(result);
  }

  @UseGuards(JwtAuthGuard)
  @Get('intents/:id')
  async getIntent(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    const intent = await this.paymentsService.getIntent({
      userId: user.userId,
      intentId: id,
    });
    return this.serializeIntent(intent);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('intents')
  listIntents(@Query() query: AdminListPaymentIntentsDto) {
    return this.paymentsService.listAdminIntents(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('intents/by-reference')
  async findByReference(
    @Req() req: Request,
    @Query('referenceType') referenceType?: string,
    @Query('referenceId') referenceId?: string,
  ) {
    const user = req.user as AuthUser;
    const intents = await this.paymentsService.findByReference({
      userId: user.userId,
      referenceType,
      referenceId,
    });
    return intents.map((intent) => this.serializeIntent(intent));
  }

  // Public: create intent
  @Post('public/intents')
  async createIntentPublic(@Body() dto: CreatePaymentIntentDto) {
    const intent = await this.paymentsService.createIntent({
      userId: 'public',
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
      reservationId: dto.reservationId,
      currency: dto.currency,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
    return this.serializeIntent(intent);
  }

  @Post('webhook/mock')
  webhookMock(@Body() dto: MockPaymentWebhookDto) {
    return this.paymentsService.handleMockWebhook({
      providerEventId: dto.providerEventId,
      intentId: dto.intentId,
      status: dto.status,
    });
  }

  @Post('public/intents/:id/simulate-success')
  async simulateSuccessPublic(
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const result = await this.paymentsService.simulateSuccess({
      userId: 'public',
      intentId: id,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
    return this.serializeIntentResult(result);
  }

  @Post('public/intents/:id/simulate-failure')
  async simulateFailurePublic(
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    const result = await this.paymentsService.simulateFailure({
      userId: 'public',
      intentId: id,
      checkoutToken: dto.checkoutToken,
      publicCheckout: true,
    });
    return this.serializeIntentResult(result);
  }
}
