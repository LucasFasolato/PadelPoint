import { Global, Module } from '@nestjs/common';
import { DomainTelemetryService } from './domain-telemetry.service';
import { RequestMetricsService } from './request-metrics.service';

@Global()
@Module({
  providers: [DomainTelemetryService, RequestMetricsService],
  exports: [DomainTelemetryService, RequestMetricsService],
})
export class ObservabilityModule {}
