import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MeReservationsController } from './me-reservations.controller';
import { ReservationsService } from './reservations.service';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';

describe('MeReservationsController', () => {
  let controller: MeReservationsController;
  let reservationsService: {
    listMyReservations: jest.Mock;
    createReceiptLinkForUser: jest.Mock;
  };

  beforeEach(async () => {
    reservationsService = {
      listMyReservations: jest.fn(),
      createReceiptLinkForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeReservationsController],
      providers: [{ provide: ReservationsService, useValue: reservationsService }],
    }).compile();

    controller = module.get<MeReservationsController>(MeReservationsController);
  });

  it('allows PLAYER access via /me/reservations', async () => {
    reservationsService.listMyReservations.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });

    const req = {
      user: { userId: 'u1', email: 'player@test.com', role: UserRole.PLAYER },
    } as any;

    const result = await controller.listMine(req, {});

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });
  });

  it('rejects ADMIN role via RolesGuard for /me/reservations', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => controller.listMine,
      getClass: () => MeReservationsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.ADMIN },
        }),
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes page/limit to service', async () => {
    reservationsService.listMyReservations.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      limit: 5,
    });

    const req = {
      user: { userId: 'u1', email: 'player@test.com', role: UserRole.PLAYER },
    } as any;

    await controller.listMine(req, { page: '2', limit: '5' });

    expect(reservationsService.listMyReservations).toHaveBeenCalledWith({
      email: 'player@test.com',
      page: 2,
      limit: 5,
    });
  });

  it('creates receipt link for player reservation', async () => {
    reservationsService.createReceiptLinkForUser.mockResolvedValue({
      url: '/checkout/success/res-1?receiptToken=token-1',
    });

    const req = {
      user: { userId: 'u1', email: 'player@test.com', role: UserRole.PLAYER },
    } as any;

    const result = await controller.getReceiptLink(req, 'res-1');

    expect(reservationsService.createReceiptLinkForUser).toHaveBeenCalledWith({
      reservationId: 'res-1',
      email: 'player@test.com',
    });
    expect(result).toEqual({
      url: '/checkout/success/res-1?receiptToken=token-1',
    });
  });

  it('rejects ADMIN role via RolesGuard for receipt link', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => controller.getReceiptLink,
      getClass: () => MeReservationsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.ADMIN },
        }),
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
