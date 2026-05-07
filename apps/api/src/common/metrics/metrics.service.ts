import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client'

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry: Registry
  readonly httpRequestsTotal: Counter<string>
  readonly httpRequestDurationSeconds: Histogram<string>

  constructor() {
    this.registry = new Registry()
    collectDefaultMetrics({ register: this.registry })

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests handled',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    })
    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    })
  }

  observe(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) }
    this.httpRequestsTotal.inc(labels)
    this.httpRequestDurationSeconds.observe(labels, durationSeconds)
  }

  metrics(): Promise<string> {
    return this.registry.metrics()
  }

  contentType(): string {
    return this.registry.contentType
  }

  onModuleDestroy(): void {
    this.registry.clear()
  }
}
