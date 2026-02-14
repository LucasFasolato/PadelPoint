import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/roles.guard';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    createIntent: jest.Mock;
    getIntent: jest.Mock;
    findByReference: jest.Mock;
    listAdminIntents: jest.Mock;
    simulateSuccess: jest.Mock;
    simulateFailure: jest.Mock;
    expirePendingIntentsNow: jest.Mock;
  };

  beforeEach(async () => {
    paymentsService = {
      createIntent: jest.fn(),
      getIntent: jest.fn(),
      findByReference: jest.fn().mockResolvedValue([]),
      listAdminIntents: jest.fn(),
      simulateSuccess: jest.fn(),
      simulateFailure: jest.fn(),
      expirePendingIntentsNow: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: paymentsService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        { provide: RolesGuard, useValue: { canActivate: jest.fn(() => true) } },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('calls admin list with query', async () => {
    const query = { status: 'PENDING', limit: 10 };
    await controller.listIntents(query as any);
    expect(paymentsService.listAdminIntents).toHaveBeenCalledWith(query);
  });

  it('calls findByReference for non-admin route', async () => {
    const req = { user: { userId: 'user-1' } } as any;
    await controller.findByReference(req, 'RESERVATION', 'res-1');
    expect(paymentsService.findByReference).toHaveBeenCalledWith({
      userId: 'user-1',
      referenceType: 'RESERVATION',
      referenceId: 'res-1',
    });
  });
});
