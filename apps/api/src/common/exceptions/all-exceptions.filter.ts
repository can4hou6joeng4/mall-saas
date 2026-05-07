import { type ServerResponse } from 'node:http'
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

interface ErrorBody {
  code: string
  message: string
  requestId: string
  details?: unknown
}

function statusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST'
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED'
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN'
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND'
    case HttpStatus.CONFLICT:
      return 'CONFLICT'
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY'
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'
  }
}

function extractMessageAndDetails(exception: HttpException): {
  message: string
  details?: unknown
} {
  const response = exception.getResponse()
  if (typeof response === 'string') {
    return { message: response }
  }
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>
    const message =
      typeof r['message'] === 'string'
        ? r['message']
        : Array.isArray(r['message'])
          ? r['message'].join(', ')
          : exception.message
    const { message: _m, statusCode: _s, error: _e, ...rest } = r
    const details = Object.keys(rest).length > 0 ? rest : undefined
    return details === undefined ? { message } : { message, details }
  }
  return { message: exception.message }
}

function sendJson(
  reply: FastifyReply | ServerResponse,
  status: number,
  body: ErrorBody,
): void {
  const fastifyReply = reply as Partial<FastifyReply>
  if (typeof fastifyReply.status === 'function') {
    void (reply as FastifyReply).status(status).send(body)
    return
  }
  const raw = reply as ServerResponse
  raw.statusCode = status
  raw.setHeader('content-type', 'application/json')
  raw.end(JSON.stringify(body))
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply | ServerResponse>()
    const request = ctx.getRequest<FastifyRequest>()
    const requestId = String(request.id ?? '')

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const { message, details } = extractMessageAndDetails(exception)
      const body: ErrorBody = { code: statusToCode(status), message, requestId }
      if (details !== undefined) body.details = details
      if (status >= 500) {
        this.logger.error({ requestId, exception }, message)
      } else {
        this.logger.warn({ requestId, status, message })
      }
      sendJson(reply, status, body)
      return
    }

    // Fastify 插件（如 @fastify/rate-limit）抛出的错误带 statusCode；这里透传，避免被吞为 500
    if (
      exception !== null &&
      typeof exception === 'object' &&
      'statusCode' in exception &&
      typeof (exception as { statusCode: unknown }).statusCode === 'number'
    ) {
      const status = (exception as { statusCode: number }).statusCode
      const message =
        exception instanceof Error ? exception.message : 'request rejected'
      const body: ErrorBody = { code: statusToCode(status), message, requestId }
      this.logger.warn({ requestId, status, message })
      sendJson(reply, status, body)
      return
    }

    const message = exception instanceof Error ? exception.message : 'unexpected error'
    this.logger.error({ requestId, exception }, message)
    sendJson(reply, HttpStatus.INTERNAL_SERVER_ERROR, {
      code: 'INTERNAL_ERROR',
      message,
      requestId,
    })
  }
}
