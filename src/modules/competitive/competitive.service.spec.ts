import { Test, TestingModule } from '@nestjs/testing';
import { CompetitiveService } from './competitive.service';

describe('CompetitiveService', () => {
  let service: CompetitiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompetitiveService],
    }).compile();

    service = module.get<CompetitiveService>(CompetitiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
