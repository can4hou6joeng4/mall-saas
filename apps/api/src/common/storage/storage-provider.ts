export interface StoredFile {
  storageKey: string
  publicUrl: string
  contentType: string
  byteSize: number
}

export interface PutInput {
  tenantId: number
  contentType: string
  buffer: Buffer
  filename: string
}

export interface StorageProvider {
  readonly name: string
  put(input: PutInput): Promise<StoredFile>
  delete(storageKey: string): Promise<void>
}
