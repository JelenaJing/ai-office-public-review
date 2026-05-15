import fs from 'node:fs/promises'
import path from 'node:path'

export interface SaveEmailAttachmentInput {
  sourcePath: string
  workspacePath: string
  filename: string
  messageId?: string
  kind: 'presentation' | 'document' | 'spreadsheet' | 'preview'
}

export interface SaveEmailAttachmentResult {
  localPath: string
}

function resolveTargetDir(workspacePath: string, kind: SaveEmailAttachmentInput['kind']): string {
  if (kind === 'presentation') {
    return path.join(workspacePath, '05_Presentation', 'imports', 'email-attachments')
  }
  return path.join(workspacePath, 'mail-attachments')
}

function sanitizePathSegment(rawValue: string, fallback: string): string {
  const cleaned = String(rawValue || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

export async function saveEmailAttachmentToWorkspace(input: SaveEmailAttachmentInput): Promise<SaveEmailAttachmentResult> {
  const workspaceRoot = path.resolve(input.workspacePath)
  const baseTargetDir = resolveTargetDir(workspaceRoot, input.kind)
  const targetDir = input.kind === 'presentation'
    ? baseTargetDir
    : path.join(baseTargetDir, sanitizePathSegment(input.messageId || '', 'message'))
  const targetPath = path.join(targetDir, input.filename)
  const resolvedTarget = path.resolve(targetPath)

  if (resolvedTarget !== workspaceRoot && !resolvedTarget.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error('附件目标路径非法')
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(input.sourcePath, resolvedTarget)

  return { localPath: resolvedTarget }
}
