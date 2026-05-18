"use strict";
const electron = require("electron");
function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIntroSettingsPayload(value) {
  return isObjectRecord(value) && !("llm" in value) && !("image" in value) && !("defaults" in value);
}
function mapSettingsForBridge(settings) {
  const record = isObjectRecord(settings) ? settings : {};
  const llm = isObjectRecord(record.llm) ? record.llm : {};
  return {
    ...record,
    provider: String(llm.provider || "qwen"),
    apiKey: String(llm.apiKey || ""),
    model: String(llm.model || ""),
    customEndpoint: String(llm.baseUrl || ""),
    backendUrl: String(record.backendUrl || "")
  };
}
function mapIntroSettingsPayload(payload) {
  const rawProvider = String(payload.provider || "qwen").trim();
  const provider = rawProvider === "nftcore" ? "deepseek" : rawProvider;
  const apiKey = String(payload.apiKey || "").trim();
  return {
    llm: {
      provider,
      apiKey,
      useBuiltinKey: apiKey.length === 0,
      model: String(payload.model || "").trim(),
      baseUrl: String(payload.customEndpoint || "").trim()
    }
  };
}
const api = {
  getAppInfo: async () => mapSettingsForBridge(await electron.ipcRenderer.invoke("app:getInfo")),
  resolveAppCloseRequest: (resolution) => electron.ipcRenderer.invoke("app:resolveCloseRequest", resolution),
  onAppCloseRequest: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("app:requestClose", listener);
    return () => electron.ipcRenderer.removeListener("app:requestClose", listener);
  },
  getSettings: async () => mapSettingsForBridge(await electron.ipcRenderer.invoke("settings:get")),
  saveSettings: async (payload) => {
    const normalizedPayload = isIntroSettingsPayload(payload) ? mapIntroSettingsPayload(payload) : payload;
    return mapSettingsForBridge(await electron.ipcRenderer.invoke("settings:save", normalizedPayload));
  },
  returnToSuiteLauncher: () => electron.ipcRenderer.invoke("suite:returnToLauncher"),
  testLlmConnection: (payload) => {
    if (payload !== void 0) {
      return electron.ipcRenderer.invoke("introRemake:testLlmSettings", payload);
    }
    return electron.ipcRenderer.invoke("settings:testLlm");
  },
  testImageConnection: () => electron.ipcRenderer.invoke("settings:testImage"),
  launchCompanionApp: (appId) => electron.ipcRenderer.invoke("suite:launchCompanion", appId),
  onSuiteNavigate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("suite:navigate", listener);
    return () => electron.ipcRenderer.removeListener("suite:navigate", listener);
  },
  getIntroductionRemakeServiceInfo: () => electron.ipcRenderer.invoke("introRemake:getServiceInfo"),
  getIntroductionAllowedJournals: () => electron.ipcRenderer.invoke("introRemake:getAllowedJournals"),
  getIntroductionRecentTasks: () => electron.ipcRenderer.invoke("introRemake:listRecentTasks"),
  saveIntroductionTaskSnapshot: (payload) => electron.ipcRenderer.invoke("introRemake:saveTaskSnapshot", payload),
  exportIntroductionBundle: (payload) => electron.ipcRenderer.invoke("introRemake:exportBundle", payload),
  testIntroductionLlmSettings: (settings) => electron.ipcRenderer.invoke("introRemake:testLlmSettings", settings),
  inferIntroductionTopicMeta: (introductionText) => electron.ipcRenderer.invoke("introRemake:inferTopicMeta", introductionText),
  buildIntroductionAllowlistedPool: (payload) => electron.ipcRenderer.invoke("introRemake:buildAllowlistedPool", payload),
  generateIntroductionDraft: (payload) => electron.ipcRenderer.invoke("introRemake:generateDraft", payload),
  startGenerateIntroductionDraftStream: (payload) => electron.ipcRenderer.invoke("introRemake:startGenerateDraftStream", payload),
  cancelGenerateIntroductionDraftStream: (streamId) => electron.ipcRenderer.invoke("introRemake:cancelGenerateDraftStream", streamId),
  onGenerateIntroductionDraftStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("introRemake:generateDraftStreamEvent", listener);
    return () => electron.ipcRenderer.removeListener("introRemake:generateDraftStreamEvent", listener);
  },
  remapIntroductionDraft: (payload) => electron.ipcRenderer.invoke("introRemake:remapDraft", payload),
  getPlotAgentStatus: () => electron.ipcRenderer.invoke("plot:status"),
  getPlotChartTypes: () => electron.ipcRenderer.invoke("plot:types"),
  recommendPlot: (payload) => electron.ipcRenderer.invoke("plot:recommend", payload),
  generatePlot: (payload) => electron.ipcRenderer.invoke("plot:generate", payload),
  createRealtimePlotSession: (payload) => electron.ipcRenderer.invoke("plot:realtimeCreateSession", payload),
  addRealtimePlotPoint: (payload) => electron.ipcRenderer.invoke("plot:realtimeAddPoint", payload),
  addRealtimePlotBatch: (payload) => electron.ipcRenderer.invoke("plot:realtimeAddBatch", payload),
  getRealtimePlot: (sessionId) => electron.ipcRenderer.invoke("plot:realtimeGetPlot", sessionId),
  getRealtimePlotStatus: (sessionId) => electron.ipcRenderer.invoke("plot:realtimeGetStatus", sessionId),
  deleteRealtimePlotSession: (sessionId) => electron.ipcRenderer.invoke("plot:realtimeDeleteSession", sessionId),
  getActiveDocumentEngine: () => electron.ipcRenderer.invoke("documentEngine:getActive"),
  setPreferredDocumentEngine: (engineId) => electron.ipcRenderer.invoke("documentEngine:setPreferred", engineId),
  readOoxmlPackage: (filePath) => electron.ipcRenderer.invoke("documentEngine:readOoxmlPackage", filePath),
  writeOoxmlPackage: (filePath, payload) => electron.ipcRenderer.invoke("documentEngine:writeOoxmlPackage", filePath, payload),
  // ---- 正式模板模式 IPC（formal template mode） ----
  analyzeFormalTemplate: (payload) => electron.ipcRenderer.invoke("formalTemplate:analyze", payload),
  confirmFormalTemplateFields: (payload) => electron.ipcRenderer.invoke("formalTemplate:confirmFields", payload),
  previewFormalTemplateTask: (payload) => electron.ipcRenderer.invoke("formalTemplate:preview", payload),
  commitFormalTemplateTask: (payload) => electron.ipcRenderer.invoke("formalTemplate:commit", payload),
  listWorkspaces: () => electron.ipcRenderer.invoke("workspace:list"),
  // ---- Department IPC ----
  listDepartments: () => electron.ipcRenderer.invoke("department:list"),
  createDepartment: (name, nameEn) => electron.ipcRenderer.invoke("department:create", name, nameEn),
  renameDepartment: (id, name, nameEn) => electron.ipcRenderer.invoke("department:rename", id, name, nameEn),
  deleteDepartment: (id) => electron.ipcRenderer.invoke("department:delete", id),
  getDefaultDepartmentId: () => electron.ipcRenderer.invoke("department:getDefault"),
  // ---- Knowledge IPC (department-aware) ----
  getKnowledgeBaseInfo: (departmentId) => electron.ipcRenderer.invoke("knowledge:getInfo", departmentId),
  listKnowledgeDocuments: (departmentId, query) => electron.ipcRenderer.invoke("knowledge:listDocuments", departmentId, query),
  getKnowledgeDocument: (departmentId, documentId) => electron.ipcRenderer.invoke("knowledge:getDocument", departmentId, documentId),
  getKnowledgeDocumentVersion: (departmentId, documentId, versionId) => electron.ipcRenderer.invoke("knowledge:getDocumentVersion", departmentId, documentId, versionId),
  listKnowledgeDocumentChunks: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:listDocumentChunks", departmentId, payload),
  retrieveKnowledgeChunks: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:retrieveChunks", departmentId, payload),
  previewKnowledgeTaskContext: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:previewTaskContext", departmentId, payload),
  importKnowledgeDocuments: (departmentId) => electron.ipcRenderer.invoke("knowledge:importDocuments", departmentId),
  importKnowledgeDocumentFromPath: (departmentId, filePath) => electron.ipcRenderer.invoke("knowledge:importDocumentFromPath", departmentId, filePath),
  ensureReadingSeedDocuments: (departmentId) => electron.ipcRenderer.invoke("knowledge:ensureReadingSeeds", departmentId),
  materializeKnowledgeWorkspace: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:materializeWorkspace", departmentId, payload),
  deleteKnowledgeDocument: (departmentId, documentId) => electron.ipcRenderer.invoke("knowledge:deleteDocument", departmentId, documentId),
  setKnowledgeCurrentVersion: (departmentId, documentId, versionId) => electron.ipcRenderer.invoke("knowledge:setCurrentVersion", departmentId, documentId, versionId),
  submitKnowledgeRemakeTask: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:submitRemakeTask", departmentId, payload),
  saveKnowledgeTaskRecord: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:saveTaskRecord", departmentId, payload),
  createKnowledgeRemakeVersion: (departmentId, payload) => electron.ipcRenderer.invoke("knowledge:createRemakeVersion", departmentId, payload),
  classifyKnowledgeDocument: (departmentId, documentId) => electron.ipcRenderer.invoke("knowledge:classifyDocument", departmentId, documentId),
  updateKnowledgeDocumentCategory: (departmentId, documentId, category) => electron.ipcRenderer.invoke("knowledge:updateDocumentCategory", departmentId, documentId, category),
  createWorkspace: (name, parentDir) => electron.ipcRenderer.invoke("workspace:create", name, parentDir),
  renameWorkspace: (wsPath, nextName) => electron.ipcRenderer.invoke("workspace:rename", wsPath, nextName),
  registerWorkspace: (wsPath) => electron.ipcRenderer.invoke("workspace:register", wsPath),
  getWorkspaceTree: (wsPath) => electron.ipcRenderer.invoke("workspace:tree", wsPath),
  readWorkspaceDocumentSchema: (wsPath) => electron.ipcRenderer.invoke("workspace:readDocumentSchema", wsPath),
  saveWorkspaceDocumentSchema: (wsPath, document) => electron.ipcRenderer.invoke("workspace:saveDocumentSchema", wsPath, document),
  deleteWorkspace: (wsPath) => electron.ipcRenderer.invoke("workspace:delete", wsPath),
  detectProjectStructure: (wsPath) => electron.ipcRenderer.invoke("workspace:detectProjectStructure", wsPath),
  createWorkspaceFolder: (wsPath, relativePath) => electron.ipcRenderer.invoke("workspace:createFolder", wsPath, relativePath),
  createWorkspaceFile: (wsPath, relativePath) => electron.ipcRenderer.invoke("workspace:createFile", wsPath, relativePath),
  createBlankDocument: (wsPath, relativePath) => electron.ipcRenderer.invoke("workspace:createBlankDocument", wsPath, relativePath),
  renameWorkspacePath: (wsPath, oldRelativePath, newRelativePath) => electron.ipcRenderer.invoke("workspace:renamePath", wsPath, oldRelativePath, newRelativePath),
  copyWorkspacePath: (wsPath, sourceRelativePath, targetRelativePath) => electron.ipcRenderer.invoke("workspace:copyPath", wsPath, sourceRelativePath, targetRelativePath),
  moveWorkspacePath: (wsPath, sourceRelativePath, targetRelativePath) => electron.ipcRenderer.invoke("workspace:movePath", wsPath, sourceRelativePath, targetRelativePath),
  deleteWorkspacePath: (wsPath, relativePath) => electron.ipcRenderer.invoke("workspace:deletePath", wsPath, relativePath),
  readReferences: (wsPath, documentPath) => electron.ipcRenderer.invoke("workspace:readReferences", wsPath, documentPath),
  readTaskHistory: (wsPath) => electron.ipcRenderer.invoke("workspace:readTaskHistory", wsPath),
  appendTaskHistory: (wsPath, task) => electron.ipcRenderer.invoke("workspace:appendTaskHistory", wsPath, task),
  saveReferences: (wsPath, references, documentPath) => electron.ipcRenderer.invoke("workspace:saveReferences", wsPath, references, documentPath),
  appendReferences: (wsPath, references, documentPath) => electron.ipcRenderer.invoke("workspace:appendReferences", wsPath, references, documentPath),
  cropImageFile: (wsPath, srcUrl, x, y, w, h, filename) => electron.ipcRenderer.invoke("workspace:cropImage", wsPath, srcUrl, x, y, w, h, filename),
  saveImageToWorkspace: (wsPath, filename, base64Data) => electron.ipcRenderer.invoke("workspace:saveImageToWorkspace", wsPath, filename, base64Data),
  saveImageToFiguresBase64: (wsPath, filename, base64Data) => electron.ipcRenderer.invoke("workspace:saveImageToFiguresBase64", wsPath, filename, base64Data),
  saveImageFromUrl: (wsPath, imageUrl, filename) => electron.ipcRenderer.invoke("workspace:saveImageFromUrl", wsPath, imageUrl, filename),
  saveImageToFigures: (wsPath, imageUrl, filename) => electron.ipcRenderer.invoke("workspace:saveImageToFigures", wsPath, imageUrl, filename),
  writeWorkspaceFile: (wsPath, relativePath, content) => electron.ipcRenderer.invoke("workspace:writeFile", wsPath, relativePath, content),
  saveManuscript: (wsPath, content, filename, options) => electron.ipcRenderer.invoke("workspace:saveManuscript", wsPath, content, filename, options),
  saveExperimentPlan: (wsPath, content, filename) => electron.ipcRenderer.invoke("workspace:saveExperimentPlan", wsPath, content, filename),
  importFilesToWorkspace: (wsPath, targetRelDir) => electron.ipcRenderer.invoke("workspace:importFiles", wsPath, targetRelDir || ""),
  openFileDialog: () => electron.ipcRenderer.invoke("file:openDialog"),
  openDirectoryDialog: () => electron.ipcRenderer.invoke("file:openDirectoryDialog"),
  saveFileDialog: (defaultName) => electron.ipcRenderer.invoke("file:saveDialog", defaultName),
  readFile: (filePath) => electron.ipcRenderer.invoke("file:read", filePath),
  listDirectoryImages: (dirPath) => electron.ipcRenderer.invoke("file:listDirectoryImages", dirPath),
  importImageFile: () => electron.ipcRenderer.invoke("file:importImage"),
  readImageAsDataUrl: (filePath) => electron.ipcRenderer.invoke("file:readImageAsDataUrl", filePath),
  openExternalFile: (filePath) => electron.ipcRenderer.invoke("file:openExternal", filePath),
  openFolderSafe: (targetPath, options) => electron.ipcRenderer.invoke("file:openFolderSafe", { targetPath, ...options }),
  openExternalUrl: (url) => electron.ipcRenderer.invoke("url:openExternal", url),
  copyFileToPath: (sourcePath, targetPath) => electron.ipcRenderer.invoke("file:copyToPath", sourcePath, targetPath),
  writeFile: (filePath, content) => electron.ipcRenderer.invoke("file:write", filePath, content),
  writeDocxFile: (filePath, markdown) => electron.ipcRenderer.invoke("file:writeDocx", filePath, markdown),
  exportWithJournalFormat: (payload) => electron.ipcRenderer.invoke("file:exportWithJournalFormat", payload),
  homeworkExtractQuestions: (payload) => electron.ipcRenderer.invoke("homework:extractQuestions", payload),
  homeworkGenerateAnswer: (question) => electron.ipcRenderer.invoke("homework:generateAnswer", question),
  homeworkExportMarkdown: (payload) => electron.ipcRenderer.invoke("homework:exportMarkdown", payload),
  // ---- Internal Account IPC ----
  internalAccountGetToken: () => electron.ipcRenderer.invoke("internalAccount:getToken"),
  internalAccountSetToken: (token) => electron.ipcRenderer.invoke("internalAccount:setToken", token),
  internalAccountClearToken: () => electron.ipcRenderer.invoke("internalAccount:clearToken"),
  internalAccountApplyEmailConfig: (config) => electron.ipcRenderer.invoke("internalAccount:applyEmailConfig", config),
  // ---- Matrix IPC ----
  matrixGetSession: () => electron.ipcRenderer.invoke("matrix:getSession"),
  matrixSetSession: (session) => electron.ipcRenderer.invoke("matrix:setSession", session),
  matrixClearSession: () => electron.ipcRenderer.invoke("matrix:clearSession"),
  // ---- Email IPC ----
  emailGetAccount: () => electron.ipcRenderer.invoke("email:getAccount"),
  emailSaveAccount: (config) => electron.ipcRenderer.invoke("email:saveAccount", config),
  emailClearAccount: () => electron.ipcRenderer.invoke("email:clearAccount"),
  emailTestConnection: (config) => electron.ipcRenderer.invoke("email:testConnection", config),
  emailTestSmtp: (config) => electron.ipcRenderer.invoke("email:testSmtp", config),
  emailFetchInbox: () => electron.ipcRenderer.invoke("email:fetchInbox"),
  emailFetchSent: () => electron.ipcRenderer.invoke("email:fetchSent"),
  emailFetchTrash: () => electron.ipcRenderer.invoke("email:fetchTrash"),
  emailDeleteMessage: (options) => electron.ipcRenderer.invoke("email:deleteMessage", options),
  emailRestoreMessage: (options) => electron.ipcRenderer.invoke("email:restoreMessage", options),
  emailSend: (options) => electron.ipcRenderer.invoke("email:send", options),
  emailDownloadAttachment: (options) => electron.ipcRenderer.invoke("email:downloadAttachment", options),
  mailOpenAttachmentInWorkspace: (options) => electron.ipcRenderer.invoke("mail:openAttachmentInWorkspace", options),
  emailSelectAttachments: () => electron.ipcRenderer.invoke("email:selectAttachments"),
  continueWriting: (payload) => electron.ipcRenderer.invoke("ai:continueWriting", payload),
  rewriteParagraph: (payload) => electron.ipcRenderer.invoke("ai:rewriteParagraph", payload),
  writingAssistant: (payload) => electron.ipcRenderer.invoke("ai:writingAssistant", payload),
  aiCancelTask: (taskId) => electron.ipcRenderer.invoke("ai:cancelTask", taskId),
  organizeReferences: (payload) => electron.ipcRenderer.invoke("ai:organizeReferences", payload),
  generateOutline: (payload) => electron.ipcRenderer.invoke("ai:generateOutline", payload),
  analyzeTopic: (payload) => electron.ipcRenderer.invoke("ai:analyzeTopic", payload),
  generateExperimentPlan: (payload) => electron.ipcRenderer.invoke("ai:generateExperimentPlan", payload),
  generateImage: (payload) => electron.ipcRenderer.invoke("ai:generateImage", payload),
  generatePaper: (payload) => electron.ipcRenderer.invoke("ai:generatePaper", payload),
  compatSubmitTask: (payload) => electron.ipcRenderer.invoke("compat:submitTask", payload),
  compatGetTaskStatus: (taskId) => electron.ipcRenderer.invoke("compat:getTaskStatus", taskId),
  compatGetTaskResult: (taskId) => electron.ipcRenderer.invoke("compat:getTaskResult", taskId),
  compatGetActiveTasks: () => electron.ipcRenderer.invoke("compat:getActiveTasks"),
  compatGetRecentTasks: (limit) => electron.ipcRenderer.invoke("compat:getRecentTasks", limit),
  compatPauseTask: (taskId) => electron.ipcRenderer.invoke("compat:pauseTask", taskId),
  compatResumeTask: (taskId) => electron.ipcRenderer.invoke("compat:resumeTask", taskId),
  compatStopTask: (taskId) => electron.ipcRenderer.invoke("compat:stopTask", taskId),
  compatFindCitationForText: (payload) => electron.ipcRenderer.invoke("compat:findCitationForText", payload),
  // ---- Paper step-by-step IPC ----
  paperInitProject: (params, workspacePath) => electron.ipcRenderer.invoke("paper:initProject", params, workspacePath),
  paperRunSection: (projectId, sectionIndex) => electron.ipcRenderer.invoke("paper:runSection", projectId, sectionIndex),
  paperRunConclusion: (projectId) => electron.ipcRenderer.invoke("paper:runConclusion", projectId),
  paperFinalizeProject: (projectId) => electron.ipcRenderer.invoke("paper:finalizeProject", projectId),
  paperGetProject: (projectId) => electron.ipcRenderer.invoke("paper:getProject", projectId),
  paperDeleteProject: (projectId) => electron.ipcRenderer.invoke("paper:deleteProject", projectId),
  exportPdf: (payload) => electron.ipcRenderer.invoke("ai:exportPdf", payload),
  exportPdfFromEditor: (payload) => electron.ipcRenderer.invoke("ai:exportPdfFromEditor", payload),
  generatePptx: (payload) => electron.ipcRenderer.invoke("pptx:generate", payload),
  pptxSaveContentPackage: (payload) => electron.ipcRenderer.invoke("pptx:saveContentPackage", payload),
  pptxLoadContentPackage: (payload) => electron.ipcRenderer.invoke("pptx:loadContentPackage", payload),
  pptxListContentPackages: (payload) => electron.ipcRenderer.invoke("pptx:listContentPackages", payload),
  pptxRenderWithSkill: (payload) => electron.ipcRenderer.invoke("pptx:renderWithSkill", payload),
  pptxListSkills: (payload) => electron.ipcRenderer.invoke("pptx:listSkills", payload),
  pptxImportFromDialog: (payload) => electron.ipcRenderer.invoke("pptx:importFromDialog", payload),
  pptxImportFromFile: (payload) => electron.ipcRenderer.invoke("pptx:importFromFile", payload),
  // ---- DeckDocument IPC (Phase 1 — no LLM, no token cost) ----
  deckSave: (payload) => electron.ipcRenderer.invoke("deck:save", payload),
  deckLoad: (payload) => electron.ipcRenderer.invoke("deck:load", payload),
  deckRender: (payload) => electron.ipcRenderer.invoke("deck:render", payload),
  deckUpdateSlide: (payload) => electron.ipcRenderer.invoke("deck:updateSlide", payload),
  deckUpdateDeckDocument: (payload) => electron.ipcRenderer.invoke("deck:updateDeckDocument", payload),
  deckOptimizeStructure: (payload) => electron.ipcRenderer.invoke("deck:optimizeStructure", payload),
  // ---- DeckDocument Builder IPC (LLM-powered — costs tokens for build, zero for render) ----
  deckBuildFromPrompt: (payload) => electron.ipcRenderer.invoke("deck:buildFromPrompt", payload),
  deckBuildFromManuscript: (payload) => electron.ipcRenderer.invoke("deck:buildFromManuscript", payload),
  deckBuildFromImportedPptx: (payload) => electron.ipcRenderer.invoke("deck:buildFromImportedPptx", payload),
  deckExtractPptx: (payload) => electron.ipcRenderer.invoke("deck:extractPptx", payload),
  deckPreview: (payload) => electron.ipcRenderer.invoke("deck:preview", payload),
  onAiEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("ai:event", listener);
    return () => electron.ipcRenderer.removeListener("ai:event", listener);
  },
  // ---- Voice proxy IPC ----
  voiceStart: () => electron.ipcRenderer.invoke("voice:start"),
  voiceSend: (sessionId, buffer) => {
    electron.ipcRenderer.send("voice:send", sessionId, Buffer.from(buffer));
  },
  voiceStop: (sessionId) => electron.ipcRenderer.invoke("voice:stop", sessionId),
  onVoiceEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("voice:event", listener);
    return () => electron.ipcRenderer.removeListener("voice:event", listener);
  },
  // ---- Workspace Activity / Daily Report IPC ----
  activityTakeSnapshot: (workspacePath) => electron.ipcRenderer.invoke("activity:takeSnapshot", { workspacePath }),
  activityGetActivity: (payload) => electron.ipcRenderer.invoke("activity:getActivity", payload),
  activityAnalyzeFiles: (payload) => electron.ipcRenderer.invoke("activity:analyzeFiles", payload),
  activityGenerateReport: (payload) => electron.ipcRenderer.invoke("activity:generateReport", payload),
  activityGetReport: (payload) => electron.ipcRenderer.invoke("activity:getReport", payload),
  activitySyncStatus: () => electron.ipcRenderer.invoke("activity:syncStatus"),
  activityFlushSync: () => electron.ipcRenderer.invoke("activity:flushSync"),
  activityAdminFetch: (endpoint) => electron.ipcRenderer.invoke("activity:adminFetch", { endpoint }),
  activityAdminPost: (endpoint, body) => electron.ipcRenderer.invoke("activity:adminPost", { endpoint, body }),
  activityLogUserAction: (payload) => electron.ipcRenderer.invoke("activity:logUserAction", payload),
  activityGetUserActions: (payload) => electron.ipcRenderer.invoke("activity:getUserActions", payload),
  activitySetIdentity: (payload) => electron.ipcRenderer.invoke("activity:setIdentity", payload),
  // ---- AI Delegation / 下班托管 IPC ----
  delegationEnable: (payload) => electron.ipcRenderer.invoke("delegation:enable", payload),
  delegationDisable: (payload) => electron.ipcRenderer.invoke("delegation:disable", payload),
  delegationGetStatus: () => electron.ipcRenderer.invoke("delegation:getStatus"),
  delegationGetAuditLog: () => electron.ipcRenderer.invoke("delegation:getAuditLog"),
  delegationGetPendingReplies: () => electron.ipcRenderer.invoke("delegation:getPendingReplies"),
  delegationReviewReply: (payload) => electron.ipcRenderer.invoke("delegation:reviewReply", payload),
  delegationUploadWorkReport: (payload) => electron.ipcRenderer.invoke("delegation:uploadWorkReport", payload),
  delegationGenerateAutoReply: (payload) => electron.ipcRenderer.invoke("delegation:generateAutoReply", payload),
  // ---- Skill Store ----
  openSkillStore: () => electron.ipcRenderer.invoke("skill:openStore"),
  getSkillSyncPlan: (payload) => electron.ipcRenderer.invoke("skill:getSyncPlan", payload),
  listMySkins: (payload) => electron.ipcRenderer.invoke("skill:listMySkins", payload),
  downloadSkillPackage: (payload) => electron.ipcRenderer.invoke("skill:downloadPackage", payload),
  getSkillStoreEmbedUrl: () => electron.ipcRenderer.invoke("skill:getEmbedUrl"),
  recognizeSkillPackage: (payload) => electron.ipcRenderer.invoke("skill:recognizePackage", payload),
  listSkillTemplates: () => electron.ipcRenderer.invoke("skill:listTemplates"),
  // ---- Excel Analysis ----
  excelAnalysisRun: (payload) => electron.ipcRenderer.invoke("excel:analysisRun", payload),
  excelListDataModels: () => electron.ipcRenderer.invoke("excel:listDataModels"),
  excelCheckEnvStatus: () => electron.ipcRenderer.invoke("excel:checkEnvStatus"),
  excelRebuildEnv: () => electron.ipcRenderer.invoke("excel:rebuildEnv"),
  excelPythonDiagnostics: () => electron.ipcRenderer.invoke("excel:pythonDiagnostics"),
  onExcelAnalysisProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("excel:analysisProgress", listener);
    return () => electron.ipcRenderer.removeListener("excel:analysisProgress", listener);
  },
  onExcelAnalysisEnvLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("excel:envLog", listener);
    return () => electron.ipcRenderer.removeListener("excel:envLog", listener);
  },
  onExcelAnalysisEnvStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("excel:envStatus", listener);
    return () => electron.ipcRenderer.removeListener("excel:envStatus", listener);
  }
};
let voskTestMode = "";
try {
  voskTestMode = String(electron.ipcRenderer.sendSync("app:getVoskTestMode") || "").trim();
} catch {
  voskTestMode = "";
}
if (voskTestMode) {
  electron.contextBridge.exposeInMainWorld("__AI_WRITER_VOSK_TEST_MODE__", voskTestMode);
}
electron.contextBridge.exposeInMainWorld("electronAPI", api);
electron.contextBridge.exposeInMainWorld("aiOffice", {
  mail: {
    openAttachmentInWorkspace: (options) => electron.ipcRenderer.invoke("mail:openAttachmentInWorkspace", options)
  }
});
electron.contextBridge.exposeInMainWorld("personalLibraryAPI", {
  listFolders: () => electron.ipcRenderer.invoke("personal-lib:listFolders"),
  createFolder: (name) => electron.ipcRenderer.invoke("personal-lib:createFolder", name),
  renameFolder: (id, name) => electron.ipcRenderer.invoke("personal-lib:renameFolder", id, name),
  deleteFolder: (id) => electron.ipcRenderer.invoke("personal-lib:deleteFolder", id),
  listFiles: (folderId) => electron.ipcRenderer.invoke("personal-lib:listFiles", folderId ?? null),
  getFile: (fileId) => electron.ipcRenderer.invoke("personal-lib:getFile", fileId),
  getFileContent: (fileId) => electron.ipcRenderer.invoke("personal-lib:getFileContent", fileId),
  deleteFile: (fileId) => electron.ipcRenderer.invoke("personal-lib:deleteFile", fileId),
  moveFile: (fileId, targetFolderId) => electron.ipcRenderer.invoke("personal-lib:moveFile", fileId, targetFolderId),
  importFiles: (folderId) => electron.ipcRenderer.invoke("personal-lib:importFiles", folderId ?? null)
});
