// OpenTelemetry SDK 启动入口。必须在 NestFactory 之前 import，让 auto-instrumentation
// 在模块加载链路上挂上 hook（fastify / pg / ioredis / undici 等）。
//
// 开关：
//   OTEL_ENABLED=true     启用 SDK
//   OTEL_EXPORTER=otlp    使用 OTLP HTTP exporter（默认）
//   OTEL_EXPORTER=console 直接打到 stdout（验收脚本默认，零依赖）
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 OTLP HTTP 端点
//   OTEL_SERVICE_NAME=mall-api（默认）
//
// 关闭时（默认）：函数立即 return，零运行时开销。
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { ConsoleSpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

let started: NodeSDK | null = null

function pickExporter(): SpanExporter {
  const kind = (process.env['OTEL_EXPORTER'] ?? 'otlp').toLowerCase()
  if (kind === 'console') return new ConsoleSpanExporter()
  return new OTLPTraceExporter({
    url:
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
        ? `${process.env['OTEL_EXPORTER_OTLP_ENDPOINT']}/v1/traces`
        : 'http://localhost:4318/v1/traces',
  })
}

export function startOtelIfEnabled(): void {
  if (started) return
  const enabled = (process.env['OTEL_ENABLED'] ?? '').toLowerCase()
  if (enabled !== 'true' && enabled !== '1') return

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'mall-api',
      [ATTR_SERVICE_VERSION]: process.env['OTEL_SERVICE_VERSION'] ?? '0.0.0',
      'deployment.environment': process.env['NODE_ENV'] ?? 'development',
    }),
    traceExporter: pickExporter(),
    // auto-instrumentation：禁用 fs（噪声大）和 dns（验收脚本里挤掉真正业务 span）
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  })

  sdk.start()
  started = sdk

  // 优雅退出：确保 span flush 出去后才结束进程
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      sdk
        .shutdown()
        .catch(() => undefined)
        .finally(() => process.exit(0))
    })
  }
}
