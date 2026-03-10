import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ChallengesController } from '../controllers/challenges.controller';
import { ChallengesService } from '../services/challenges.service';
import { ChallengeCoordinationService } from '../services/challenge-coordination.service';
import { ChallengesV2CoordinationBridgeService } from '../services/challenges-v2-coordination-bridge.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CreateChallengeMessageDto } from '../dto/create-challenge-message.dto';
import { CreateChallengeProposalDto } from '../dto/create-challenge-proposal.dto';

describe('ChallengesController', () => {
  let controller: ChallengesController;
  let challengeCoordinationService: {
    getCoordinationState: jest.Mock;
    listMessages: jest.Mock;
    createProposal: jest.Mock;
    acceptProposal: jest.Mock;
    rejectProposal: jest.Mock;
    createMessage: jest.Mock;
  };
  let coordinationReadBridge: {
    getCoordinationState: jest.Mock;
    listMessages: jest.Mock;
  };

  beforeEach(async () => {
    const challengesService = {
      createDirect: jest.fn(),
      createOpen: jest.fn(),
      listOpen: jest.fn(),
      inbox: jest.fn(),
      outbox: jest.fn(),
      getById: jest.fn(),
      acceptDirect: jest.fn(),
      rejectDirect: jest.fn(),
      cancel: jest.fn(),
      acceptOpen: jest.fn(),
      cancelOpen: jest.fn(),
    };
    challengeCoordinationService = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
      createProposal: jest.fn(),
      acceptProposal: jest.fn(),
      rejectProposal: jest.fn(),
      createMessage: jest.fn(),
    };
    coordinationReadBridge = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChallengesController],
      providers: [
        { provide: ChallengesService, useValue: challengesService },
        {
          provide: ChallengeCoordinationService,
          useValue: challengeCoordinationService,
        },
        {
          provide: ChallengesV2CoordinationBridgeService,
          useValue: coordinationReadBridge,
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<ChallengesController>(ChallengesController);
  });

  const makeRequest = (): Request =>
    ({
      user: { userId: 'user-1' },
    }) as unknown as Request;

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates coordination reads to the matches-v2 bridge', async () => {
    const req = makeRequest();
    coordinationReadBridge.getCoordinationState.mockResolvedValue({
      challengeId: 'challenge-1',
    });
    coordinationReadBridge.listMessages.mockResolvedValue([
      { id: 'message-1' },
    ]);

    await expect(
      controller.getCoordination(req, 'challenge-1'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
    });
    await expect(controller.getMessages(req, 'challenge-1')).resolves.toEqual([
      { id: 'message-1' },
    ]);

    expect(coordinationReadBridge.getCoordinationState).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
    );
    expect(coordinationReadBridge.listMessages).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
    );
    expect(
      challengeCoordinationService.getCoordinationState,
    ).not.toHaveBeenCalled();
    expect(challengeCoordinationService.listMessages).not.toHaveBeenCalled();
  });

  it('keeps scheduling writes on the legacy coordination service', async () => {
    const req = makeRequest();
    const proposalDto: CreateChallengeProposalDto = {
      scheduledAt: '2026-03-12T19:00:00.000Z',
    };
    const messageDto: CreateChallengeMessageDto = {
      message: 'Wednesday works',
    };

    await controller.createProposal(req, 'challenge-1', proposalDto);
    await controller.acceptProposal(req, 'challenge-1', 'proposal-1');
    await controller.rejectProposal(req, 'challenge-1', 'proposal-1');
    await controller.createMessage(req, 'challenge-1', messageDto);

    expect(challengeCoordinationService.createProposal).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
      proposalDto,
    );
    expect(challengeCoordinationService.acceptProposal).toHaveBeenCalledWith(
      'challenge-1',
      'proposal-1',
      'user-1',
    );
    expect(challengeCoordinationService.rejectProposal).toHaveBeenCalledWith(
      'challenge-1',
      'proposal-1',
      'user-1',
    );
    expect(challengeCoordinationService.createMessage).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
      messageDto,
    );
  });
});
