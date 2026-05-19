/**
 * 高级图片生成模块（移植自 NFTCORE/textfigure 图片生成功能）
 * 
 * 增强功能：
 * 1. 每个 section 最多生成 1 张图片
 * 2. 用 LLM 生成详细的图片 caption（overall + detail description）
 * 3. 支持组合图（4 张子图）- 需要 sharp 库
 * 4. 图片 caption 不含引用（后续统一插入）
 */

import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'
import { generateImage } from './imageClient'

const MOJIBAKE_PROMPT_PATTERN = /(璇风敓|鎴|涓婚|銆|鈥)/

function assertPaperImagePromptEncoding(prompt: string): void {
  if (MOJIBAKE_PROMPT_PATTERN.test(String(prompt || ''))) {
    throw new Error('图片 prompt 编码异常')
  }
}

/**
 * 图片信息
 */
export interface FigureInfo {
  /** 章节编号（1-based） */
  sectionNum: number
  /** 章节标题 */
  sectionTitle: string
  /** 图片编号（section内的序号，1-based） */
  figureIndex: number
  /** 图片本地路径 */
  localPath: string
  /** 图片 URL（用于 markdown） */
  url: string
  /** 图片 caption（不含引用） */
  caption: string
  /** 图片 markdown 代码 */
  markdown: string
}

/**
 * Caption 生成结果
 */
interface CaptionData {
  /** 整体描述（简短） */
  overallDescription: string
  /** 详细描述 */
  detailDescription: string
  /** 子图描述（组合图模式） */
  subfigureDescriptions?: string[]
}

type FigurePromptProfile = {
  prompt: string
  fallbackOverallZh: string
  fallbackDetailZh: string
  fallbackOverallEn: string
  fallbackDetailEn: string
}

function resolveFigurePromptProfile(
  topic: string,
  sectionTitle: string,
  sectionText: string,
  language: 'zh' | 'en',
): FigurePromptProfile {
  const normalizedTitle = String(sectionTitle || '').trim().toLowerCase()
  const sectionExcerpt = sectionText.slice(0, 1400)
  const languageCue = language === 'zh' ? 'All visual semantics should align with Chinese academic writing context.' : 'All visual semantics should align with English academic writing context.'

  if (normalizedTitle.includes('引言') || normalizedTitle.includes('introduction')) {
    return {
      prompt: `Create a polished academic overview illustration for the Introduction section of a research paper about ${topic}. Show the research landscape, key entities, and the overall problem-to-solution roadmap in one cohesive schematic composition. Use layered scientific shapes, modular relationships, and a strong sense of logical flow. White background, high clarity, no text, no letters, no numbers, no labels, no watermark. Avoid device close-ups and avoid generic stock-style scenes. Section context: ${sectionExcerpt}. ${languageCue}`,
      fallbackOverallZh: '研究背景与问题框架示意',
      fallbackDetailZh: '该图概括展示研究对象、关键因素及整体研究路径之间的关系，用于建立全文的问题背景与分析框架。',
      fallbackOverallEn: 'Research background and problem framework',
      fallbackDetailEn: 'The figure summarizes the research object, key factors, and the overall analytical pathway that frames the problem addressed in the paper.',
    }
  }

  if (normalizedTitle.includes('实验设备') || normalizedTitle.includes('equipment')) {
    return {
      prompt: `Create a precise experimental setup illustration for a research paper about ${topic}. Focus on apparatus layout, instrument configuration, sample placement, signal flow, and environmental control as a clean scientific schematic. The figure should feel technically grounded and reproducible, with clear spatial organization of equipment modules and experimental pathways. White background, no text, no numbers, no labels, no watermark. Avoid conceptual infographic style and avoid theoretical abstract shapes. Section context: ${sectionExcerpt}. ${languageCue}`,
      fallbackOverallZh: '实验设备与装置布局示意',
      fallbackDetailZh: '该图展示实验装置、关键仪器连接关系及样品测试流程，突出实验条件与系统配置的可复现结构。',
      fallbackOverallEn: 'Experimental apparatus and setup layout',
      fallbackDetailEn: 'The figure depicts the apparatus layout, key instrument connections, and sample-testing workflow, emphasizing a reproducible experimental configuration.',
    }
  }

  if (normalizedTitle.includes('实验结果分析') || normalizedTitle.includes('results analysis')) {
    return {
      prompt: `Create a data-driven scientific results visualization for a research paper about ${topic}. Show experimental curves, distributions, comparative trends, or measurement-response patterns as a high-quality chart-like academic figure. Emphasize contrast between conditions or samples, smooth analytical traces, and visually salient result patterns. White background, no text, no numbers, no axis labels, no watermark. Avoid equipment diagrams and avoid abstract theoretical-only imagery. Section context: ${sectionExcerpt}. ${languageCue}`,
      fallbackOverallZh: '实验结果与趋势对比图',
      fallbackDetailZh: '该图集中呈现实验数据的主要变化趋势、组间差异和关键响应特征，用于支撑结果分析与比较讨论。',
      fallbackOverallEn: 'Experimental results and trend comparison',
      fallbackDetailEn: 'The figure highlights major data trends, inter-condition differences, and salient response patterns that support the empirical analysis and comparison.',
    }
  }

  if (normalizedTitle.includes('理论分析') || normalizedTitle.includes('theoretical')) {
    return {
      prompt: `Create a theoretical mechanism illustration for a research paper about ${topic}. Show a clean scientific model that explains causal pathways, underlying mechanisms, energy or state transitions, and conceptual interactions behind the observed results. The composition should feel explanatory and mechanistic rather than experimental or statistical. White background, no text, no numbers, no labels, no watermark. Avoid generic device diagrams and avoid raw data charts. Section context: ${sectionExcerpt}. ${languageCue}`,
      fallbackOverallZh: '理论机制与作用路径示意',
      fallbackDetailZh: '该图以理论模型和机制链条解释实验观察结果，突出关键作用过程、变量耦合关系及理论支撑。',
      fallbackOverallEn: 'Theoretical mechanism and interaction pathway',
      fallbackDetailEn: 'The figure explains the observed results through a theoretical model, emphasizing key mechanisms, coupled variables, and the underlying interpretation pathway.',
    }
  }

  return {
    prompt: `Academic scientific illustration for section "${sectionTitle}" about ${topic}. Create one clean, professional, data-driven visualization for this section. White background, no text, no numbers, no labels, no watermark. Section context: ${sectionExcerpt}. ${languageCue}`,
    fallbackOverallZh: '相关研究结果',
    fallbackDetailZh: '该图展示了本节讨论的关键发现和数据分析结果。',
    fallbackOverallEn: 'Research results visualization',
    fallbackDetailEn: 'This figure presents the key findings and data analysis results discussed in this section.',
  }
}

/**
 * 为 section 生成图片 caption
 * 
 * 移植自 NFTCORE content_generator.py 的 generate_figure_caption()
 * 
 * @param settings - 应用设置
 * @param sectionText - 章节文本
 * @param sectionNum - 章节编号
 * @param language - 语言
 * @returns Caption 数据
 */
async function generateFigureCaption(
  settings: AppSettings,
  sectionText: string,
  sectionNum: number,
  sectionTitle: string,
  language: 'zh' | 'en',
): Promise<CaptionData> {
  const languageInstruction = language === 'zh' ? '使用简体中文' : 'Use English'
  const profile = resolveFigurePromptProfile('', sectionTitle, sectionText, language)

  const prompt = `Based on the following section text, generate a figure caption for Figure ${sectionNum}.

Section Title:
${sectionTitle}

Section Text:
${sectionText.slice(0, 1500)}

Requirements:
1. Generate TWO parts:
   - overall_description: A brief, concise description (10-15 words)
   - detail_description: A detailed description explaining what the figure shows (20-40 words)
2. ${languageInstruction}
3. Do NOT include any citation format like [1], [2, 3] in the caption
4. Do NOT start with "Figure ${sectionNum} depicts/shows/illustrates"
5. Return JSON format only

JSON format:
{
  "overall_description": "Brief description here",
  "detail_description": "Detailed description here"
}

Generate the caption:`

  try {
    const response = await completeText(settings, {
      systemPrompt: 'You are an academic figure caption writer. You generate concise and informative captions. Always return valid JSON.',
      userPrompt: prompt,
      temperature: 0.4,
      maxTokens: 500,
    })

    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('未找到 JSON 内容')
    }

    const captionData = JSON.parse(jsonMatch[0]) as CaptionData

    // 清理引号和不需要的前缀
    let overallDesc = String((captionData as any).overall_description || captionData.overallDescription || '').trim().replace(/^["''""]+|["''""]+$/g, '')
    let detailDesc = String((captionData as any).detail_description || captionData.detailDescription || '').trim().replace(/^["''""]+|["''""]+$/g, '')

    // 移除 "Figure X depicts/shows" 等前缀
    detailDesc = detailDesc.replace(/^Figure\s+\d+\s+(depicts|shows|illustrates|presents|demonstrates)\s+/i, '').trim()

    // 移除任何引用格式
    detailDesc = detailDesc.replace(/\[\d+(?:\s*[,\-]\s*\d+)*\]/g, '')
    overallDesc = overallDesc.replace(/\[\d+(?:\s*[,\-]\s*\d+)*\]/g, '')

    return {
      overallDescription: overallDesc,
      detailDescription: detailDesc,
    }
  } catch (error) {
    console.error('Caption 生成失败:', error)
    return {
      overallDescription: language === 'zh' ? profile.fallbackOverallZh : profile.fallbackOverallEn,
      detailDescription: language === 'zh' ? profile.fallbackDetailZh : profile.fallbackDetailEn,
    }
  }
}

/**
 * 为章节生成图片
 * 
 * 移植自 NFTCORE usage_example.py 的图片生成逻辑
 * 
 * @param settings - 应用设置
 * @param outputDir - 输出目录
 * @param params - 生成参数
 * @param onProgress - 进度回调
 * @returns 生成的图片信息列表
 */
export async function generateSectionFigures(
  settings: AppSettings,
  outputDir: string,
  params: {
    topic: string
    sectionNum: number
    sectionTitle: string
    sectionText: string
    plannedFigureCount: number
    language: 'zh' | 'en'
  },
  onProgress?: (message: string) => void,
): Promise<FigureInfo[]> {
  const { topic, sectionNum, sectionTitle, sectionText, plannedFigureCount, language } = params
  const emit = onProgress ?? (() => {})

  const figures: FigureInfo[] = []
  const figureCount = plannedFigureCount > 0 ? 1 : 0

  // 当前 NFTCORE 工作流每章只保留一张图
  for (let figIndex = 1; figIndex <= figureCount; figIndex++) {
    emit(`正在为章节 ${sectionTitle} 生成图片`)

    try {
      const figureProfile = resolveFigurePromptProfile(topic, sectionTitle, sectionText, language)
      assertPaperImagePromptEncoding(figureProfile.prompt)

      // 生成图片
      const imageResult = await generateImage(settings, outputDir, {
        prompt: figureProfile.prompt,
        aspectRatio: settings.defaults.imageAspectRatio,
        flowType: 'paper-generation',
        traceId: `paper-figure-s${sectionNum}-f${figIndex}-${Date.now()}`,
      }, emit)

      // 生成 caption
      emit(`正在生成图片 caption`)
      const captionData = await generateFigureCaption(settings, sectionText, sectionNum, sectionTitle, language)

      // 构建 caption 文本
      let captionText = ''
      if (captionData.overallDescription && captionData.detailDescription) {
        captionText = `Figure ${sectionNum}.${figIndex} ${captionData.overallDescription}. ${captionData.detailDescription}`
      } else if (captionData.overallDescription) {
        captionText = `Figure ${sectionNum}.${figIndex} ${captionData.overallDescription}.`
      } else if (captionData.detailDescription) {
        captionText = `Figure ${sectionNum}.${figIndex}. ${captionData.detailDescription}`
      } else {
        captionText = `Figure ${sectionNum}.${figIndex}.`
      }

      // 构建 URL
      const imageUrl = toFileUrl(imageResult.localPath)

      // 构建 markdown
      const imageMarkdown = `\n\n![Figure ${sectionNum}.${figIndex}](${imageUrl})\n\n**${captionText}**\n\n`

      figures.push({
        sectionNum,
        sectionTitle,
        figureIndex: figIndex,
        localPath: imageResult.localPath,
        url: imageUrl,
        caption: captionText,
        markdown: imageMarkdown,
      })

      console.log(`✓ Section ${sectionNum} 图片完成: ${imageResult.localPath}`)
    } catch (error) {
      console.error(`✗ Section ${sectionNum} 图片生成失败:`, error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      emit(`章节 ${sectionTitle} 图片生成失败，已跳过（${errorMessage}）`)
    }
  }

  return figures
}

/**
 * 将本地路径转换为 file:// URL
 */
function toFileUrl(localPath: string): string {
  const normalized = String(localPath || '').replace(/\\/g, '/')
  const encoded = encodeURI(normalized)
  if (!normalized) return normalized
  if (encoded.startsWith('/')) return `file://${encoded}`
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`
  return `file:///${encoded}`
}

/**
 * 组合多张子图为一张组合图（需要 sharp 库支持）
 * 
 * 注意：此功能需要安装 sharp 库
 * 移植自 NFTCORE 的 combine_images() 函数
 * 
 * @param imagePaths - 子图路径列表（4张）
 * @param outputPath - 输出路径
 * @returns 组合图路径
 */
export async function combineFourSubfigures(imagePaths: string[], outputPath: string): Promise<string> {
  // TODO: 实现图片组合功能（需要 sharp 库）
  // 目前作为预留接口，优先级较低
  throw new Error('combineFourSubfigures: 功能待实现（需要 sharp 库）')
}
