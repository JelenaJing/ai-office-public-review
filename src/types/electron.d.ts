import type { AppSettings } from '../../electron/main/services/settingsStore'
import type { OoxmlPackageSnapshot, OoxmlWritePayload, OoxmlWriteResult } from '../../electron/main/services/documentEngineService'
import type { GenerateImagePayload } from './imageGeneration'
import type { DocumentSchema } from '../document/schema'
import type { MailAttachmentOpenRequest, MailAttachmentOpenResult } from './mailAttachment'
import type {
  CreateKnowledgeRemakeVersionInput,
  Department,
  KnowledgeDocumentDetail,
  KnowledgeChunkMeta,
  KnowledgeRetrievalQuery,
  KnowledgeRetrievalResult,
  KnowledgeDocumentMeta,
  KnowledgeDocumentVersionDetail,
  KnowledgeImportResult,
  KnowledgeLibraryInfo,
  KnowledgeRemakeTaskParams,
  MaterializeKnowledgeWorkspaceInput,
  MaterializeKnowledgeWorkspaceResult,
  PreviewKnowledgeTaskContextInput,
  PreviewKnowledgeTaskContextResult,
  KnowledgeTaskRecord,
  SaveKnowledgeTaskInput,
} from './knowledge'

type IntroBridgeSettings = {
  provider: string
  apiKey: string
  model: string
  customEndpoint: string
  backendUrl: string
}

type ElectronGenerateImagePayload = GenerateImagePayload & {
  primaryImageId?: string | null
  selectedStyleImageIds?: string[]
  referenceImages?: Array<Record<string, unknown>>
}

declare global {
  type EmailIpcSuccess<T = void> = { ok: true } & (T extends void ? Record<string, never> : T)
  type EmailIpcFailure = {
    ok: false
    error: {
      message: string
      code?: string
      command?: string
      responseCode?: number | string
      /** Structured error code for programmatic handling */
      errorCode?: import('./email').EmailErrorCode
      needsModernAuth?: boolean
    }
  }
  type EmailFetchResult = EmailIpcSuccess<{ mails: import('./email').MailItem[] }> | EmailIpcFailure
  type EmailSendResult = EmailIpcSuccess | EmailIpcFailure
  type EmailDownloadResult =
    | { ok: true; canceled: boolean; savedPath?: string }
    | { ok: false; error: { message: string; errorCode?: string } }

  interface Window {
    aiOffice?: {
      mail?: {
        openAttachmentInWorkspace: (options: MailAttachmentOpenRequest) => Promise<MailAttachmentOpenResult>
      }
    }
    electronAPI: {
      getAppInfo: () => Promise<Record<string, unknown>>
      resolveAppCloseRequest: (resolution: 'close' | 'cancel') => Promise<{ success: boolean; canceled?: boolean }>
      onAppCloseRequest: (callback: () => void) => () => void
      getSettings: () => Promise<AppSettings & IntroBridgeSettings>
      saveSettings: (payload: Partial<AppSettings> | Partial<IntroBridgeSettings>) => Promise<AppSettings & IntroBridgeSettings>
      returnToSuiteLauncher: () => Promise<{ success: boolean; message: string }>
      testLlmConnection: (payload?: Record<string, unknown>) => Promise<string>
      testImageConnection: () => Promise<string>
      launchCompanionApp: (appId: string) => Promise<{ success: boolean; mode: 'launched'; message: string }>
      onSuiteNavigate: (callback: (payload: unknown) => void) => () => void
      getIntroductionRemakeServiceInfo: () => Promise<Record<string, unknown>>
      getIntroductionAllowedJournals: () => Promise<Array<Record<string, unknown>>>
      getIntroductionRecentTasks: () => Promise<Array<{ id: string; topic: string; sourceLength: number; poolCount: number; referenceCount: number; sequentialLength: number; status: 'draft' | 'delivered' | 'exported'; provider?: string; model?: string; updatedAt: string; exportDir?: string }>>
      saveIntroductionTaskSnapshot: (payload: Record<string, unknown>) => Promise<{ task: { id: string; topic: string; sourceLength: number; poolCount: number; referenceCount: number; sequentialLength: number; status: 'draft' | 'delivered' | 'exported'; provider?: string; model?: string; updatedAt: string; exportDir?: string }; tasks: Array<{ id: string; topic: string; sourceLength: number; poolCount: number; referenceCount: number; sequentialLength: number; status: 'draft' | 'delivered' | 'exported'; provider?: string; model?: string; updatedAt: string; exportDir?: string }> }>
      exportIntroductionBundle: (payload: Record<string, unknown>) => Promise<{ success: boolean; canceled: boolean; outputDir?: string; files?: string[]; task?: { id: string; topic: string; sourceLength: number; poolCount: number; referenceCount: number; sequentialLength: number; status: 'draft' | 'delivered' | 'exported'; provider?: string; model?: string; updatedAt: string; exportDir?: string }; tasks?: Array<{ id: string; topic: string; sourceLength: number; poolCount: number; referenceCount: number; sequentialLength: number; status: 'draft' | 'delivered' | 'exported'; provider?: string; model?: string; updatedAt: string; exportDir?: string }> }>
      testIntroductionLlmSettings: (settings: Record<string, unknown>) => Promise<string>
      inferIntroductionTopicMeta: (introductionText: string) => Promise<Record<string, unknown>>
      buildIntroductionAllowlistedPool: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      generateIntroductionDraft: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      startGenerateIntroductionDraftStream: (payload: Record<string, unknown>) => Promise<{ streamId: string }>
      cancelGenerateIntroductionDraftStream: (streamId: string) => Promise<{ success: boolean }>
      onGenerateIntroductionDraftStreamEvent: (callback: (payload: unknown) => void) => () => void
      remapIntroductionDraft: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      getPlotAgentStatus: () => Promise<{ ready: boolean; running: boolean; baseUrl: string; port: number; pythonCommand: string | null; agentRoot: string | null; lastError?: string | null }>
      getPlotChartTypes: () => Promise<Record<string, unknown>>
      recommendPlot: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      generatePlot: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      createRealtimePlotSession: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      addRealtimePlotPoint: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      addRealtimePlotBatch: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      getRealtimePlot: (sessionId: string) => Promise<Record<string, unknown>>
      getRealtimePlotStatus: (sessionId: string) => Promise<Record<string, unknown>>
      deleteRealtimePlotSession: (sessionId: string) => Promise<Record<string, unknown>>
      getActiveDocumentEngine: () => Promise<{ engineId: 'legacy-tiptap-bridge' | 'embedded-office-engine'; availableEngineIds: Array<'legacy-tiptap-bridge' | 'embedded-office-engine'> }>
      setPreferredDocumentEngine: (engineId: 'legacy-tiptap-bridge' | 'embedded-office-engine') => Promise<{ engineId: 'legacy-tiptap-bridge' | 'embedded-office-engine'; availableEngineIds: Array<'legacy-tiptap-bridge' | 'embedded-office-engine'> }>
      getKnowledgeBaseInfo: (departmentId?: string) => Promise<KnowledgeLibraryInfo>
      listKnowledgeDocuments: (departmentId?: string, query?: string) => Promise<KnowledgeDocumentMeta[]>
      getKnowledgeDocument: (departmentId: string, documentId: string) => Promise<KnowledgeDocumentDetail | null>
      getKnowledgeDocumentVersion: (departmentId: string, documentId: string, versionId: string) => Promise<KnowledgeDocumentVersionDetail | null>
      listKnowledgeDocumentChunks: (departmentId: string, payload: { documentId: string; versionId?: string }) => Promise<KnowledgeChunkMeta[]>
      retrieveKnowledgeChunks: (departmentId: string, payload: KnowledgeRetrievalQuery) => Promise<KnowledgeRetrievalResult>
      previewKnowledgeTaskContext: (departmentId: string, payload: PreviewKnowledgeTaskContextInput) => Promise<PreviewKnowledgeTaskContextResult>
      importKnowledgeDocuments: (departmentId?: string) => Promise<KnowledgeImportResult>
      importKnowledgeDocumentFromPath: (departmentId: string, filePath: string) => Promise<KnowledgeImportResult>
      ensureReadingSeedDocuments: (departmentId: string) => Promise<KnowledgeImportResult>
      materializeKnowledgeWorkspace: (departmentId: string, payload: MaterializeKnowledgeWorkspaceInput) => Promise<MaterializeKnowledgeWorkspaceResult>
      deleteKnowledgeDocument: (departmentId: string, documentId: string) => Promise<{ success: boolean }>
      setKnowledgeCurrentVersion: (departmentId: string, documentId: string, versionId: string) => Promise<{ document: KnowledgeDocumentMeta; version: KnowledgeDocumentVersionDetail['meta'] }>
      submitKnowledgeRemakeTask: (departmentId: string, payload: KnowledgeRemakeTaskParams) => Promise<string>
      saveKnowledgeTaskRecord: (departmentId: string, payload: SaveKnowledgeTaskInput) => Promise<{ task: KnowledgeTaskRecord }>
      createKnowledgeRemakeVersion: (departmentId: string, payload: CreateKnowledgeRemakeVersionInput) => Promise<{ document: KnowledgeDocumentMeta; version: KnowledgeDocumentVersionDetail['meta']; task: KnowledgeTaskRecord }>
      classifyKnowledgeDocument: (departmentId: string, documentId: string) => Promise<{ category: string; confidence: number } | null>
      updateKnowledgeDocumentCategory: (departmentId: string, documentId: string, category: string) => Promise<void>
      listDepartments: () => Promise<Department[]>
      createDepartment: (name: string, nameEn: string) => Promise<Department>
      renameDepartment: (id: string, name: string, nameEn: string) => Promise<Department>
      deleteDepartment: (id: string) => Promise<void>
      getDefaultDepartmentId: () => Promise<string>
      readOoxmlPackage: (filePath: string) => Promise<OoxmlPackageSnapshot>
      writeOoxmlPackage: (filePath: string, payload: OoxmlWritePayload) => Promise<OoxmlWriteResult>
      listWorkspaces: () => Promise<Array<{ name: string; path: string; hasDocument: boolean; modifiedAt: string }>>
      createWorkspace: (name: string, parentDir?: string) => Promise<{ success: boolean; path: string; name: string }>
      renameWorkspace: (wsPath: string, nextName: string) => Promise<{ success: boolean; path: string; name: string }>
      registerWorkspace: (wsPath: string) => Promise<{ success: boolean; path: string; name: string }>
      getWorkspaceTree: (wsPath: string) => Promise<Array<{ name: string; path: string; relativePath: string; type: 'file' | 'folder'; size?: number; children?: any[] }>>
      readWorkspaceDocumentSchema: (wsPath: string) => Promise<{ success: boolean; source: 'document-json' | 'legacy-workspace' | 'empty'; jsonPath: string; legacySourcePath: string | null; document: DocumentSchema; compatHtml: string; displayName: string }>
      saveWorkspaceDocumentSchema: (wsPath: string, document: DocumentSchema) => Promise<{ success: boolean; jsonPath: string; document: DocumentSchema; compatHtml: string; displayName: string; resourceCount: number }>
      saveGeneratedPaperJsonArtifact: (input: { workspacePath: string; documentSchema: DocumentSchema; title?: string }) => Promise<{ success: boolean; jsonPath: string; relativePath: string; document: DocumentSchema }>
      deleteWorkspace: (wsPath: string) => Promise<{ success: boolean }>
      detectProjectStructure: (wsPath: string) => Promise<{ isProject: boolean; hasFigures?: boolean }>
      createWorkspaceFolder: (wsPath: string, relativePath: string) => Promise<{ success: boolean; path: string }>
      createWorkspaceFile: (wsPath: string, relativePath: string) => Promise<{ success: boolean; path: string }>
      createBlankDocument: (wsPath: string, relativePath: string) => Promise<{ success: boolean; path: string }>
      renameWorkspacePath: (wsPath: string, oldRelativePath: string, newRelativePath: string) => Promise<{ success: boolean; path: string }>
      copyWorkspacePath: (wsPath: string, sourceRelativePath: string, targetRelativePath: string) => Promise<{ success: boolean; path: string }>
      moveWorkspacePath: (wsPath: string, sourceRelativePath: string, targetRelativePath: string) => Promise<{ success: boolean; path: string }>
      deleteWorkspacePath: (wsPath: string, relativePath: string) => Promise<{ success: boolean }>
      readReferences: (wsPath: string, documentPath?: string) => Promise<{ references: unknown[] }>
      readTaskHistory: (wsPath: string) => Promise<{ tasks: unknown[] }>
      appendTaskHistory: (wsPath: string, task: Record<string, unknown>) => Promise<{ success: boolean; total: number }>
      saveReferences: (wsPath: string, references: unknown[], documentPath?: string) => Promise<{ success: boolean; total: number }>
      appendReferences: (wsPath: string, references: unknown[], documentPath?: string) => Promise<{ success: boolean; total: number }>
      cropImageFile: (wsPath: string, srcUrl: string, x: number, y: number, width: number, height: number, filename: string) => Promise<{ success: boolean; path: string; relativePath: string; filename: string; dataUrl: string }>
      saveImageToWorkspace: (wsPath: string, filename: string, base64Data: string) => Promise<{ success: boolean; path: string; relativePath: string; filename: string }>
      saveImageToFiguresBase64: (wsPath: string, filename: string, base64Data: string) => Promise<{ success: boolean; path: string; relativePath: string; filename: string }>
      saveImageFromUrl: (wsPath: string, imageUrl: string, filename?: string) => Promise<{ success: boolean; path: string; relativePath: string; filename: string }>
      saveImageToFigures: (wsPath: string, imageUrl: string, filename?: string) => Promise<{ success: boolean; path: string; relativePath: string; filename: string }>
      writeWorkspaceFile: (wsPath: string, relativePath: string, content: string) => Promise<{ success: boolean; path: string }>
      saveManuscript: (wsPath: string, content: string, filename: string, options?: { templateDocumentId?: string }) => Promise<{ success: boolean; path: string }>
      saveExperimentPlan: (wsPath: string, content: string, filename: string) => Promise<{ success: boolean; path: string }>
      importFilesToWorkspace: (wsPath: string, targetRelDir?: string) => Promise<{ imported: string[] }>
      openFileDialog: () => Promise<string | null>
      openDirectoryDialog: () => Promise<string | null>
      saveFileDialog: (defaultName: string) => Promise<string | null>
      readFile: (filePath: string) => Promise<{
        type: string
        content: string
        filePath: string
        sourceFormat?: 'docx'
        sidecarUsed?: boolean
        preserveOriginalOnSave?: boolean
      }>
      listDirectoryImages: (dirPath: string) => Promise<Array<{ name: string; filePath: string }>>
      importImageFile: () => Promise<{
        filePath: string
        fileName: string
        contentType: string
        dataUrl: string
      } | null>
      getFileInfo: (filePath: string) => Promise<{
        exists: boolean
        fileSize: number
        path: string
      }>
      readImageAsDataUrl: (filePath: string) => Promise<{
        filePath: string
        fileName: string
        contentType: string
        dataUrl: string
      }>
      openExternalFile: (filePath: string) => Promise<{ success: boolean; error?: string | null; filePath: string }>
      openFolderSafe: (targetPath: string, options?: { createIfMissing?: boolean }) => Promise<{ ok: boolean; path?: string; error?: string; notFound?: boolean }>
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
      copyFileToPath: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; path: string }>

      // ---- Internal Account IPC ----
      internalAccountGetToken: () => Promise<{ token: string | null }>
      internalAccountSetToken: (token: string) => Promise<{ ok: boolean }>
      internalAccountClearToken: () => Promise<{ ok: boolean }>
      internalAccountGetSession: () => Promise<{ session: unknown | null }>
      internalAccountSetSession: (session: unknown) => Promise<{ ok: boolean; error?: string }>
      internalAccountClearSession: () => Promise<{ ok: boolean }>
      internalAccountApplyEmailConfig: (config: import('./email').EmailAccountConfig) => Promise<{ ok: boolean; error?: string }>
      internalAccountLoginMailbox: (payload: { usernameOrEmail: string; password: string }) => Promise<{
        ok: boolean
        session?: unknown
        mailboxEmail?: string
        error?: string
        probeResults?: Array<{ protocol: 'imap' | 'smtp'; mode: 'starttls' | 'none' | 'ssl'; ok: boolean; message: string }>
      }>

      // ---- Matrix IPC ----
      matrixGetSession: () => Promise<{ session: import('./matrix').MatrixSession | null }>
      matrixSetSession: (session: import('./matrix').MatrixSession) => Promise<{ ok: boolean; error?: string }>
      matrixClearSession: () => Promise<{ ok: boolean }>

      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; filePath: string }>
      writeDocxFile: (filePath: string, markdown: string) => Promise<{ success: boolean; filePath: string }>
      continueWriting: (payload: Record<string, unknown>) => Promise<string>
      rewriteParagraph: (payload: Record<string, unknown>) => Promise<string>
      writingAssistant: (payload: Record<string, unknown>) => Promise<string>
      aiCancelTask: (taskId: string) => Promise<void>
      organizeReferences: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      generateOutline: (payload: Record<string, unknown>) => Promise<string>
      analyzeTopic: (payload: Record<string, unknown>) => Promise<string>
      generateExperimentPlan: (payload: Record<string, unknown>) => Promise<string>
      generateImage: (payload: ElectronGenerateImagePayload) => Promise<{
        localPath?: string
        path?: string
        error?: string
        sourceUrl?: string
        model?: string
      }>
      generatePaper: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      compatSubmitTask: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      compatGetTaskStatus: (taskId: string) => Promise<Record<string, unknown>>
      compatGetTaskResult: (taskId: string) => Promise<Record<string, unknown>>
      compatGetActiveTasks: () => Promise<Record<string, unknown>>
      compatGetRecentTasks: (limit?: number) => Promise<Record<string, unknown>>
      compatPauseTask: (taskId: string) => Promise<Record<string, unknown>>
      compatResumeTask: (taskId: string) => Promise<Record<string, unknown>>
      compatStopTask: (taskId: string) => Promise<Record<string, unknown>>
      compatFindCitationForText: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      getBackendStatus?: () => Promise<{ url?: string } | null>
      onBackendStatus?: (callback: (message: string) => void) => void
      exportPdf: (payload: { markdown: string; title: string }) => Promise<string | null>
      exportPdfFromEditor: (payload: {
        html: string
        styles: {
          templateId: string
          fontFamily: string
          fontSize: string
          fontSizePx: number
          lineHeight: string
          textIndent: string
          paragraphSpacing: string
          headingAlign: string
          pagePadding: string
        }
        title: string
      }) => Promise<string | null>
      generatePptx: (payload: { plan: Record<string, unknown>; outputPath: string; templateId?: string }) => Promise<{ success: boolean; outputPath: string; slideCount: number; templateId?: string; error?: string }>

      // ---- PPT Content Package IPC (no LLM, no image API) ----
      pptxSaveContentPackage: (payload: {
        workspacePath: string
        pkg: {
          id?: string
          title: string
          sourcePrompt: string
          slides: Record<string, unknown>[]
          assets: Array<{ slideIndex: number; imagePath: string }>
          outlinePlan?: unknown[]
          expectedSlideCount?: number
          completedSlideCount?: number
          status?: 'partial' | 'completed' | string
          stoppedAt?: string
          createdAt?: string
        }
      }) => Promise<{ success: boolean; packageId?: string; filePath?: string; error?: string }>
      pptxLoadContentPackage: (payload: { workspacePath: string; packageId: string }) => Promise<{ success: boolean; pkg?: Record<string, unknown>; error?: string }>
      pptxListContentPackages: (payload: { workspacePath: string }) => Promise<{ success: boolean; packages: Array<{ packageId: string; title: string; createdAt: string; filePath: string }>; error?: string }>
      pptxRenderWithSkill: (payload: { workspacePath: string; contentPackageId: string; skillId: string; outputPath?: string }) => Promise<{ success: boolean; contentPackageId?: string; skillId?: string; outputPath?: string; slideCount?: number; renderedAt?: string; error?: string }>
      pptxListSkills: (payload?: { workspacePath?: string }) => Promise<{ success: boolean; skills: Array<{ id: string; name: string; description: string; previewColor: string; category: string; requiresLLM: false; source?: 'built-in' | 'skill'; widthInches?: number; heightInches?: number }> }>
      pptxImportFromDialog: (payload: { workspacePath: string }) => Promise<{
        success: boolean
        canceled?: boolean
        deckDocumentId?: string
        deckPath?: string
        deck?: unknown
        originalPptxPath?: string
        previewSlides: Array<{ index: number; imagePath: string; title?: string }>
        extractionWarnings: string[]
        error?: string
      }>
      pptxImportFromFile: (payload: {
        workspacePath: string
        pptxPath: string
        source: { type: 'email_attachment' | 'local_file'; messageId?: string; attachmentId?: string; filename?: string }
        importMode?: 'rule_based' | 'ai_assisted'
        language?: 'zh' | 'en'
      }) => Promise<{
        success: boolean
        deckDocumentId?: string
        deckPath?: string
        deck?: unknown
        originalPptxPath?: string
        previewSlides: Array<{ index: number; imagePath: string; title?: string }>
        extractionWarnings: string[]
        error?: string
      }>

      // ---- DeckDocument IPC (no LLM, no image API) ----
      deckSave: (payload: { workspacePath: string; deck: unknown }) => Promise<{ success: boolean; deckId?: string; filePath?: string; error?: string }>
      deckLoad: (payload: { workspacePath: string; deckId: string }) => Promise<{ success: boolean; deck?: unknown; error?: string }>
      deckRender: (payload: { workspacePath: string; deckId: string; manifestId: string; outputPath?: string }) => Promise<{ success: boolean; outputPath?: string; slideCount?: number; llmCalls: number; imageCalls: number; tokenCost: number; error?: string }>
      deckUpdateSlide: (payload: { workspacePath: string; deckId: string; slideIndex: number; updates: unknown }) => Promise<{ success: boolean; deckId?: string; filePath?: string; deck?: unknown; error?: string }>
      deckUpdateDeckDocument: (payload: { workspacePath: string; deckId: string; updates: unknown }) => Promise<{ success: boolean; deckId?: string; filePath?: string; deck?: unknown; error?: string }>
      deckOptimizeStructure: (payload: { workspacePath: string; deckId: string }) => Promise<{ success: boolean; deckId: string; deckPath?: string; deck?: unknown; error?: string }>

      // ---- DeckDocument Builder IPC (LLM-based content generation) ----
      deckBuildFromPrompt: (payload: unknown) => Promise<{ success: boolean; deckDocumentId?: string; deckPath?: string; deck?: unknown; warnings: string[]; tokenUsage?: { promptTokens: number; completionTokens: number; total: number }; error?: string }>
      deckBuildFromManuscript: (payload: unknown) => Promise<{ success: boolean; deckDocumentId?: string; deckPath?: string; deck?: unknown; warnings: string[]; tokenUsage?: { promptTokens: number; completionTokens: number; total: number }; error?: string }>
      deckBuildFromImportedPptx: (payload: unknown) => Promise<{ success: boolean; deckDocumentId?: string; deckPath?: string; deck?: unknown; warnings: string[]; error?: string }>
      deckExtractPptx: (payload: { pptxPath: string }) => Promise<{ success: boolean; slides?: unknown[]; error?: string }>
      deckPreview: (payload: { pptxPath: string; previewDir: string }) => Promise<{
        success: boolean
        previewDir?: string
        slides?: Array<{ index: number; imagePath: string; title?: string }>
        warning?: string
        error?: string
      }>

      onAiEvent: (callback: (payload: unknown) => void) => () => void

      // ---- Voice proxy IPC ----
      voiceStart?: () => Promise<{ sessionId: string }>
      voiceSend?: (sessionId: string, buffer: ArrayBuffer) => void
      voiceStop?: (sessionId: string) => Promise<void>
      onVoiceEvent?: (callback: (payload: { sessionId: string; type: string; text?: string; message?: string }) => void) => () => void

      // ---- 正式模板模式 IPC（formal template mode） ----
      analyzeFormalTemplate: (payload: import('./templateGeneration').AnalyzeFormalTemplateRequest) => Promise<import('./templateGeneration').AnalyzeFormalTemplateResponse>
      confirmFormalTemplateFields: (payload: import('./templateGeneration').ConfirmFormalTemplateFieldsRequest) => Promise<import('./templateGeneration').ConfirmFormalTemplateFieldsResponse>
      previewFormalTemplateTask: (payload: import('./templateGeneration').PreviewFormalTemplateTaskRequest) => Promise<import('./templateGeneration').PreviewFormalTemplateTaskResponse>
      commitFormalTemplateTask: (payload: import('./templateGeneration').CommitFormalTemplateTaskRequest) => Promise<import('./templateGeneration').CommitFormalTemplateTaskResponse>

      // ---- Email IPC ----
      emailGetAccount: () => Promise<import('./email').EmailAccountConfig | null>
      emailSaveAccount: (config: import('./email').EmailAccountConfig) => Promise<void>
      emailClearAccount: () => Promise<void>
      emailTestConnection: (config: import('./email').EmailAccountConfig) => Promise<import('./email').EmailConnectionCheckResult>
      emailTestSmtp: (config: import('./email').EmailAccountConfig) => Promise<import('./email').EmailConnectionCheckResult>
      emailFetchInbox: () => Promise<import('./email').MailItem[] | EmailFetchResult>
      emailFetchSent: () => Promise<import('./email').MailItem[] | EmailFetchResult>
      emailFetchTrash: () => Promise<import('./email').MailItem[] | EmailFetchResult>
      emailDeleteMessage: (options: { mailId: string; folder: 'inbox' | 'sent' }) => Promise<{ ok: true } | { ok: false; error: { code?: string; message: string } }>
      emailRestoreMessage: (options: { mailId: string; folder: 'trash' | 'spam' }) => Promise<{ ok: true } | { ok: false; error: { code?: string; message: string } }>
      emailSend: (options: { from: string; fromName: string; to: string; subject: string; body: string; cc?: string; bcc?: string; attachments?: { filename: string; path: string }[]; inReplyTo?: string; references?: string }) => Promise<void | EmailSendResult>
      emailDownloadAttachment: (options: { tempPath: string; filename: string }) => Promise<EmailDownloadResult>
      mailOpenAttachmentInWorkspace: (options: MailAttachmentOpenRequest) => Promise<MailAttachmentOpenResult>
      emailSelectAttachments: () => Promise<{ ok: boolean; files?: Array<{ fileName: string; filePath: string; mimeType: string; sizeBytes: number }>; error?: string }>
      // ---- School Exchange IPC ----
      emailTestSchoolAccount: (params: { email: string; password: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }) => Promise<{
        ok: boolean
        imapEncryption?: 'starttls' | 'none' | 'ssl'
        smtpEncryption?: 'starttls' | 'none' | 'ssl'
        probeResults: Array<{ protocol: 'imap' | 'smtp'; mode: 'starttls' | 'none' | 'ssl'; ok: boolean; message: string }>
      }>
      emailSaveSchoolAccount: (config: import('./email').EmailAccountConfig & { password: string }) => Promise<{ ok: boolean; error?: { message: string } }>
      emailRemoveSchoolAccount: () => Promise<{ ok: boolean; error?: { message: string } }>
      // ---- Custom Preset IPC ----
      emailLoadCustomPresets: () => Promise<import('./email').CustomEmailPreset[]>
      emailSaveCustomPreset: (preset: import('./email').EmailAccountPreset) => Promise<{ ok: boolean; error?: { message: string } }>
      emailRemoveCustomPreset: (label: string) => Promise<{ ok: boolean; error?: { message: string } }>
      emailAutoProbeEmailDomain: (domain: string) => Promise<import('./email').EmailDomainProbeResult>

      // ---- Workspace Activity / Daily Report IPC ----
      activityTakeSnapshot: (workspacePath: string) => Promise<import('./workspaceActivity').ActivityTakeSnapshotResult>
      activityGetActivity: (payload: import('./workspaceActivity').ActivityGetActivityInput) => Promise<import('./workspaceActivity').ActivityGetActivityResult>
      activityAnalyzeFiles: (payload: import('./workspaceActivity').ActivityAnalyzeFilesInput) => Promise<import('./workspaceActivity').ActivityAnalyzeFilesResult>
      activityGenerateReport: (payload: import('./workspaceActivity').ActivityGenerateReportInput) => Promise<import('./workspaceActivity').ActivityGenerateReportResult>
      activityGetReport: (payload: import('./workspaceActivity').ActivityGetReportInput) => Promise<import('./workspaceActivity').ActivityGetReportResult>
      activitySyncStatus: () => Promise<{ ok: boolean; status?: { lastSyncAt: number | null; lastSyncError: string | null; pendingCount: number } }>
      activityFlushSync: () => Promise<{ ok: boolean; error?: string }>
      activityAdminFetch: (endpoint: string) => Promise<{ ok: boolean; data?: unknown; httpStatus?: number; error?: string }>
      activityAdminPost: (endpoint: string, body: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; httpStatus?: number; error?: string }>
      activityLogUserAction: (payload: {
        userId: string; module: string; action: string
        title?: string; summary?: string; workspaceId?: string
        metadata?: Record<string, unknown>; createdAt?: string
        eventType?: string; sessionId?: string
        startedAt?: string; endedAt?: string; durationMs?: number
        status?: 'success' | 'failed' | 'cancelled'
        targetType?: string; targetId?: string; targetTitle?: string
        details?: Record<string, unknown>
        errorCode?: string; errorMessage?: string
        localId?: string
      }) => Promise<{ ok: boolean; error?: string }>
      activityGetUserActions: (payload: { userId: string; date: string }) => Promise<{
        ok: boolean; actions: unknown[]; error?: string
      }>
      activitySetIdentity?: (payload: { userId: string; username?: string }) => Promise<{ ok: boolean; error?: string }>
      // ---- AI Delegation / 下班托管 IPC ----
      delegationEnable: (payload: { userId: string; workspacePath: string; policyId?: string }) => Promise<import('./delegation').DelegationEnableResult>
      delegationDisable: (payload: { userId: string }) => Promise<import('./delegation').DelegationDisableResult>
      delegationGetStatus: () => Promise<import('./delegation').DelegationGetStatusResult>
      delegationGetAuditLog: () => Promise<import('./delegation').DelegationGetAuditLogResult>
      delegationGetPendingReplies: () => Promise<{ ok: true; replies: import('./delegation').PendingAutoReply[] }>
      delegationReviewReply: (payload: { replyId: string; action: 'approve' | 'reject'; reviewerUserId: string }) => Promise<import('./delegation').DelegationReviewReplyResult>
      delegationUploadWorkReport: (payload: import('./delegation').WorkReportUploadPayload) => Promise<import('./delegation').WorkReportUploadResult>
      delegationGenerateAutoReply: (payload: import('./delegation').AutoReplyGenerateInput) => Promise<import('./delegation').AutoReplyGenerateResult>

      // ---- Skill Store ----
      openSkillStore?: () => Promise<{ ok: boolean; error?: string }>
      getSkillSyncPlan?: (payload?: {
        userId?: string
        deviceId?: string
      }) => Promise<{
        ok: boolean
        error?: string
        entitlements?: unknown[]
        plan?: {
          to_install?: unknown[]
          to_update?: unknown[]
          to_disable?: unknown[]
          already_latest?: unknown[]
        }
      }>
      listMySkins?: (payload?: { userId?: string }) => Promise<{
        ok: boolean
        error?: string
        skins?: Array<{
          skill_id: string
          name: string
          description?: string
          version: string
          package_id: string | null
          package_hash: string | null
          package_file: string | null
          size: number
          download_available: boolean
          download_path?: string | null
        }>
      }>
      downloadSkillPackage?: (payload: {
        skillId: string
        packageHash?: string
        downloadPath?: string | null
      }) => Promise<
        | { ok: true; path: string; filename: string; sha256: string; size: number }
        | { ok: false; error: string }
      >
      getSkillStoreEmbedUrl?: () => Promise<{ ok: boolean; url?: string; error?: string }>
      recognizeSkillPackage?: (payload: {
        skillId: string
        localPath: string
      }) => Promise<{ ok: boolean; skill_type?: string; name?: string; templateId?: string; error?: string }>
      listSkillTemplates?: () => Promise<{ ok: boolean; templates: Array<{ id: string; name: string }> }>
      // Excel Analysis
      excelAnalysisRun: (payload: unknown) => Promise<unknown>
      excelListDataModels: () => Promise<Array<{ id: string; label: string; description: string }>>
      excelCheckEnvStatus: () => Promise<{ status: string; message: string }>
      excelRebuildEnv: () => Promise<{ ok: boolean; message: string }>
      excelPythonDiagnostics: () => Promise<Record<string, unknown>>
      onExcelAnalysisProgress: (callback: (payload: unknown) => void) => () => void
      onExcelAnalysisEnvLog: (callback: (payload: { message: string; ts: string }) => void) => () => void
      onExcelAnalysisEnvStatus: (callback: (payload: { status: string; message?: string }) => void) => () => void
    }
    personalLibraryAPI: {
      listFolders: () => Promise<import('./personalLibrary').PersonalFolder[]>
      createFolder: (name: string) => Promise<import('./personalLibrary').PersonalFolder>
      renameFolder: (id: string, name: string) => Promise<import('./personalLibrary').PersonalFolder>
      deleteFolder: (id: string) => Promise<void>
      listFiles: (folderId?: string | null) => Promise<import('./personalLibrary').PersonalFile[]>
      getFile: (fileId: string) => Promise<import('./personalLibrary').PersonalFile | null>
      getFileContent: (fileId: string) => Promise<{ text: string; truncated: boolean; sourceType: import('./personalLibrary').PersonalFileSourceType }>
      deleteFile: (fileId: string) => Promise<void>
      moveFile: (fileId: string, targetFolderId: string | null) => Promise<import('./personalLibrary').PersonalFile>
      importFiles: (folderId?: string | null) => Promise<import('./personalLibrary').PersonalImportResult>
    }
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      allowpopups?: string | boolean
      nodeintegration?: string | boolean
      webpreferences?: string
      partition?: string
      useragent?: string
      disablewebsecurity?: string | boolean
      ref?: React.Ref<HTMLElement>
    }
  }
}

export {}
