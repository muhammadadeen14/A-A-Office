import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export class PathGuard {
  private readonly roots: string[]

  constructor(roots: string[]) {
    this.roots = roots.map((root) => resolve(root))
  }

  resolveWithin(input: string, preferredRoot = this.roots[0]): string {
    if (!preferredRoot) throw new Error('No trusted workspace is configured')
    const candidate = resolve(preferredRoot, input)
    if (!this.isAllowed(candidate)) throw new Error('The requested path is outside trusted workspaces')
    return candidate
  }

  async resolveExisting(input: string, preferredRoot = this.roots[0]): Promise<string> {
    const candidate = this.resolveWithin(input, preferredRoot)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed at trusted file boundaries')
    const canonical = await realpath(candidate)
    await this.assertCanonicalAllowed(canonical)
    return canonical
  }

  async resolveForWrite(input: string, preferredRoot = this.roots[0]): Promise<string> {
    const candidate = this.resolveWithin(input, preferredRoot)
    let ancestor = candidate
    while (true) {
      try {
        const info = await lstat(ancestor)
        if (ancestor === candidate && info.isSymbolicLink()) throw new Error('Writing through a symbolic link is not allowed')
        const canonicalAncestor = await realpath(ancestor)
        await this.assertCanonicalAllowed(canonicalAncestor)
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) throw new Error('No trusted parent directory exists for this path', { cause:error })
        ancestor = parent
      }
    }
  }

  isAllowed(input: string): boolean {
    const candidate = resolve(input)
    return this.roots.some((root) => {
      const rel = relative(root, candidate)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
  }

  private async assertCanonicalAllowed(candidate: string): Promise<void> {
    const canonicalRoots = await Promise.all(this.roots.map((root) => realpath(root)))
    const allowed = canonicalRoots.some((root) => {
      const rel = relative(root, candidate)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
    if (!allowed) throw new Error('The requested path resolves outside trusted workspaces')
  }
}
