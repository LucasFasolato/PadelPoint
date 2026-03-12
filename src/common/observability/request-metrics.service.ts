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

function classifyHotspot(
  metric: Pick<HttpRequestMetric, 'method' | 'endpoint'>,
): string | null {
  const key = `${metric.method} ${metric.endpoint}`;
  if (key === 'GET /matches/me') return 'matches.me';
  if (key === 'GET /availability/slots') return 'availability.slots';
  if (
    key === 'GET /notifications' ||
    key === 'GET /notifications/inbox' ||
    key === 'GET /notifications/unread-count' ||
    key === 'GET /notifications/canonical' ||
    key === 'GET /me/inbox' ||
    key === 'GET /me/notifications'
  ) {
    return 'notifications.feed';
  }
  if (
    key === 'GET /challenges/:id/coordination' ||
    key === 'GET /challenges/:id/messages'
  ) {
    return 'challenge.coordination';
  }
  if (
    key === 'GET /leagues/:id/standings' ||
    key === 'GET /leagues/:id/standings/latest'
  ) {
    return 'league.standings';
  }

  return null;
}

@Injectable()
export class RequestMetricsService {
  private readonly logger = new Logger(RequestMetricsService.name);
  private readonly endpointWindows = new Map<string, EndpointWindow>();

  recordHttpRequest(metric: HttpRequestMetric): void {
    const hotspot = classifyHotspot(metric);
    logStructured(this.logger, 'log', {
      event: 'http.request.completed',
      requestId: metric.requestId,
      userId: metric.userId,
      endpoint: metric.endpoint,
      method: metric.method,
      hotspot,
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
    const hotspot = classifyHotspot(metric);
    logStructured(this.logger, 'warn', {
      event: 'http.request.slow',
      requestId: metric.requestId,
      userId: metric.userId,
      endpoint: metric.endpoint,
      method: metric.method,
      hotspot,
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
      const [method, ...endpointParts] = endpoint.split(' ');
      const hotspot = classifyHotspot({
        method,
        endpoint: endpointParts.join(' '),
      });

      logStructured(this.logger, 'log', {
        event: 'http.metrics.window',
        endpoint,
        hotspot,
        requestCount: window.count,
        errorRate,
        p95LatencyMs,
      });
    }

    this.endpointWindows.clear();
  }
}
