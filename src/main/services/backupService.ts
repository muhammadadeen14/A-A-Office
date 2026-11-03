import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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

  async restore(path: string): Promise<void> {
    const selected = (await this.list()).find((backup) => backup.path === path)
    if (!selected) throw new Error('The selected backup is not in the A&A Office backup folder')
    const candidate = new Database(selected.path, { readonly:true, fileMustExist:true })
    try {
      const integrity = candidate.pragma('integrity_check', { simple:true }) as string
      if (integrity !== 'ok') throw new Error('The selected backup did not pass its integrity check')
    } finally { candidate.close() }
    const suffix = randomUUID()
    const incoming = join(dirname(this.database.path), `.aa-office-restore-${suffix}.sqlite`)
    const previous = join(dirname(this.database.path), `.aa-office-previous-${suffix}.sqlite`)
    await copyFile(selected.path, incoming)
    try {
      await this.create()
      this.database.close()
      await Promise.all([rm(`${this.database.path}-wal`, { force:true }), rm(`${this.database.path}-shm`, { force:true })])
      await rename(this.database.path, previous)
      try { await rename(incoming, this.database.path) }
      catch (error) { await rename(previous, this.database.path); throw error }
      await rm(previous, { force:true }).catch(() => undefined)
    } finally { await rm(incoming, { force:true }) }
  }

  private async prune(): Promise<void> {
    const backups = await this.list()
    await Promise.all(backups.slice(this.retention).map((backup) => unlink(backup.path)))
  }
}
