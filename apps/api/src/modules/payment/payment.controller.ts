import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { TenantId } from '@mall/shared'
import { CurrentTenant, CurrentUser } from '../../common/tenant/index.js'
import type { RequestContext } from '../../common/tenant/index.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import { type PayOrderDto, payOrderSchema } from './payment.dto.js'
import { PaymentService } from './payment.service.js'

@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('orders/:id/pay')
  @HttpCode(200)
  pay(
    @CurrentTenant() tenantId: TenantId,
    @CurrentUser() user: RequestContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(payOrderSchema)) dto: PayOrderDto,
  ) {
    return this.payments.pay(tenantId, user.userId, id, dto.provider)
  }

  @Post('webhooks/payments/:provider')
  @HttpCode(200)
  webhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: FastifyRequest,
  ): Promise<{ acknowledged: true }> {
    const rawBody =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    return this.payments.handleWebhook(provider, headers, rawBody)
  }
}
