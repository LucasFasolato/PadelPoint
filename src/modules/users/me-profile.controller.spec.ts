import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MeProfileController } from './me-profile.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from './user-role.enum';

describe('MeProfileController', () => {
  let controller: MeProfileController;
  let usersService: {
    getPlayerProfile: jest.Mock;
    updatePlayerProfile: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      getPlayerProfile: jest.fn(),
      updatePlayerProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeProfileController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<MeProfileController>(MeProfileController);
  });

  it('allows PLAYER to GET /me/profile', async () => {
    usersService.getPlayerProfile.mockResolvedValue({
      userId: 'u1',
      email: 'player@test.com',
      role: 'PLAYER',
      displayName: null,
      phone: null,
      createdAt: null,
    });

    const req = {
      user: { userId: 'u1', email: 'player@test.com', role: UserRole.PLAYER },
    } as any;

    const result = await controller.getProfile(req);

    expect(result).toEqual({
      userId: 'u1',
      email: 'player@test.com',
      role: 'PLAYER',
      displayName: null,
      phone: null,
      createdAt: null,
    });
  });

  it('allows PLAYER to PATCH /me/profile', async () => {
    usersService.updatePlayerProfile.mockResolvedValue({
      userId: 'u1',
      email: 'player@test.com',
      role: 'PLAYER',
      displayName: 'Name',
      phone: '+54 11 1234-5678',
      createdAt: null,
    });

    const req = {
      user: { userId: 'u1', email: 'player@test.com', role: UserRole.PLAYER },
    } as any;

    const result = await controller.updateProfile(req, {
      displayName: 'Name',
      phone: '+54 11 1234-5678',
    });

    expect(result.displayName).toBe('Name');
    expect(result.phone).toBe('+54 11 1234-5678');
  });

  it('rejects ADMIN role via RolesGuard', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => controller.getProfile,
      getClass: () => MeProfileController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.ADMIN },
        }),
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
