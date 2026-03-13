import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ClubAccessGuard } from '@legacy/club-members/club-access.guard';
import { CLUB_ROLES_KEY } from '@legacy/club-members/club-roles.decorator';
import { ClubMemberRole } from '@legacy/club-members/enums/club-member-role.enum';

describe('ReportsController', () => {
  let controller: ReportsController;

  beforeEach(async () => {
    const reportsService = {
      revenueReport: jest.fn(),
      occupancyReport: jest.fn(),
      peakHoursReport: jest.fn(),
      summaryReport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: reportsService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('protects summary with jwt + club access guards and club-admin roles', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ReportsController.prototype.summary,
    );
    const roles = Reflect.getMetadata(
      CLUB_ROLES_KEY,
      ReportsController.prototype.summary,
    );

    expect(guards).toEqual([JwtAuthGuard, ClubAccessGuard]);
    expect(roles).toEqual([ClubMemberRole.ADMIN, ClubMemberRole.STAFF]);
  });
});
