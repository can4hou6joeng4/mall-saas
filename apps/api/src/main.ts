import 'reflect-metadata'
// 必须早于任何 DTO 的 zod schema 求值，否则 `.openapi()` 元数据方法不会附加到已创建的 schema
import './openapi/extend-zod.js'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'
import { registerFastifyPlugins } from './bootstrap/fastify-plugins.js'
import { buildOpenApiDocument } from './openapi/build.js'
import { genReqIdWithTrace } from './common/trace/trace-context.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      requestIdHeader: 'x-request-id',
      genReqId: genReqIdWithTrace,
    }),
    { bufferLogs: true },
  )
  app.useLogger(app.get(Logger))
  await registerFastifyPlugins(app)

  const document = buildOpenApiDocument() as unknown as OpenAPIObject
  SwaggerModule.setup('docs', app, document)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, '0.0.0.0')
}

bootstrap().catch((err) => {
  console.error('bootstrap failed', err)
  process.exit(1)
})
