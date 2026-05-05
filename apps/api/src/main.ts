import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  )

  const swagger = new DocumentBuilder()
    .setTitle('Mall API')
    .setVersion('0.0.0')
    .build()
  const document = SwaggerModule.createDocument(app, swagger)
  SwaggerModule.setup('docs', app, document)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, '0.0.0.0')
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed', err)
  process.exit(1)
})
