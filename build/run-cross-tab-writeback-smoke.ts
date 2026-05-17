import assert from 'node:assert/strict'

import {
  createPendingImageInsertionState,
  resolvePaperStreamCompletionDecision,
  resolvePaperStreamSyncDecision,
  shouldAutoApplyPendingImageInsertion,
} from '../src/utils/crossTabWriteback'

function main(): void {
  const syncDecision = resolvePaperStreamSyncDecision({
    activeTabId: 'tab-b',
    targetTabId: 'tab-a',
    markdown: '# 跨 tab 文稿 smoke 标题\n\n正文段落。',
    manualModified: false,
  })
  assert.equal(syncDecision.action, 'shell', '跨 tab 预览同步应落到目标 tab shell，而不是被丢弃')
  assert.match(syncDecision.html, /跨 tab 文稿 smoke 标题/, '跨 tab 预览同步应携带目标正文 HTML')

  const blockedSyncDecision = resolvePaperStreamSyncDecision({
    activeTabId: 'tab-b',
    targetTabId: 'tab-a',
    markdown: '不会写回',
    manualModified: true,
  })
  assert.equal(blockedSyncDecision.action, 'skip', '目标 tab 已标记手改时，跨 tab 预览同步不应继续覆盖 shell')

  const completionDecision = resolvePaperStreamCompletionDecision({
    activeTabId: 'tab-b',
    targetTabId: 'tab-a',
    markdown: '# 最终标题\n\n最终正文。',
  })
  assert.equal(completionDecision.action, 'shell', '跨 tab 完成态应把最终内容写回目标 tab shell')
  assert.match(completionDecision.html, /最终正文/, '跨 tab 完成态应保留最终正文 HTML')

  const pendingInsertion = createPendingImageInsertionState({
    tabId: 'tab-a',
    src: 'file:///tmp/cross-tab-smoke.png',
    alt: '跨 tab smoke 配图',
    title: '跨 tab smoke 配图',
    placement: 'after-selection',
    selection: {
      from: 12,
      to: 18,
      anchorId: 'anchor-1',
      text: '图像锚点',
    },
    statusMessage: '图片已生成，回到原文稿标签后会自动插入',
    createdAt: '2026-04-16T00:00:00.000Z',
    requestId: 'pending-image:test',
  })
  assert.equal(pendingInsertion.tabId, 'tab-a', '待回写图片必须绑定原始目标 tab')
  assert.equal(pendingInsertion.selection?.anchorId, 'anchor-1', '待回写图片必须保留原始选择锚点')
  assert.equal(pendingInsertion.placement, 'after-selection', '待回写图片必须保留原始插入位置策略')

  assert.equal(shouldAutoApplyPendingImageInsertion(pendingInsertion, 'tab-b', true), false, '用户仍停留在其他 tab 时，不应提前自动插入图片')
  assert.equal(shouldAutoApplyPendingImageInsertion(pendingInsertion, 'tab-a', false), false, '目标 tab 未就绪时，不应自动插入图片')
  assert.equal(shouldAutoApplyPendingImageInsertion(pendingInsertion, 'tab-a', true), true, '回到原 tab 且编辑器就绪后，应自动执行待回写图片插入')

  console.log('cross-tab writeback smoke passed')
}

main()
