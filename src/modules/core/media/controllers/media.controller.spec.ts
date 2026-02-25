import { Test, TestingModule } from '@nestjs/testing';
import { MediaController } from '../controllers/media.controller';
import { MediaService } from '../services/media.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

describe('MediaController', () => {
  let controller: MediaController;

  beforeEach(async () => {
    const mediaService = {
      createSignature: jest.fn(),
      register: jest.fn(),
      list: jest.fn(),
      remove: jest.fn(),
      listPublic: jest.fn(),
      getSinglePublic: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: MediaService, useValue: mediaService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<MediaController>(MediaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
