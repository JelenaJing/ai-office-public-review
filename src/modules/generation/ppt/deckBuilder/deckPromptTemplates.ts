/**
 * Prompt templates for the DeckDocument builder.
 *
 * Each function returns { systemPrompt, userPrompt } ready for the LLM.
 * Prompts are in Chinese (matching the primary user language) and explicitly
 * forbid template-related fields in the LLM output.
 */

import type { DeckBuildRequest } from './types'

// ---------------------------------------------------------------------------
// Shared system prompt fragment
// ---------------------------------------------------------------------------

const DECK_JSON_SPEC = `
## DeckDocument JSON 结构说明

你必须输出一个完整的 JSON 对象，具体结构如下：

\`\`\`
{
  "deckId": "<8位十六进制随机ID，如 a3f1c2d4>",
  "schemaVersion": "1.0",
  "title": "演示文稿标题",
  "subtitle": "副标题（可选）",
  "scenario": "business_report | academic_defense | general | product_launch",
  "language": "zh | en",
  "imageMode": "none | cover_only | section | per_slide",
  "sections": ["章节一", "章节二"],
  "status": "completed",
  "expectedSlideCount": <N>,
  "completedSlideCount": <N>,
  "createdAt": "<ISO 8601 时间>",
  "updatedAt": "<ISO 8601 时间>",
  "source": { "type": "<见各 builder 要求>" },
  "assets": [],
  "slides": [
    {
      "index": 0,
      "id": "slide-0",
      "intent": "<见下方说明>",
      "sectionId": "<可选：所属章节名>",
      "title": "<幻灯片完整标题，必填>",
      "shortTitle": "<≤8字极简标题，供封面大字号区域使用，必须比 title 更精炼，如'AI助手'而非'AI智能助手产品发布'>",
      "displayTitle": "<≤14字PPT显示标题，适合40pt+大字号区域，可用简称/关键词，如'医疗影像诊断'而非'基于深度学习的医疗影像辅助诊断算法研究'>",
      "subtitle": "<副标题，仅用于 cover/section_divider>",
      "oneLiner": "<一句话核心表达，适合中国风/封面/章节页，30字以内>",
      "summary": "<2-4句摘要，概括本页核心信息，适合所有模板>",
      "body": "<完整正文，适合学术/正文模板，可多段落用换行符分隔>",
      "items": ["要点1", "要点2", "要点3"],
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "keyTakeaways": ["核心结论1", "核心结论2"],
      "speakerNotes": "<演讲者备注，适合演讲者视图和学术汇报>",
      "visualBrief": "<每页必填：描述最适合此页的视觉意象或图片主题，如春天嫩芽/深蓝海洋/会议室，不超过50字>",
      "contentDensity": "low | medium | high",
      "visualDemand": "none | optional | required"
    }
  ]
}
\`\`\`

## intent 类型说明

| intent | 用途 | 核心内容字段 |
|--------|------|-------------|
| cover | 封面/标题页，每份 PPT 必须有且只有一页 | title, shortTitle, displayTitle, subtitle, oneLiner, visualBrief |
| toc | 目录页，列出所有章节 | title, items（章节列表）, summary |
| section_divider | 章节分隔页，每章开始时使用 | title, oneLiner, summary, keywords |
| text_content | 正文页，文字为主 | title, summary, body, keyTakeaways, speakerNotes |
| content_cards | 卡片式内容 | title, summary, items（必须 3-6 个）, keywords |
| image_text | 图文页，需要配图 | title, summary, body, visualBrief |
| closing | 结尾/致谢页 | title, oneLiner, keyTakeaways, speakerNotes |

## 富内容原则（必须遵守）

每个 slide 必须尽量填充多个内容层，以支持不同模板的渲染需求：

1. **每个 slide 必须有 title**（不得为空）。
2. **每个 slide 必须有 shortTitle**（≤8字，精炼标题，cover 页封面大字号主要使用此字段）。
3. **每个 slide 必须有 displayTitle**（≤14字，PPT 显示标题，适合大字号版面，不能比 title 更长）。
4. **每个 slide 必须有 summary**（2-4 句，概括本页核心信息）。
5. **每个 slide 必须有 visualBrief**（描述最适合此页的视觉意象，如封面背景/配图主题/场景氛围，不超过50字，所有页必填）。
6. **每个 slide 必须有 speakerNotes**（演讲者备注，2-5 句，说明如何讲解此页）。
7. **content_cards 必须有 items（3-6 个）**，且每个 item 不超过 20 字。
8. **text_content 必须有 body**（至少 3 句话）和 summary。
9. **section_divider 必须有 oneLiner 和 keywords（3-5 个）**。
10. **closing 必须有 oneLiner 和 keyTakeaways（2-4 个）**。
11. **学术/正文类**每页必须有 body（完整段落，3-5 句）和 keyTakeaways（2-3 个）。
12. **商务类**每页应有 items（要点）和 keywords（关键词），content_cards 和 text_content 都应有 items。
13. **中国风/散文类**每页必须有 oneLiner（一句诗意核心表达，20字以内）和 keywords（3-5 个意象词）。

## 严格禁止字段

以下字段绝对不允许出现在 DeckDocument 或任何 slide 中：
templateId, theme, color, font, background, backgroundImage, layout,
x, y, w, h, master, animation, style, pptxConfig, slideNumber, transition
`

// ---------------------------------------------------------------------------
// Scenario-specific generation hints
// ---------------------------------------------------------------------------

function buildScenarioHints(prompt: string): string {
  const p = prompt.toLowerCase()
  const isBusiness = /商务|商业|汇报|产品|运营|销售|市场|融资|战略|管理/.test(p)
  const isAcademic = /学术|论文|答辩|研究|算法|实验|数据|分析|方法|优化|深度学习|神经网络/.test(p)
  const isAesthetic = /中国风|散文|诗|节气|自然|感悟|季节|意境|生命|禅/.test(p)

  if (isAcademic) {
    return `
## 学术模板生成提示
本次需求偏学术/研究风格，以下字段在每一页都是必填项：
- body：**每页必填**，详细论述，至少3-5句话，包含论点、论据、结论（cover/toc 页可只写2句）。
- visualBrief：**每页必填**，描述最适合本页的视觉意象，如实验室/图表/数据曲线/研究流程图。
- keyTakeaways：每页2-3个核心结论，简洁、有逻辑层次。
- speakerNotes：演讲者备注，说明本页讲什么、重点强调什么。
- items：如有要点，转为简洁 bullet（不超过8字/条）。
- summary：1-2句概括本页核心贡献或研究发现。`
  }

  if (isBusiness) {
    return `
## 商务模板生成提示
本次需求偏商务/汇报风格，以下字段在每一页都是必填项：
- visualBrief：**每页必填**，描述最适合本页的视觉意象，如会议室/产品截图/数据图表/城市商务图。
- items：要点列表（每页3-6个），每条不超过20字，聚焦价值/数据/行动。
- keywords：关键词（3-5个），提炼本页最核心的业务概念。
- summary：1-2句商务摘要，直接点明价值主张或结论。
- metrics：如有数据，转为 metrics 数组（value + label + detail）。
- keyTakeaways：每页2-3个商业结论或行动建议。`
  }

  if (isAesthetic) {
    return `
## 中国风/散文模板生成提示
本次需求偏中国风/散文/意境风格，以下字段在每一页都是必填项：
- oneLiner：**每页必填**，一句意境深远的核心表达，不超过20字，可用诗意/古典语言（cover/toc/closing 也要填）。
- visualBrief：**每页必填**，描述最适合此页的视觉意象（自然/传统/水墨/四季/花鸟等），如春日晨光/水墨荷花/远山梅雪。
- keywords：**每页必填**，3-5个词语，意象词/概念词，适合点缀在页面留白处。
- summary：2-3句短摘要，语言优美凝练，留有想象空间。
- body：如有正文，保持文学性，不要过于条目化。`
  }

  // Default: neutral/mixed hints
  return `
## 通用生成提示
请为每页至少包含：
- summary：本页核心信息的1-2句摘要。
- 若为正文页（text_content）：必须有 body（完整段落）和 items（要点）。
- 若为卡片页（content_cards）：必须有 items（3-6条）和 keywords。
- 若为章节页（section_divider）：必须有 oneLiner 和 keywords。`
}

// ---------------------------------------------------------------------------
// Prompt builder: from user prompt
// ---------------------------------------------------------------------------

export function buildPromptFromUserPrompt(req: DeckBuildRequest): {
  systemPrompt: string
  userPrompt: string
} {
  const lang = req.language ?? 'zh'
  const imageMode = req.imageMode ?? 'none'
  const audience = req.targetAudience ? `\n目标受众：${req.targetAudience}` : ''
  const purpose = req.purpose ? `\n演示目的：${req.purpose}` : ''
  const scenarioHints = buildScenarioHints(req.prompt ?? '')

  const systemPrompt = `你是一位专业的演示文稿策划师。
你的任务是根据用户的需求描述，规划并输出一份结构化的演示文稿内容包（DeckDocument）。

## 核心原则
1. DeckDocument 是内容真相，绝不包含模板、主题、颜色、字体等视觉配置。
2. 你输出的内容后续可以被任意 PPT 模板渲染（学术/商务/中国风），因此内容必须模板无关但内容丰富。
3. 每一页要填充多个内容层（oneLiner/summary/body/items/keywords/keyTakeaways/speakerNotes），
   让不同风格的模板都能找到适合自己的内容来渲染。
4. 只输出一段合法的 JSON 对象，不含代码块标记（不要写 \`\`\`json），不含任何说明文字。

## 输出要求
- source.type 必须为 "prompt"
- imageMode 固定为 "${imageMode}"
- language 固定为 "${lang}"
- 演示文稿通常 10-20 页
- 必须有 cover 页（第 1 页）
- 建议有 toc 页（第 2 页）
- 每个主章节前有 section_divider 页
- 最后有 closing 页
- content_cards 的 items 必须为 3-6 个，不能为空
${scenarioHints}
${DECK_JSON_SPEC}`

  const userPrompt = `请为以下需求生成一份演示文稿 DeckDocument JSON：

${req.prompt ?? '（用户未提供具体要求，请生成一份通用演示示例）'}${audience}${purpose}

要求：
1. 只输出 JSON，不要任何前缀、后缀或说明。
2. JSON 必须完整合法，可以直接 JSON.parse()。
3. expectedSlideCount 和 completedSlideCount 必须等于 slides 数组长度。
4. 每一页必须有 title（不得为空）。
5. 每一页必须有 shortTitle（≤8字精炼标题）和 displayTitle（≤14字 PPT 显示标题），封面页尤其重要。
6. 每一页必须有 visualBrief（描述该页最适合的视觉意象或图片主题，不超过50字）——这是必填项，不得遗漏。
7. 每一页必须有 summary（2-4句摘要）和 speakerNotes（2-5句演讲备注）。
8. 尽量为每页填充 summary/body/items/oneLiner/keywords/keyTakeaways 等内容层，以支持不同模板渲染。`

  return { systemPrompt, userPrompt }
}

// ---------------------------------------------------------------------------
// Prompt builder: from manuscript
// ---------------------------------------------------------------------------

export function buildPromptFromManuscript(req: DeckBuildRequest): {
  systemPrompt: string
  userPrompt: string
} {
  const lang = req.language ?? 'zh'
  const imageMode = req.imageMode ?? 'none'

  const systemPrompt = `你是一位专业的演示文稿策划师，擅长将书面文稿转化为清晰的演示文稿内容包。
你的任务是阅读用户提供的文稿，理解其核心内容和逻辑结构，然后规划一份用于演讲/汇报的 DeckDocument。

## 核心原则
1. 不是照抄文稿，而是提炼关键内容，重新组织成适合演示的结构。
2. DeckDocument 是内容真相，不包含任何模板、颜色、字体等视觉信息。
3. 只输出一段合法的 JSON 对象，不含代码块标记，不含任何说明文字。
4. 每页要填充多个内容层，以支持学术、商务、中国风等不同模板渲染。

## 内容层填充要求
- 每页必须有 summary（本页核心信息的1-2句概括）。
- text_content 页必须有 body（正文段落）和 keyTakeaways（2-3个结论）。
- content_cards 页必须有 items（3-6条要点，每条≤20字）和 keywords。
- section_divider 页必须有 oneLiner（一句话）和 keywords（3-5个）。
- closing 页必须有 oneLiner 和 keyTakeaways（2-4个）。
- 学术内容应有 speakerNotes（演讲备注）和 keyTakeaways。
- 商务内容应有 items 和 keywords。
- 文学/散文内容应有 oneLiner、summary、visualBrief。

## 输出要求
- source.type 必须为 "manuscript"
- imageMode 固定为 "${imageMode}"
- language 固定为 "${lang}"
- 演示文稿目标：让听众 10-20 分钟内理解文稿的核心主张和关键内容
- 必须有 cover、toc、section_divider（每章）、closing 页
- content_cards 的 items 必须为 3-6 个
${DECK_JSON_SPEC}`

  const manuscriptSnippet = req.manuscriptContent
    ? req.manuscriptContent.slice(0, 8000)
    : '（未提供文稿内容）'

  const additionalRequirements = req.prompt
    ? `\n用户补充要求（请在生成 PPT 结构时参考，不要忽略）：\n${req.prompt.slice(0, 500)}\n`
    : ''

  const userPrompt = `请将以下文稿转化为演示文稿 DeckDocument JSON：

---文稿开始---
${manuscriptSnippet}
---文稿结束---
${additionalRequirements}
要求：
1. 只输出 JSON，不要任何前缀、后缀或说明。
2. JSON 必须完整合法，可以直接 JSON.parse()。
3. 提炼文稿要点，而不是照搬文字。
4. 每个内容 slide 必须有：title、summary（本页核心信息）、body 或 items（至少一种）。
5. 文稿的每个章节尽量拆分为2-3个 slide，不要单页硬塞所有内容。
6. expectedSlideCount 和 completedSlideCount 必须等于 slides 数组长度。`

  return { systemPrompt, userPrompt }
}

// ---------------------------------------------------------------------------
// Prompt builder: AI-assisted PPTX rebuild
// ---------------------------------------------------------------------------

export function buildPromptFromRawPptx(
  rawSlides: Array<{ slideIndex: number; title?: string; body?: string; texts: string[] }>,
  req: DeckBuildRequest
): { systemPrompt: string; userPrompt: string } {
  const lang = req.language ?? 'zh'

  const systemPrompt = `你是一位演示文稿内容分析专家。
你的任务是分析从 PPTX 文件中提取的原始文本，重建一份结构化的 DeckDocument。

## 核心原则
1. 分析每页幻灯片的内容，判断其语义意图（intent）。
2. 保留原始内容，但以 DeckDocument 格式重新组织。
3. DeckDocument 不包含任何模板、颜色、字体等视觉信息。
4. 只输出一段合法的 JSON 对象，不含代码块标记，不含任何说明文字。
5. 每页尽量提取 summary、keywords、items（如原页有 bullets）、visualBrief（如原页有图片描述）。

## 输出要求
- source.type 必须为 "imported_pptx"
- language 固定为 "${lang}"
- imageMode 固定为 "none"（导入时不生成新图片）
${DECK_JSON_SPEC}`

  const slideSummary = rawSlides.slice(0, 30).map(s =>
    `第${s.slideIndex + 1}页：标题="${s.title ?? ''}" 内容="${(s.body ?? s.texts.join(' ')).slice(0, 120)}"`
  ).join('\n')

  const userPrompt = `以下是从 PPTX 文件中提取的原始文本，请重建为 DeckDocument JSON：

${slideSummary}

要求：
1. 只输出 JSON，不要任何前缀、后缀或说明。
2. 为每页判断合适的 intent。
3. 保留原始标题和正文内容；如原页有 bullets，转为 items 数组。
4. 每页提取 summary（1-2句概括）和 keywords（2-4个关键词）。
5. expectedSlideCount 和 completedSlideCount 必须等于 slides 数组长度。`

  return { systemPrompt, userPrompt }
}

