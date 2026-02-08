import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { Notification, NotificationStatus } from './notification.entity';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

describe('NotificationService', () => {
  let repo: MockRepo<Notification>;

  function buildModule(emailCfg: Record<string, any>) {
    repo = createMockRepo<Notification>();
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'email') return emailCfg;
        return undefined;
      }),
    };

    return Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getRepositoryToken(Notification), useValue: repo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
  }

  const emailData = {
    reservationId: 'res-1',
    clienteEmail: 'user@test.com',
    clienteNombre: 'Juan',
    courtName: 'Cancha 1',
    clubName: 'Club Test',
    startAt: new Date('2025-06-01T14:00:00Z'),
    endAt: new Date('2025-06-01T15:30:00Z'),
    precio: 5000,
    receiptToken: 'token-abc',
  };

  describe('email disabled (no API key)', () => {
    let service: NotificationService;

    beforeEach(async () => {
      const module = await buildModule({
        resendApiKey: null,
        from: 'test@test.com',
        appUrl: 'http://localhost',
        enabled: true,
        logOnly: false,
      });
      service = module.get(NotificationService);
    });

    it('should report email disabled', () => {
      expect(service.getEmailStatus()).toEqual({
        enabled: false,
        provider: 'NONE',
        logOnly: false,
      });
    });

    it('should persist notification as MOCK when email disabled', async () => {
      repo.create.mockImplementation((data: any) => ({
        ...data,
        id: 'notif-1',
        createdAt: new Date(),
      }));
      repo.save.mockImplementation(async (n: any) => n);

      const result = await service.sendReservationConfirmedEmail(emailData);

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(NotificationStatus.SENT);
      expect(result.provider).toBe('MOCK');
    });
  });

  describe('email log-only mode', () => {
    let service: NotificationService;

    beforeEach(async () => {
      const module = await buildModule({
        resendApiKey: 'key-123',
        from: 'test@test.com',
        appUrl: 'http://localhost',
        enabled: true,
        logOnly: true,
      });
      service = module.get(NotificationService);
    });

    it('should report log-only status', () => {
      expect(service.getEmailStatus()).toEqual({
        enabled: true,
        provider: 'RESEND',
        logOnly: true,
      });
    });

    it('should persist notification as LOG_ONLY without sending', async () => {
      repo.create.mockImplementation((data: any) => ({
        ...data,
        id: 'notif-2',
        createdAt: new Date(),
      }));
      repo.save.mockImplementation(async (n: any) => n);

      const result = await service.sendReservationConfirmedEmail(emailData);

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(NotificationStatus.SENT);
      expect(result.provider).toBe('LOG_ONLY');
    });
  });

  describe('email enabled (with API key)', () => {
    let service: NotificationService;

    beforeEach(async () => {
      const module = await buildModule({
        resendApiKey: 'key-real',
        from: 'test@test.com',
        appUrl: 'http://localhost',
        enabled: true,
        logOnly: false,
      });
      service = module.get(NotificationService);
    });

    it('should report email configured', () => {
      expect(service.getEmailStatus()).toEqual({
        enabled: true,
        provider: 'RESEND',
        logOnly: false,
      });
    });

    it('should persist notification even when Resend API fails', async () => {
      // Mock global fetch to simulate failure
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));

      repo.create.mockImplementation((data: any) => ({
        ...data,
        id: 'notif-3',
        createdAt: new Date(),
      }));
      repo.save.mockImplementation(async (n: any) => n);

      const result = await service.sendReservationConfirmedEmail(emailData);

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(NotificationStatus.FAILED);
      expect(result.errorMessage).toContain('Network timeout');

      global.fetch = originalFetch;
    });
  });

  describe('email explicitly disabled', () => {
    let service: NotificationService;

    beforeEach(async () => {
      const module = await buildModule({
        resendApiKey: 'key-exists',
        from: 'test@test.com',
        appUrl: 'http://localhost',
        enabled: false,
        logOnly: false,
      });
      service = module.get(NotificationService);
    });

    it('should report email disabled despite having API key', () => {
      expect(service.getEmailStatus()).toEqual({
        enabled: false,
        provider: 'RESEND',
        logOnly: false,
      });
    });
  });
});
