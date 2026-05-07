#!/usr/bin/env node
// 生成 OpenAPI 文档并写入 apps/api/openapi.json
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument } from '../src/openapi/build.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, '..', 'openapi.json')

const doc = buildOpenApiDocument()
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')

const pathCount = Object.keys(doc.paths).length
console.log(`✓ OpenAPI written to ${outPath} (${pathCount} paths)`)
