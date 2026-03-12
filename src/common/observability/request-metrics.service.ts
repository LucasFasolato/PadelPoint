import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { logStructured } from './structured-log.util';

type HttpRequestMetric = {
  requestId: string;
  userId: string | null;
  endpoint: string;
  method: string;
  status: number;
  durationMs: number;
};

type EndpointWindow = {
  count: number;
  errors: number;
  durations: number[];
};

@Injectable()
export class RequestMetricsService {
  private readonly logger = new Logger(RequestMetricsService.name);
  private readonly endpointWindows = new Map<string, EndpointWindow>();

  recordHttpRequest(metric: HttpRequestMetric): void {
    logStructured(this.logger, 'log', {
      event: 'http.request.completed',
      requestId: metric.requestId,
      userId: metric.userId,
      endpoint: metric.endpoint,
      method: metric.method,
      status: metric.status,
      durationMs: metric.durationMs,
    });

    const key = `${metric.method} ${metric.endpoint}`;
    const window = this.endpointWindows.get(key) ?? {
      count: 0,
      errors: 0,
      durations: [],
    };
    window.count += 1;
    if (metric.status >= 500) {
      window.errors += 1;
    }
    window.durations.push(metric.durationMs);
    if (window.durations.length > 500) {
      window.durations.shift();
    }
    this.endpointWindows.set(key, window);
  }

  recordSlowRequest(metric: HttpRequestMetric): void {
    logStructured(this.logger, 'warn', {
      event: 'http.request.slow',
      requestId: metric.requestId,
      userId: metric.userId,
      endpoint: metric.endpoint,
      method: metric.method,
      status: metric.status,
      durationMs: metric.durationMs,
    });
  }

  @Cron('*/5 * * * *')
  flushHttpMetrics(): void {
    for (const [endpoint, window] of this.endpointWindows.entries()) {
      if (window.count === 0) {
        continue;
      }

      const durations = [...window.durations].sort(
        (left, right) => left - right,
      );
      const p95Index = Math.max(Math.ceil(durations.length * 0.95) - 1, 0);
      const p95LatencyMs = durations[p95Index] ?? 0;
      const errorRate = window.errors / window.count;

      logStructured(this.logger, 'log', {
        event: 'http.metrics.window',
        endpoint,
        requestCount: window.count,
        errorRate,
        p95LatencyMs,
      });
    }

    this.endpointWindows.clear();
  }
}
