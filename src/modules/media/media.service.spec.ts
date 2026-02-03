import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { MediaAsset } from './media-asset.entity';
import { Court } from '../courts/court.entity';
import { ClubMember } from '../club-members/club-member.entity';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'cloudinary') {
          return { cloudName: 'test', apiKey: 'key', apiSecret: 'secret' };
        }
        if (key === 'media.maxBytes') return 10_000_000;
        if (key === 'media.allowedFormats') return 'jpg,png';
        if (key === 'cloudinary.apiSecret') return 'secret';
        if (key === 'cloudinary.cloudName') return 'test';
        if (key === 'cloudinary.apiKey') return 'key';
        return undefined;
      }),
    };
    const mediaRepo = createMockRepo<MediaAsset>();
    const courtsRepo = createMockRepo<Court>();
    const clubMembersRepo = createMockRepo<ClubMember>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(MediaAsset), useValue: mediaRepo },
        { provide: getRepositoryToken(Court), useValue: courtsRepo },
        { provide: getRepositoryToken(ClubMember), useValue: clubMembersRepo },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
