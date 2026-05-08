import { HttpException, HttpStatus } from '@nestjs/common'

// BusinessException：HttpException + 携带 i18n key 与 params；过滤器拦到后用 I18nService 翻译
export class BusinessException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly messageKey: string,
    public readonly messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super(
      {
        statusCode: status,
        messageKey,
        messageParams,
        message: fallbackMessage ?? messageKey,
      },
      status,
    )
  }
}
