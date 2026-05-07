import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { AuthRateLimitGuard } from '../../common/auth/auth-rate-limit.guard.js'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js'
import { AdminAuthService, type PlatformAuthResult } from './admin-auth.service.js'
import { AdminService } from './admin.service.js'
import {
  type AdminLoginDto,
  adminLoginSchema,
  type CreateTenantDto,
  createTenantSchema,
  type ListOrdersAdminQuery,
  listOrdersAdminQuerySchema,
  type ListPaymentsAdminQuery,
  listPaymentsAdminQuerySchema,
  type UpdateTenantDto,
  updateTenantSchema,
} from './admin.dto.js'

@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly admin: AdminService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  login(
    @Body(new ZodValidationPipe(adminLoginSchema)) dto: AdminLoginDto,
  ): Promise<PlatformAuthResult> {
    return this.auth.login(dto)
  }

  @Get('tenants')
  listTenants() {
    return this.admin.listTenants()
  }

  @Post('tenants')
  createTenant(@Body(new ZodValidationPipe(createTenantSchema)) dto: CreateTenantDto) {
    return this.admin.createTenant(dto)
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateTenantSchema)) dto: UpdateTenantDto,
  ) {
    return this.admin.updateTenant(id, dto)
  }

  @Delete('tenants/:id')
  @HttpCode(204)
  async deleteTenant(@Param('id', ParseIntPipe) id: number) {
    await this.admin.deleteTenant(id)
  }

  @Get('orders')
  listOrders(
    @Query(new ZodValidationPipe(listOrdersAdminQuerySchema)) query: ListOrdersAdminQuery,
  ) {
    return this.admin.listOrders(query)
  }

  @Get('payments')
  listPayments(
    @Query(new ZodValidationPipe(listPaymentsAdminQuerySchema)) query: ListPaymentsAdminQuery,
  ) {
    return this.admin.listPayments(query)
  }
}
