import { isAbsolute, relative, resolve } from 'node:path'

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

  isAllowed(input: string): boolean {
    const candidate = resolve(input)
    return this.roots.some((root) => {
      const rel = relative(root, candidate)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
  }
}
