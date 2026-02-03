import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClubsService } from './clubs.service';
import { Club } from './club.entity';
import { Court } from '../courts/court.entity';
import { MediaAsset } from '../media/media-asset.entity';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('ClubsService', () => {
  let service: ClubsService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const clubRepo = createMockRepo<Club>();
    const courtRepo = createMockRepo<Court>();
    const mediaRepo = createMockRepo<MediaAsset>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubsService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Club), useValue: clubRepo },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        { provide: getRepositoryToken(MediaAsset), useValue: mediaRepo },
      ],
    }).compile();

    service = module.get<ClubsService>(ClubsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
