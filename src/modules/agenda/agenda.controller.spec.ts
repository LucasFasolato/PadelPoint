import { Test, TestingModule } from '@nestjs/testing';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

describe('AgendaController', () => {
  let controller: AgendaController;

  beforeEach(async () => {
    const agendaService = {
      getDailyAgenda: jest.fn(),
      blockSlot: jest.fn(),
      updateBlock: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgendaController],
      providers: [{ provide: AgendaService, useValue: agendaService }],
    }).compile();

    controller = module.get<AgendaController>(AgendaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
