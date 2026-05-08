import { Global, Module } from '@nestjs/common'
import { LocalStorageProvider } from './local-storage.provider.js'

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER'

@Global()
@Module({
  providers: [
    LocalStorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: LocalStorageProvider },
  ],
  exports: [LocalStorageProvider, STORAGE_PROVIDER],
})
export class StorageModule {}
