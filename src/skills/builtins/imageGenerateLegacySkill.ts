/**
 * image.generate.legacy
 * 包装现有 ImageService.generateImage 图片生成流程
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import { generateImage } from '../../modules/image/services/ImageService'

interface ImageGenerateInput extends Record<string, unknown> {
  prompt: string
  aspectRatio?: string
  workspacePath?: string
  negativePrompt?: string
  filename?: string
}

export const imageGenerateLegacySkill: AiOfficeSkill<ImageGenerateInput> = {
  manifest: {
    id: 'image.generate.legacy',
    name: '图片生成（Legacy）',
    version: '1.0.0',
    category: 'image',
    runtime: 'internal',
    description: '调用现有 ImageService.generateImage 生成图片',
    supportedInputs: ['text', 'style-reference', 'image-reference'],
    supportedOutputs: ['image'],
    requiredTools: ['imageService'],
  },

  async execute(
    input: ImageGenerateInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { prompt, aspectRatio, negativePrompt, filename } = input
    if (!prompt) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 prompt 字段' },
      }
    }

    context.onStatus?.('正在生成图片...')
    const result = await generateImage({
      prompt,
      aspectRatio,
      negativePrompt,
      filename,
      workspacePath: (input.workspacePath as string | undefined) ?? context.workspacePath,
    })

    if (result.status !== 'success') {
      return {
        status: 'failed',
        error: {
          code: 'IMAGE_GENERATION_ERROR',
          message: result.error ?? '图片生成失败',
          detail: result,
        },
      }
    }

    context.onStatus?.('图片已生成')
    const artPath = result.file_path ?? result.image_url
    context.onArtifact?.({
      type: 'image',
      path: artPath,
      name: result.filename,
      mimeType: 'image/png',
      url: result.image_url,
    })

    return {
      status: 'success',
      output: {
        image_url: result.image_url,
        file_path: result.file_path,
        filename: result.filename,
        alt: result.alt,
      },
      artifacts: artPath
        ? [{ type: 'image', path: artPath, url: result.image_url, mimeType: 'image/png' }]
        : [],
    }
  },
}
