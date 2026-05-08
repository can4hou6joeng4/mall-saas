import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { PutInput, StorageProvider, StoredFile } from './storage-provider.js'

const UPLOAD_DIR_ENV = 'STORAGE_LOCAL_DIR'
const PUBLIC_BASE_ENV = 'STORAGE_PUBLIC_BASE'

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local'

  private get root(): string {
    return resolve(process.env[UPLOAD_DIR_ENV] ?? './var/uploads')
  }

  private get publicBase(): string {
    return process.env[PUBLIC_BASE_ENV] ?? '/uploads'
  }

  async put(input: PutInput): Promise<StoredFile> {
    const ext = extname(input.filename) || mimeToExt(input.contentType)
    const id = randomUUID()
    const relPath = join(`tenant-${input.tenantId}`, `${id}${ext}`)
    const absPath = join(this.root, relPath)
    await mkdir(join(this.root, `tenant-${input.tenantId}`), { recursive: true })
    await writeFile(absPath, input.buffer)
    return {
      storageKey: relPath,
      publicUrl: `${this.publicBase}/${relPath}`,
      contentType: input.contentType,
      byteSize: input.buffer.byteLength,
    }
  }

  async delete(storageKey: string): Promise<void> {
    const absPath = join(this.root, storageKey)
    await rm(absPath, { force: true })
  }

  rootDir(): string {
    return this.root
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return ''
  }
}
