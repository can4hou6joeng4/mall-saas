import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

@Injectable()
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodType<TOutput>) {}

  transform(value: unknown): TOutput {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation failed',
        issues: result.error.issues,
      })
    }
    return result.data
  }
}
