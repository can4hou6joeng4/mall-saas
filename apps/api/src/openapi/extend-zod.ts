// 仅在此文件作为副作用一次性扩展 zod —— 任何调用 .openapi() 的代码都需在此 import 之后求值。
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)
