import { Global, Module } from '@nestjs/common';
import { DomainTelemetryService } from './domain-telemetry.service';

@Global()
@Module({
  providers: [DomainTelemetryService],
  exports: [DomainTelemetryService],
})
export class ObservabilityModule {}
