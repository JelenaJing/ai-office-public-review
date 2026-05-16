import {
  getCatalogEntry,
  validateCapabilityInvoke,
  type CapabilityId,
  type CapabilityInvokeRequest,
  type CapabilityResult,
  ZERO_DECK_COST,
} from '../../../src/capabilities'
import {
  loadDeckDocument,
  renderDeckDocument,
  saveDeckDocument,
} from '../services/deckDocumentService'
import { renderPptxPreview } from '../services/ppt/pptxPreviewService'
import { listPptTemplates } from '../services/pptTemplateRegistry'
import type { DeckDocument } from '../../../src/types/deckDocument'

const BATCH1_INVOKE_IDS = new Set<CapabilityId>([
  'deck.load',
  'deck.save',
  'deck.render',
  'deck.preview',
  'deckTemplate.list',
])

function success<T>(data: T, cost = ZERO_DECK_COST): CapabilityResult<T> {
  return { ok: true, data, cost }
}

function failure<T = unknown>(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): CapabilityResult<T> {
  return {
    ok: false,
    data: {} as T,
    error: { code, message, detail },
    cost: ZERO_DECK_COST,
  }
}

function requireString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim()
}

export async function invokeCapability(
  request: CapabilityInvokeRequest,
): Promise<CapabilityResult<unknown>> {
  const capabilityId = String(request.capability || '').trim()
  const callerType = request.caller?.type ?? 'ui'

  const gate = validateCapabilityInvoke(capabilityId, callerType)
  if (!gate.ok) {
    return failure(gate.code, gate.message)
  }

  const catalogEntry = getCatalogEntry(capabilityId)
  if (!catalogEntry) {
    return failure('CAPABILITY_NOT_FOUND', `未知 capability: ${capabilityId}`)
  }

  if (!BATCH1_INVOKE_IDS.has(catalogEntry.id)) {
    return failure(
      'CAPABILITY_NOT_INVOKABLE',
      `${capabilityId} 不在第一批 invoke 白名单`,
    )
  }

  try {
    switch (catalogEntry.id) {
      case 'deck.load': {
        const workspacePath = requireString(request.params, 'workspacePath')
        const deckId = requireString(request.params, 'deckId')
        if (!workspacePath || !deckId) {
          return failure('INVALID_INPUT', 'workspacePath 与 deckId 为必填')
        }
        const result = await loadDeckDocument(workspacePath, deckId)
        if (!result.success) {
          return failure('RESOURCE_NOT_FOUND', result.error || '加载 deck 失败', {
            filePath: result.filePath,
          })
        }
        return success({ deck: result.deck, filePath: result.filePath })
      }

      case 'deck.save': {
        const workspacePath = requireString(request.params, 'workspacePath')
        const deck = request.params.deck as DeckDocument | undefined
        if (!workspacePath || !deck || typeof deck !== 'object') {
          return failure('INVALID_INPUT', 'workspacePath 与 deck 为必填')
        }
        const result = await saveDeckDocument(workspacePath, deck)
        if (!result.success) {
          return failure('ENGINE_ERROR', result.error || '保存 deck 失败')
        }
        return success({
          deckId: result.deckId,
          filePath: result.filePath,
        })
      }

      case 'deck.render': {
        const workspacePath = requireString(request.params, 'workspacePath')
        const deckId = requireString(request.params, 'deckId')
        const manifestId = requireString(request.params, 'manifestId')
        const outputPath = requireString(request.params, 'outputPath') ?? undefined
        if (!workspacePath || !deckId || !manifestId) {
          return failure('INVALID_INPUT', 'workspacePath、deckId、manifestId 为必填')
        }
        const result = await renderDeckDocument({
          workspacePath,
          deckId,
          manifestId,
          outputPath,
        })
        if (!result.success) {
          return failure('ENGINE_ERROR', result.error || '渲染 deck 失败', {
            manifestId: result.manifestId,
          })
        }
        return success({
          pptxPath: result.outputPath,
          outputPath: result.outputPath,
          slideCount: result.slideCount,
          manifestId: result.manifestId,
          templateId: result.templateId,
          cloneRendererUsed: result.cloneRendererUsed,
        })
      }

      case 'deck.preview': {
        const pptxPath = requireString(request.params, 'pptxPath')
        const previewDir = requireString(request.params, 'previewDir')
        if (!pptxPath || !previewDir) {
          return failure('INVALID_INPUT', 'pptxPath 与 previewDir 为必填')
        }
        const result = await renderPptxPreview({ pptxPath, previewDir })
        if (!result.success) {
          return failure('ENGINE_ERROR', result.error || result.warning || '预览失败', {
            warning: result.warning,
          })
        }
        return success({
          previewDir: result.previewDir,
          slides: result.slides,
          warning: result.warning,
        })
      }

      case 'deckTemplate.list': {
        const templates = listPptTemplates()
        return success({ templates })
      }

      default:
        return failure('CAPABILITY_NOT_INVOKABLE', `未实现的 invoke: ${capabilityId}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failure('ENGINE_ERROR', message)
  }
}
