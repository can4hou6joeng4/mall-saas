import { randomBytes } from 'node:crypto'

// W3C Trace Context: traceparent = "00-<traceId32>-<spanId16>-<flags2>"
// https://www.w3.org/TR/trace-context/#traceparent-header
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const TRACEID_INVALID = '0'.repeat(32)
const SPANID_INVALID = '0'.repeat(16)

export interface ParsedTraceparent {
  traceId: string
  spanId: string
  flags: string
}

export function parseTraceparent(raw: string | string[] | undefined): ParsedTraceparent | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const m = TRACEPARENT_RE.exec(value.toLowerCase())
  if (!m) return null
  const [, traceId, spanId, flags] = m
  if (traceId === TRACEID_INVALID || spanId === SPANID_INVALID) return null
  return { traceId: traceId!, spanId: spanId!, flags: flags! }
}

export function newTraceId(): string {
  return randomBytes(16).toString('hex')
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex')
}

export function formatTraceresponse(traceId: string, spanId: string, flags = '01'): string {
  return `00-${traceId}-${spanId}-${flags}`
}

interface ReqLike {
  headers: Record<string, string | string[] | undefined>
}

// fastify genReqId 钩子：解析入站 traceparent，否则回退到 x-request-id 或新生成 traceId（32-hex）。
// 注意 genReqId 拿到的是 raw IncomingMessage，挂在它上面的属性到 hooks 阶段会丢，所以这里只做
// 纯函数：返回 traceId（让 req.id 等于 traceId）。spanId / parentSpanId 由后续 onRequest hook 补。
// 形参用 unknown 兼容 fastify 的 IncomingMessage | Http2ServerRequest 联合签名。
export function genReqIdWithTrace(req: unknown): string {
  const r = req as ReqLike
  const tp = parseTraceparent(r.headers['traceparent'])
  const headerId = r.headers['x-request-id']
  const legacyId = typeof headerId === 'string' && headerId.length > 0 ? headerId : null
  return tp?.traceId ?? legacyId ?? newTraceId()
}

interface FastifyReqWithSpan {
  spanId?: string
  parentSpanId?: string
  headers: Record<string, string | string[] | undefined>
}

// fastify onRequest hook：在 FastifyRequest 上生成 fresh spanId + 记录上游 parentSpanId。
// 必须在 onRequest 阶段做，因为 genReqId 阶段的 raw req 不会随请求传到后续 hook。
export function attachSpanContext(req: unknown): void {
  const r = req as FastifyReqWithSpan
  r.spanId = newSpanId()
  const tp = parseTraceparent(r.headers['traceparent'])
  if (tp) r.parentSpanId = tp.spanId
}
