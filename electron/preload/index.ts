import { contextBridge, ipcRenderer } from 'electron'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntroSettingsPayload(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && !('llm' in value) && !('image' in value) && !('defaults' in value)
}

function mapSettingsForBridge(settings: unknown): Record<string, unknown> {
  const record = isObjectRecord(settings) ? settings : {}
  const llm = isObjectRecord(record.llm) ? record.llm : {}

  return {
    ...record,
    provider: String(llm.provider || 'qwen'),
    apiKey: String(llm.apiKey || ''),
    model: String(llm.model || ''),
    customEndpoint: String(llm.baseUrl || ''),
    backendUrl: String(record.backendUrl || ''),
  }
}

function mapIntroSettingsPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const rawProvider = String(payload.provider || 'qwen').trim()
  const provider = rawProvider === 'nftcore' ? 'deepseek' : rawProvider
  const apiKey = String(payload.apiKey || '').trim()

  return {
    llm: {
      provider,
      apiKey,
      useBuiltinKey: apiKey.length === 0,
      model: String(payload.model || '').trim(),
      baseUrl: String(payload.customEndpoint || '').trim(),
    },
  }
}

const api = {
  getAppInfo: async () => mapSettingsForBridge(await ipcRenderer.invoke('app:getInfo')),
  resolveAppCloseRequest: (resolution: 'close' | 'cancel') => ipcRenderer.invoke('app:resolveCloseRequest', resolution),
  onAppCloseRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('app:requestClose', listener)
    return () => ipcRenderer.removeListener('app:requestClose', listener)
  },
  getSettings: async () => mapSettingsForBridge(await ipcRenderer.invoke('settings:get')),
  saveSettings: async (payload: unknown) => {
    const normalizedPayload = isIntroSettingsPayload(payload) ? mapIntroSettingsPayload(payload) : payload
    return mapSettingsForBridge(await ipcRenderer.invoke('settings:save', normalizedPayload))
  },
  returnToSuiteLauncher: () => ipcRenderer.invoke('suite:returnToLauncher'),
  testLlmConnection: (payload?: unknown) => {
    if (payload !== undefined) {
      return ipcRenderer.invoke('introRemake:testLlmSettings', payload)
    }
    return ipcRenderer.invoke('settings:testLlm')
  },
  testImageConnection: () => ipcRenderer.invoke('settings:testImage'),
  launchCompanionApp: (appId: string) => ipcRenderer.invoke('suite:launchCompanion', appId),
  onSuiteNavigate: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('suite:navigate', listener)
    return () => ipcRenderer.removeListener('suite:navigate', listener)
  },
  getIntroductionRemakeServiceInfo: () => ipcRenderer.invoke('introRemake:getServiceInfo'),
  getIntroductionAllowedJournals: () => ipcRenderer.invoke('introRemake:getAllowedJournals'),
  getIntroductionRecentTasks: () => ipcRenderer.invoke('introRemake:listRecentTasks'),
  saveIntroductionTaskSnapshot: (payload: Record<string, unknown>) => ipcRenderer.invoke('introRemake:saveTaskSnapshot', payload),
  exportIntroductionBundle: (payload: Record<string, unknown>) => ipcRenderer.invoke('introRemake:exportBundle', payload),
  testIntroductionLlmSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('introRemake:testLlmSettings', settings),
  inferIntroductionTopicMeta: (introductionText: string) => ipcRenderer.invoke('introRemake:inferTopicMeta', introductionText),
  buildIntroductionAllowlistedPool: (payload: unknown) => ipcRenderer.invoke('introRemake:buildAllowlistedPool', payload),
  generateIntroductionDraft: (payload: unknown) => ipcRenderer.invoke('introRemake:generateDraft', payload),
  startGenerateIntroductionDraftStream: (payload: unknown) => ipcRenderer.invoke('introRemake:startGenerateDraftStream', payload),
  cancelGenerateIntroductionDraftStream: (streamId: string) => ipcRenderer.invoke('introRemake:cancelGenerateDraftStream', streamId),
  onGenerateIntroductionDraftStreamEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('introRemake:generateDraftStreamEvent', listener)
    return () => ipcRenderer.removeListener('introRemake:generateDraftStreamEvent', listener)
  },
  remapIntroductionDraft: (payload: unknown) => ipcRenderer.invoke('introRemake:remapDraft', payload),
  getPlotAgentStatus: () => ipcRenderer.invoke('plot:status'),
  getPlotChartTypes: () => ipcRenderer.invoke('plot:types'),
  recommendPlot: (payload: unknown) => ipcRenderer.invoke('plot:recommend', payload),
  generatePlot: (payload: unknown) => ipcRenderer.invoke('plot:generate', payload),
  createRealtimePlotSession: (payload: unknown) => ipcRenderer.invoke('plot:realtimeCreateSession', payload),
  addRealtimePlotPoint: (payload: unknown) => ipcRenderer.invoke('plot:realtimeAddPoint', payload),
  addRealtimePlotBatch: (payload: unknown) => ipcRenderer.invoke('plot:realtimeAddBatch', payload),
  getRealtimePlot: (sessionId: string) => ipcRenderer.invoke('plot:realtimeGetPlot', sessionId),
  getRealtimePlotStatus: (sessionId: string) => ipcRenderer.invoke('plot:realtimeGetStatus', sessionId),
  deleteRealtimePlotSession: (sessionId: string) => ipcRenderer.invoke('plot:realtimeDeleteSession', sessionId),
  getActiveDocumentEngine: () => ipcRenderer.invoke('documentEngine:getActive'),
  setPreferredDocumentEngine: (engineId: string) => ipcRenderer.invoke('documentEngine:setPreferred', engineId),
  readOoxmlPackage: (filePath: string) => ipcRenderer.invoke('documentEngine:readOoxmlPackage', filePath),
  writeOoxmlPackage: (filePath: string, payload: { html?: string; plainText?: string; paragraphs?: string[]; blocks?: Array<Record<string, unknown>> }) => ipcRenderer.invoke('documentEngine:writeOoxmlPackage', filePath, payload),

  // ---- 正式模板模式 IPC（formal template mode） ----
  analyzeFormalTemplate: (payload: Record<string, unknown>) => ipcRenderer.invoke('formalTemplate:analyze', payload),
  confirmFormalTemplateFields: (payload: Record<string, unknown>) => ipcRenderer.invoke('formalTemplate:confirmFields', payload),
  previewFormalTemplateTask: (payload: Record<string, unknown>) => ipcRenderer.invoke('formalTemplate:preview', payload),
  commitFormalTemplateTask: (payload: Record<string, unknown>) => ipcRenderer.invoke('formalTemplate:commit', payload),

  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),

  // ---- Department IPC ----
  listDepartments: () => ipcRenderer.invoke('department:list'),
  createDepartment: (name: string, nameEn: string) => ipcRenderer.invoke('department:create', name, nameEn),
  renameDepartment: (id: string, name: string, nameEn: string) => ipcRenderer.invoke('department:rename', id, name, nameEn),
  deleteDepartment: (id: string) => ipcRenderer.invoke('department:delete', id),
  getDefaultDepartmentId: () => ipcRenderer.invoke('department:getDefault'),

  // ---- Knowledge IPC (department-aware) ----
  getKnowledgeBaseInfo: (departmentId?: string) => ipcRenderer.invoke('knowledge:getInfo', departmentId),
  listKnowledgeDocuments: (departmentId?: string, query?: string) => ipcRenderer.invoke('knowledge:listDocuments', departmentId, query),
  getKnowledgeDocument: (departmentId: string, documentId: string) => ipcRenderer.invoke('knowledge:getDocument', departmentId, documentId),
  getKnowledgeDocumentVersion: (departmentId: string, documentId: string, versionId: string) => ipcRenderer.invoke('knowledge:getDocumentVersion', departmentId, documentId, versionId),
  listKnowledgeDocumentChunks: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:listDocumentChunks', departmentId, payload),
  retrieveKnowledgeChunks: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:retrieveChunks', departmentId, payload),
  previewKnowledgeTaskContext: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:previewTaskContext', departmentId, payload),
  importKnowledgeDocuments: (departmentId?: string) => ipcRenderer.invoke('knowledge:importDocuments', departmentId),
  importKnowledgeDocumentFromPath: (departmentId: string, filePath: string) => ipcRenderer.invoke('knowledge:importDocumentFromPath', departmentId, filePath),
  ensureReadingSeedDocuments: (departmentId: string) => ipcRenderer.invoke('knowledge:ensureReadingSeeds', departmentId),
  materializeKnowledgeWorkspace: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:materializeWorkspace', departmentId, payload),
  deleteKnowledgeDocument: (departmentId: string, documentId: string) => ipcRenderer.invoke('knowledge:deleteDocument', departmentId, documentId),
  setKnowledgeCurrentVersion: (departmentId: string, documentId: string, versionId: string) => ipcRenderer.invoke('knowledge:setCurrentVersion', departmentId, documentId, versionId),
  submitKnowledgeRemakeTask: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:submitRemakeTask', departmentId, payload),
  saveKnowledgeTaskRecord: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:saveTaskRecord', departmentId, payload),
  createKnowledgeRemakeVersion: (departmentId: string, payload: unknown) => ipcRenderer.invoke('knowledge:createRemakeVersion', departmentId, payload),
  classifyKnowledgeDocument: (departmentId: string, documentId: string) => ipcRenderer.invoke('knowledge:classifyDocument', departmentId, documentId),
  updateKnowledgeDocumentCategory: (departmentId: string, documentId: string, category: string) => ipcRenderer.invoke('knowledge:updateDocumentCategory', departmentId, documentId, category),
  createWorkspace: (name: string, parentDir?: string) => ipcRenderer.invoke('workspace:create', name, parentDir),
  renameWorkspace: (wsPath: string, nextName: string) => ipcRenderer.invoke('workspace:rename', wsPath, nextName),
  registerWorkspace: (wsPath: string) => ipcRenderer.invoke('workspace:register', wsPath),
  getWorkspaceTree: (wsPath: string) => ipcRenderer.invoke('workspace:tree', wsPath),
  readWorkspaceDocumentSchema: (wsPath: string) => ipcRenderer.invoke('workspace:readDocumentSchema', wsPath),
  saveWorkspaceDocumentSchema: (wsPath: string, document: Record<string, unknown>) => ipcRenderer.invoke('workspace:saveDocumentSchema', wsPath, document),
  deleteWorkspace: (wsPath: string) => ipcRenderer.invoke('workspace:delete', wsPath),
  detectProjectStructure: (wsPath: string) => ipcRenderer.invoke('workspace:detectProjectStructure', wsPath),
  createWorkspaceFolder: (wsPath: string, relativePath: string) => ipcRenderer.invoke('workspace:createFolder', wsPath, relativePath),
  createWorkspaceFile: (wsPath: string, relativePath: string) => ipcRenderer.invoke('workspace:createFile', wsPath, relativePath),
  createBlankDocument: (wsPath: string, relativePath: string) => ipcRenderer.invoke('workspace:createBlankDocument', wsPath, relativePath),
  renameWorkspacePath: (wsPath: string, oldRelativePath: string, newRelativePath: string) => ipcRenderer.invoke('workspace:renamePath', wsPath, oldRelativePath, newRelativePath),
  copyWorkspacePath: (wsPath: string, sourceRelativePath: string, targetRelativePath: string) => ipcRenderer.invoke('workspace:copyPath', wsPath, sourceRelativePath, targetRelativePath),
  moveWorkspacePath: (wsPath: string, sourceRelativePath: string, targetRelativePath: string) => ipcRenderer.invoke('workspace:movePath', wsPath, sourceRelativePath, targetRelativePath),
  deleteWorkspacePath: (wsPath: string, relativePath: string) => ipcRenderer.invoke('workspace:deletePath', wsPath, relativePath),
  readReferences: (wsPath: string, documentPath?: string) => ipcRenderer.invoke('workspace:readReferences', wsPath, documentPath),
  readTaskHistory: (wsPath: string) => ipcRenderer.invoke('workspace:readTaskHistory', wsPath),
  appendTaskHistory: (wsPath: string, task: Record<string, unknown>) => ipcRenderer.invoke('workspace:appendTaskHistory', wsPath, task),
  saveReferences: (wsPath: string, references: unknown[], documentPath?: string) => ipcRenderer.invoke('workspace:saveReferences', wsPath, references, documentPath),
  appendReferences: (wsPath: string, references: unknown[], documentPath?: string) => ipcRenderer.invoke('workspace:appendReferences', wsPath, references, documentPath),
  cropImageFile: (wsPath: string, srcUrl: string, x: number, y: number, w: number, h: number, filename: string) => ipcRenderer.invoke('workspace:cropImage', wsPath, srcUrl, x, y, w, h, filename),
  saveImageToWorkspace: (wsPath: string, filename: string, base64Data: string) => ipcRenderer.invoke('workspace:saveImageToWorkspace', wsPath, filename, base64Data),
  saveImageToFiguresBase64: (wsPath: string, filename: string, base64Data: string) => ipcRenderer.invoke('workspace:saveImageToFiguresBase64', wsPath, filename, base64Data),
  saveImageFromUrl: (wsPath: string, imageUrl: string, filename?: string) => ipcRenderer.invoke('workspace:saveImageFromUrl', wsPath, imageUrl, filename),
  saveImageToFigures: (wsPath: string, imageUrl: string, filename?: string) => ipcRenderer.invoke('workspace:saveImageToFigures', wsPath, imageUrl, filename),
  writeWorkspaceFile: (wsPath: string, relativePath: string, content: string) => ipcRenderer.invoke('workspace:writeFile', wsPath, relativePath, content),
  saveManuscript: (wsPath: string, content: string, filename: string, options?: { templateDocumentId?: string }) => ipcRenderer.invoke('workspace:saveManuscript', wsPath, content, filename, options),
  saveExperimentPlan: (wsPath: string, content: string, filename: string) => ipcRenderer.invoke('workspace:saveExperimentPlan', wsPath, content, filename),
  importFilesToWorkspace: (wsPath: string, targetRelDir?: string) => ipcRenderer.invoke('workspace:importFiles', wsPath, targetRelDir || ''),
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  openDirectoryDialog: () => ipcRenderer.invoke('file:openDirectoryDialog'),
  saveFileDialog: (defaultName: string) => ipcRenderer.invoke('file:saveDialog', defaultName),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  listDirectoryImages: (dirPath: string) => ipcRenderer.invoke('file:listDirectoryImages', dirPath),
  importImageFile: () => ipcRenderer.invoke('file:importImage'),
    readImageAsDataUrl: (filePath: string) => ipcRenderer.invoke('file:readImageAsDataUrl', filePath),
  openExternalFile: (filePath: string) => ipcRenderer.invoke('file:openExternal', filePath),
  openFolderSafe: (targetPath: string, options?: { createIfMissing?: boolean }) =>
    ipcRenderer.invoke('file:openFolderSafe', { targetPath, ...options }),
  openExternalUrl: (url: string) => ipcRenderer.invoke('url:openExternal', url),
  copyFileToPath: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('file:copyToPath', sourcePath, targetPath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  writeDocxFile: (filePath: string, markdown: string) => ipcRenderer.invoke('file:writeDocx', filePath, markdown),
  exportWithJournalFormat: (payload: unknown) => ipcRenderer.invoke('file:exportWithJournalFormat', payload),
  homeworkExtractQuestions: (payload: unknown) => ipcRenderer.invoke('homework:extractQuestions', payload),
  homeworkGenerateAnswer: (question: unknown) => ipcRenderer.invoke('homework:generateAnswer', question),
  homeworkExportMarkdown: (payload: unknown) => ipcRenderer.invoke('homework:exportMarkdown', payload),

  // ---- Internal Account IPC ----
  internalAccountGetToken: () => ipcRenderer.invoke('internalAccount:getToken'),
  internalAccountSetToken: (token: string) => ipcRenderer.invoke('internalAccount:setToken', token),
  internalAccountClearToken: () => ipcRenderer.invoke('internalAccount:clearToken'),
  internalAccountApplyEmailConfig: (config: unknown) => ipcRenderer.invoke('internalAccount:applyEmailConfig', config),

  // ---- Matrix IPC ----
  matrixGetSession: () => ipcRenderer.invoke('matrix:getSession'),
  matrixSetSession: (session: unknown) => ipcRenderer.invoke('matrix:setSession', session),
  matrixClearSession: () => ipcRenderer.invoke('matrix:clearSession'),

  // ---- Email IPC ----
  emailGetAccount: () => ipcRenderer.invoke('email:getAccount'),
  emailSaveAccount: (config: unknown) => ipcRenderer.invoke('email:saveAccount', config),
  emailClearAccount: () => ipcRenderer.invoke('email:clearAccount'),
  emailTestConnection: (config: unknown) => ipcRenderer.invoke('email:testConnection', config),
  emailTestSmtp: (config: unknown) => ipcRenderer.invoke('email:testSmtp', config),
  emailFetchInbox: () => ipcRenderer.invoke('email:fetchInbox'),
  emailFetchSent: () => ipcRenderer.invoke('email:fetchSent'),
  emailFetchTrash: () => ipcRenderer.invoke('email:fetchTrash'),
  emailDeleteMessage: (options: unknown) => ipcRenderer.invoke('email:deleteMessage', options),
  emailRestoreMessage: (options: unknown) => ipcRenderer.invoke('email:restoreMessage', options),
  emailSend: (options: unknown) => ipcRenderer.invoke('email:send', options),
  emailDownloadAttachment: (options: { tempPath: string; filename: string }) =>
    ipcRenderer.invoke('email:downloadAttachment', options),
  mailOpenAttachmentInWorkspace: (options: unknown) =>
    ipcRenderer.invoke('mail:openAttachmentInWorkspace', options),
  emailSelectAttachments: () => ipcRenderer.invoke('email:selectAttachments'),
  continueWriting: (payload: unknown) => ipcRenderer.invoke('ai:continueWriting', payload),
  rewriteParagraph: (payload: unknown) => ipcRenderer.invoke('ai:rewriteParagraph', payload),
  writingAssistant: (payload: unknown) => ipcRenderer.invoke('ai:writingAssistant', payload),
  aiCancelTask: (taskId: string) => ipcRenderer.invoke('ai:cancelTask', taskId),
  organizeReferences: (payload: unknown) => ipcRenderer.invoke('ai:organizeReferences', payload),
  generateOutline: (payload: unknown) => ipcRenderer.invoke('ai:generateOutline', payload),
  analyzeTopic: (payload: unknown) => ipcRenderer.invoke('ai:analyzeTopic', payload),
  generateExperimentPlan: (payload: unknown) => ipcRenderer.invoke('ai:generateExperimentPlan', payload),
  generateImage: (payload: unknown) => ipcRenderer.invoke('ai:generateImage', payload),
  generatePaper: (payload: unknown) => ipcRenderer.invoke('ai:generatePaper', payload),
  compatSubmitTask: (payload: unknown) => ipcRenderer.invoke('compat:submitTask', payload),
  compatGetTaskStatus: (taskId: string) => ipcRenderer.invoke('compat:getTaskStatus', taskId),
  compatGetTaskResult: (taskId: string) => ipcRenderer.invoke('compat:getTaskResult', taskId),
  compatGetActiveTasks: () => ipcRenderer.invoke('compat:getActiveTasks'),
  compatGetRecentTasks: (limit?: number) => ipcRenderer.invoke('compat:getRecentTasks', limit),
  compatPauseTask: (taskId: string) => ipcRenderer.invoke('compat:pauseTask', taskId),
  compatResumeTask: (taskId: string) => ipcRenderer.invoke('compat:resumeTask', taskId),
  compatStopTask: (taskId: string) => ipcRenderer.invoke('compat:stopTask', taskId),
  compatFindCitationForText: (payload: unknown) => ipcRenderer.invoke('compat:findCitationForText', payload),

  // ---- Paper step-by-step IPC ----
  paperInitProject: (params: unknown, workspacePath?: unknown) => ipcRenderer.invoke('paper:initProject', params, workspacePath),
  paperRunSection: (projectId: string, sectionIndex: number) => ipcRenderer.invoke('paper:runSection', projectId, sectionIndex),
  paperRunConclusion: (projectId: string) => ipcRenderer.invoke('paper:runConclusion', projectId),
  paperFinalizeProject: (projectId: string) => ipcRenderer.invoke('paper:finalizeProject', projectId),
  paperGetProject: (projectId: string) => ipcRenderer.invoke('paper:getProject', projectId),
  paperDeleteProject: (projectId: string) => ipcRenderer.invoke('paper:deleteProject', projectId),
  exportPdf: (payload: unknown) => ipcRenderer.invoke('ai:exportPdf', payload),
  exportPdfFromEditor: (payload: unknown) => ipcRenderer.invoke('ai:exportPdfFromEditor', payload),
  generatePptx: (payload: unknown) => ipcRenderer.invoke('pptx:generate', payload),
  pptxSaveContentPackage: (payload: unknown) => ipcRenderer.invoke('pptx:saveContentPackage', payload),
  pptxLoadContentPackage: (payload: unknown) => ipcRenderer.invoke('pptx:loadContentPackage', payload),
  pptxListContentPackages: (payload: unknown) => ipcRenderer.invoke('pptx:listContentPackages', payload),
  pptxRenderWithSkill: (payload: unknown) => ipcRenderer.invoke('pptx:renderWithSkill', payload),
  pptxListSkills: (payload?: unknown) => ipcRenderer.invoke('pptx:listSkills', payload),
  pptxImportFromDialog: (payload: unknown) => ipcRenderer.invoke('pptx:importFromDialog', payload),
  pptxImportFromFile: (payload: unknown) => ipcRenderer.invoke('pptx:importFromFile', payload),

  // ---- DeckDocument IPC (Phase 1 — no LLM, no token cost) ----
  deckSave: (payload: { workspacePath: string; deck: unknown }) => ipcRenderer.invoke('deck:save', payload),
  deckLoad: (payload: { workspacePath: string; deckId: string }) => ipcRenderer.invoke('deck:load', payload),
  deckRender: (payload: { workspacePath: string; deckId: string; manifestId: string; outputPath?: string }) => ipcRenderer.invoke('deck:render', payload),
  deckUpdateSlide: (payload: { workspacePath: string; deckId: string; slideIndex: number; updates: unknown }) => ipcRenderer.invoke('deck:updateSlide', payload),
  deckUpdateDeckDocument: (payload: { workspacePath: string; deckId: string; updates: unknown }) => ipcRenderer.invoke('deck:updateDeckDocument', payload),
  deckOptimizeStructure: (payload: { workspacePath: string; deckId: string }) => ipcRenderer.invoke('deck:optimizeStructure', payload),

  // ---- DeckDocument Builder IPC (LLM-powered — costs tokens for build, zero for render) ----
  deckBuildFromPrompt: (payload: unknown) => ipcRenderer.invoke('deck:buildFromPrompt', payload),
  deckBuildFromManuscript: (payload: unknown) => ipcRenderer.invoke('deck:buildFromManuscript', payload),
  deckBuildFromImportedPptx: (payload: unknown) => ipcRenderer.invoke('deck:buildFromImportedPptx', payload),
  deckExtractPptx: (payload: { pptxPath: string }) => ipcRenderer.invoke('deck:extractPptx', payload),
  deckPreview: (payload: { pptxPath: string; previewDir: string }) => ipcRenderer.invoke('deck:preview', payload),
  onAiEvent: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('ai:event', listener)
    return () => ipcRenderer.removeListener('ai:event', listener)
  },

  // ---- Voice proxy IPC ----
  voiceStart: (): Promise<{ sessionId: string }> => ipcRenderer.invoke('voice:start'),
  voiceSend: (sessionId: string, buffer: ArrayBuffer): void => {
    ipcRenderer.send('voice:send', sessionId, Buffer.from(buffer))
  },
  voiceStop: (sessionId: string): Promise<void> => ipcRenderer.invoke('voice:stop', sessionId),
  onVoiceEvent: (callback: (payload: { sessionId: string; type: string; text?: string; message?: string }) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload as { sessionId: string; type: string; text?: string; message?: string })
    ipcRenderer.on('voice:event', listener)
    return () => ipcRenderer.removeListener('voice:event', listener)
  },

  // ---- Workspace Activity / Daily Report IPC ----
  activityTakeSnapshot: (workspacePath: string) =>
    ipcRenderer.invoke('activity:takeSnapshot', { workspacePath }),
  activityGetActivity: (payload: { workspacePath: string; date?: string; baseDate?: string }) =>
    ipcRenderer.invoke('activity:getActivity', payload),
  activityAnalyzeFiles: (payload: { workspacePath: string; date?: string }) =>
    ipcRenderer.invoke('activity:analyzeFiles', payload),
  activityGenerateReport: (payload: { workspacePath: string; date?: string; username?: string }) =>
    ipcRenderer.invoke('activity:generateReport', payload),
  activityGetReport: (payload: { workspacePath: string; date?: string }) =>
    ipcRenderer.invoke('activity:getReport', payload),
  activitySyncStatus: () =>
    ipcRenderer.invoke('activity:syncStatus'),
  activityFlushSync: () =>
    ipcRenderer.invoke('activity:flushSync'),
  activityAdminFetch: (endpoint: string) =>
    ipcRenderer.invoke('activity:adminFetch', { endpoint }),
  activityAdminPost: (endpoint: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke('activity:adminPost', { endpoint, body }),
  activityLogUserAction: (payload: {
    userId: string; module: string; action: string
    title?: string; summary?: string; workspaceId?: string
    metadata?: Record<string, unknown>; createdAt?: string
  }) =>
    ipcRenderer.invoke('activity:logUserAction', payload),
  activityGetUserActions: (payload: { userId: string; date: string }) =>
    ipcRenderer.invoke('activity:getUserActions', payload),
  activitySetIdentity: (payload: { userId: string; username?: string }) =>
    ipcRenderer.invoke('activity:setIdentity', payload),

  // ---- AI Delegation / 下班托管 IPC ----
  delegationEnable: (payload: { userId: string; workspacePath: string; policyId?: string }) =>
    ipcRenderer.invoke('delegation:enable', payload),
  delegationDisable: (payload: { userId: string }) =>
    ipcRenderer.invoke('delegation:disable', payload),
  delegationGetStatus: () =>
    ipcRenderer.invoke('delegation:getStatus'),
  delegationGetAuditLog: () =>
    ipcRenderer.invoke('delegation:getAuditLog'),
  delegationGetPendingReplies: () =>
    ipcRenderer.invoke('delegation:getPendingReplies'),
  delegationReviewReply: (payload: { replyId: string; action: 'approve' | 'reject'; reviewerUserId: string }) =>
    ipcRenderer.invoke('delegation:reviewReply', payload),
  delegationUploadWorkReport: (payload: unknown) =>
    ipcRenderer.invoke('delegation:uploadWorkReport', payload),
  delegationGenerateAutoReply: (payload: unknown) =>
    ipcRenderer.invoke('delegation:generateAutoReply', payload),

  // ---- Skill Store ----
  openSkillStore: () =>
    ipcRenderer.invoke('skill:openStore'),
  getSkillSyncPlan: (payload?: { userId?: string; deviceId?: string }) =>
    ipcRenderer.invoke('skill:getSyncPlan', payload),
  listMySkins: (payload?: { userId?: string }) =>
    ipcRenderer.invoke('skill:listMySkins', payload),
  downloadSkillPackage: (payload: { skillId: string; packageHash?: string }) =>
    ipcRenderer.invoke('skill:downloadPackage', payload),
  getSkillStoreEmbedUrl: () =>
    ipcRenderer.invoke('skill:getEmbedUrl'),
  recognizeSkillPackage: (payload: { skillId: string; localPath: string }) =>
    ipcRenderer.invoke('skill:recognizePackage', payload),
  listSkillTemplates: () =>
    ipcRenderer.invoke('skill:listTemplates'),

  // ---- Excel Analysis ----
  excelAnalysisRun: (payload: unknown) =>
    ipcRenderer.invoke('excel:analysisRun', payload),
  excelListDataModels: () =>
    ipcRenderer.invoke('excel:listDataModels'),
  excelCheckEnvStatus: () =>
    ipcRenderer.invoke('excel:checkEnvStatus'),
  excelRebuildEnv: () =>
    ipcRenderer.invoke('excel:rebuildEnv'),
  excelPythonDiagnostics: () =>
    ipcRenderer.invoke('excel:pythonDiagnostics'),
  onExcelAnalysisProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('excel:analysisProgress', listener)
    return () => ipcRenderer.removeListener('excel:analysisProgress', listener)
  },
  onExcelAnalysisEnvLog: (callback: (payload: { message: string; ts: string }) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload as { message: string; ts: string })
    ipcRenderer.on('excel:envLog', listener)
    return () => ipcRenderer.removeListener('excel:envLog', listener)
  },
  onExcelAnalysisEnvStatus: (callback: (payload: { status: string; message?: string }) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload as { status: string; message?: string })
    ipcRenderer.on('excel:envStatus', listener)
    return () => ipcRenderer.removeListener('excel:envStatus', listener)
  },
}

let voskTestMode = ''
try {
  voskTestMode = String(ipcRenderer.sendSync('app:getVoskTestMode') || '').trim()
} catch {
  voskTestMode = ''
}

if (voskTestMode) {
  contextBridge.exposeInMainWorld('__AI_WRITER_VOSK_TEST_MODE__', voskTestMode)
}

contextBridge.exposeInMainWorld('electronAPI', api)
contextBridge.exposeInMainWorld('aiOffice', {
  mail: {
    openAttachmentInWorkspace: (options: unknown) =>
      ipcRenderer.invoke('mail:openAttachmentInWorkspace', options),
  },
})

// ---- Personal Library Bridge ----
contextBridge.exposeInMainWorld('personalLibraryAPI', {
  listFolders: () => ipcRenderer.invoke('personal-lib:listFolders'),
  createFolder: (name: string) => ipcRenderer.invoke('personal-lib:createFolder', name),
  renameFolder: (id: string, name: string) => ipcRenderer.invoke('personal-lib:renameFolder', id, name),
  deleteFolder: (id: string) => ipcRenderer.invoke('personal-lib:deleteFolder', id),
  listFiles: (folderId?: string | null) => ipcRenderer.invoke('personal-lib:listFiles', folderId ?? null),
  getFile: (fileId: string) => ipcRenderer.invoke('personal-lib:getFile', fileId),
  getFileContent: (fileId: string) => ipcRenderer.invoke('personal-lib:getFileContent', fileId),
  deleteFile: (fileId: string) => ipcRenderer.invoke('personal-lib:deleteFile', fileId),
  moveFile: (fileId: string, targetFolderId: string | null) => ipcRenderer.invoke('personal-lib:moveFile', fileId, targetFolderId),
  importFiles: (folderId?: string | null) => ipcRenderer.invoke('personal-lib:importFiles', folderId ?? null),
})
