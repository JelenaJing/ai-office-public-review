export { default as ImageWorkspace } from './components/ImageWorkspace'
export { generateImage, generateSelectionImage, getDefaultInsertedGeneratedImageWidthPx } from './services/ImageService'
export { runSharedImageGeneration, resolveActiveImageStyleProfile, orderSelectedKnowledgeDocuments, isExplicitImageGenerationRequest } from './services/sharedImageGeneration'
export { getPrimaryStyleReferenceId, DEFAULT_IMAGE_STYLE_OPTIONS, DEFAULT_IMAGE_GENERATION_MODE } from './services/imageGenerationPrompt'
