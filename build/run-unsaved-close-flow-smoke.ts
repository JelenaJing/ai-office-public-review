import assert from 'node:assert/strict'
import { handlePendingAppCloseRequest, type AppCloseResolution, type UnsavedDialogDecision } from '../src/services/UnsavedCloseFlow'

async function runCase(options: {
  hasUnsavedChanges: boolean
  decision?: UnsavedDialogDecision
}): Promise<{ resolution: AppCloseResolution; discardCount: number; promptCount: number }> {
  let discardCount = 0
  let promptCount = 0
  let resolvedTo: AppCloseResolution | null = null

  const resolution = await handlePendingAppCloseRequest({
    hasUnsavedChanges: options.hasUnsavedChanges,
    promptForUnsavedChanges: async () => {
      promptCount += 1
      return options.decision || 'cancel'
    },
    discardUnsavedChanges: () => {
      discardCount += 1
    },
    resolveCloseRequest: (nextResolution) => {
      resolvedTo = nextResolution
    },
  })

  assert.equal(resolution, resolvedTo, '返回值与实际关闭决议不一致')
  return { resolution, discardCount, promptCount }
}

async function main() {
  const noUnsaved = await runCase({ hasUnsavedChanges: false })
  assert.equal(noUnsaved.resolution, 'close')
  assert.equal(noUnsaved.promptCount, 0)
  assert.equal(noUnsaved.discardCount, 0)

  const saveCase = await runCase({ hasUnsavedChanges: true, decision: 'save' })
  assert.equal(saveCase.resolution, 'close')
  assert.equal(saveCase.promptCount, 1)
  assert.equal(saveCase.discardCount, 0)

  const discardCase = await runCase({ hasUnsavedChanges: true, decision: 'discard' })
  assert.equal(discardCase.resolution, 'close')
  assert.equal(discardCase.promptCount, 1)
  assert.equal(discardCase.discardCount, 1)

  const cancelCase = await runCase({ hasUnsavedChanges: true, decision: 'cancel' })
  assert.equal(cancelCase.resolution, 'cancel')
  assert.equal(cancelCase.promptCount, 1)
  assert.equal(cancelCase.discardCount, 0)

  console.log('unsaved close flow smoke passed')
}

void main().catch((error) => {
  console.error('unsaved close flow smoke failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})