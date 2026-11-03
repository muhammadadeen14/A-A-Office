import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export class CredentialStore {
  constructor(private readonly directory: string) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid credential identifier')
    return join(this.directory, `${id}.bin`)
  }

  async set(id: string, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this system')
    await mkdir(this.directory, { recursive: true })
    await writeFile(this.path(id), safeStorage.encryptString(secret), { mode: 0o600 })
  }

  async get(id: string): Promise<string | undefined> {
    try {
      const encrypted = await readFile(this.path(id))
      return safeStorage.decryptString(encrypted)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async remove(id: string): Promise<void> {
    try { await unlink(this.path(id)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export const credentialDirectory = (userData: string): string => join(userData, 'Secure Credentials')
