import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { EloHistory } from '@core/competitive/entities/elo-history.entity';
import { MeInsightsController } from './controllers/me-insights.controller';
import { InsightsService } from './services/insights.service';

@Module({
  imports: [TypeOrmModule.forFeature([MatchResult, EloHistory])],
  controllers: [MeInsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
