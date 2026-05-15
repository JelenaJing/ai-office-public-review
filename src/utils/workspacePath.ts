export function toRelativeWorkspacePath(workspaceRoot: string, targetPath: string): string | null {
  if (!workspaceRoot || !targetPath) return null
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = normalize(workspaceRoot)
  const target = normalize(targetPath)
  if (target === root) return ''
  if (!target.startsWith(`${root}/`)) return null
  return target.slice(root.length + 1)
}

export function joinRelativePath(parentRelativePath: string, name: string): string {
  const normalizedParent = (parentRelativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const normalizedName = (name || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalizedParent) return normalizedName
  if (!normalizedName) return normalizedParent
  return `${normalizedParent}/${normalizedName}`
}