import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { OfficeDatabase } from '../database'

export class BackupService {
  constructor(private readonly database: OfficeDatabase, private readonly backupDirectory: string, private readonly retention = 7) {}

  async create(): Promise<string> {
    await mkdir(this.backupDirectory, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = join(this.backupDirectory, `aa-office-${stamp}.sqlite`)
    await this.database.db.backup(destination)
    await this.prune()
    return destination
  }

  async list(): Promise<Array<{ name: string; path: string; size: number; createdAt: string }>> {
    await mkdir(this.backupDirectory, { recursive: true })
    const names = (await readdir(this.backupDirectory)).filter((name) => name.endsWith('.sqlite')).sort().reverse()
    return Promise.all(names.map(async (name) => {
      const path = join(this.backupDirectory, name); const info = await stat(path)
      return { name: basename(path), path, size: info.size, createdAt: info.mtime.toISOString() }
    }))
  }

  private async prune(): Promise<void> {
    const backups = await this.list()
    await Promise.all(backups.slice(this.retention).map((backup) => unlink(backup.path)))
  }
}
