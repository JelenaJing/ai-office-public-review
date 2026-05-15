"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const path = require("node:path");
const electron = require("electron");
const index = require("./index-DTiSj2UJ.js");
const DEFAULT_DELEGATION_POLICY = {
  id: "default",
  name: "默认策略",
  autoReplyType: "auto_low_risk",
  lowRiskConfidenceThreshold: 0.75,
  mediumRiskConfidenceThreshold: 0.5,
  allowExternalEmailReply: true,
  allowChatReply: true
};
const AI_DELEGATION_BADGE = "\n\n---\n**[AI 托管回复]** 此回复由 AI 助手根据知识库自动生成，并非本人亲自作答。如有重要事项，请等待本人回复。";
function assessMessageRisk(messageBody, replyContent, confidence, hasKnowledgeBasis) {
  const reasons = [];
  const text = `${messageBody} ${replyContent}`.toLowerCase();
  if (!hasKnowledgeBasis) reasons.push("no_kb_basis");
  if (confidence < 0.45) reasons.push("low_confidence");
  const approvalWords = ["批准", "审批", "同意", "拒绝", "否决", "授权", "审核通过"];
  const financialWords = ["付款", "转账", "报销", "预算", "合同金额", "开票", "财务", "账户", "汇款"];
  const personnelWords = ["辞退", "开除", "处分", "降职", "警告", "劝退", "停职", "解雇"];
  const complaintWords = ["投诉", "举报", "违规", "违法", "检举", "纪律"];
  const legalWords = ["法律", "诉讼", "仲裁", "赔偿", "起诉", "合同纠纷", "律师"];
  const sensitiveWords = ["身份证", "银行卡", "密码", "个人信息", "医疗", "隐私"];
  if (approvalWords.some((w) => text.includes(w))) reasons.push("approval_decision");
  if (financialWords.some((w) => text.includes(w))) reasons.push("financial_commitment");
  if (personnelWords.some((w) => text.includes(w))) reasons.push("personnel_action");
  if (complaintWords.some((w) => text.includes(w))) reasons.push("complaint_handling");
  if (legalWords.some((w) => text.includes(w))) reasons.push("legal_liability");
  if (sensitiveWords.some((w) => text.includes(w))) reasons.push("sensitive_personal");
  const uniqueReasons = [...new Set(reasons)];
  const criticalReasons = [
    "approval_decision",
    "financial_commitment",
    "personnel_action",
    "complaint_handling",
    "legal_liability",
    "sensitive_personal"
  ];
  const hasCritical = uniqueReasons.some((r) => criticalReasons.includes(r));
  let level;
  if (hasCritical || uniqueReasons.includes("no_kb_basis")) {
    level = "high";
  } else if (confidence < 0.6 || uniqueReasons.includes("low_confidence")) {
    level = "medium";
  } else {
    level = "low";
  }
  const score = hasCritical ? 0.9 : confidence < 0.6 ? 0.5 : 0.2;
  return { level, reasons: uniqueReasons, score };
}
function buildAutoReplyPrompt(input, knowledgeContext) {
  const sourceType = input.sourceType === "email" ? "邮件" : "内部通讯";
  const subjectLine = input.messageSubject ? `
主题：${input.messageSubject}` : "";
  return `你是一个专业的 AI 助手，正在代替员工处理其${sourceType}。员工当前处于"AI 托管"状态（下班中）。

任务：
1. 阅读来自 "${input.senderName}" 的${sourceType}内容
2. 根据知识库中的相关信息生成一条得体、专业的回复
3. 如果知识库中没有相关信息，回复中应说明无法确认，并提示等待本人回复
4. 回复语言与原消息一致（中文消息用中文回复，英文用英文）
5. 不要伪装成员工本人，不要承诺任何具体事项
6. 保持简洁、礼貌、专业

来自 ${input.senderName} 的消息：${subjectLine}
${input.messageBody}

${knowledgeContext ? `知识库参考资料：
${knowledgeContext}` : "（当前未找到相关知识库资料）"}

请直接输出回复正文，不要包含主题行，不要签名（系统会自动添加 AI 标识）：`;
}
function buildConfidenceAssessmentPrompt(messageBody, replyContent, knowledgeContext) {
  return `请评估以下 AI 生成回复的质量和置信度。

原始消息：
${messageBody.slice(0, 500)}

生成的回复：
${replyContent.slice(0, 500)}

知识库依据：
${knowledgeContext ? knowledgeContext.slice(0, 400) : "无"}

请以 JSON 格式返回置信度评估，只返回 JSON，不要有其他文字：
{"confidence": 0.0-1.0, "hasKnowledgeBasis": true/false, "reason": "简短原因"}`;
}
async function retrieveKnowledgeContext(query, knowledgeBases, settings) {
  if (knowledgeBases.length === 0) {
    return { context: "", citations: [] };
  }
  try {
    const { KnowledgeService } = await Promise.resolve().then(() => require("./index-DTiSj2UJ.js")).then((n) => n.knowledgeService);
    const userData = electron.app.getPath("userData");
    const citations = [];
    const contextParts = [];
    for (const kbId of knowledgeBases.slice(0, 3)) {
      const kbPath = path.join(userData, "knowledge", kbId === "default" ? "" : kbId);
      try {
        const service = new KnowledgeService(kbPath);
        const docs = await service.listDocuments();
        if (docs.length === 0) continue;
        const queryLower = query.toLowerCase();
        const relevantDocs = docs.filter((doc) => {
          var _a;
          const titleMatch = doc.title.toLowerCase().includes(queryLower.slice(0, 20));
          return titleMatch || ((_a = doc.previewText) == null ? void 0 : _a.toLowerCase().includes(queryLower.slice(0, 20)));
        }).slice(0, 2);
        for (const doc of relevantDocs) {
          const detail = await service.getDocument(doc.id).catch(() => null);
          if (!detail) continue;
          const text = detail.extractedText ?? "";
          if (text.length > 100) {
            contextParts.push(`[${doc.title}]
${text.slice(0, 600)}`);
            citations.push({
              documentId: doc.id,
              documentTitle: doc.title,
              chunkId: doc.id,
              quote: text.slice(0, 120)
            });
          }
        }
      } catch {
      }
    }
    return {
      context: contextParts.slice(0, 4).join("\n\n"),
      citations: citations.slice(0, 6)
    };
  } catch {
    return { context: "", citations: [] };
  }
}
class AutoReplyService {
  async generateReply(input, settings, policy = DEFAULT_DELEGATION_POLICY) {
    const query = [input.messageSubject, input.messageBody].filter(Boolean).join(" ");
    const { context: knowledgeContext, citations } = await retrieveKnowledgeContext(
      query,
      input.knowledgeBases
    );
    const prompt = buildAutoReplyPrompt(input, knowledgeContext);
    let replyContent;
    try {
      replyContent = await index.completeText(settings, {
        systemPrompt: "你是一个专业、谨慎的 AI 助手，正在帮助处于下班托管状态的员工回复消息。",
        userPrompt: prompt,
        temperature: 0.4,
        maxTokens: 800
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`AI 回复生成失败: ${errorMsg}`);
    }
    replyContent = replyContent.trim();
    let confidence = 0.6;
    let hasKnowledgeBasis = citations.length > 0;
    try {
      const assessPrompt = buildConfidenceAssessmentPrompt(
        input.messageBody,
        replyContent,
        knowledgeContext
      );
      const assessRaw = await index.completeText(settings, {
        systemPrompt: "你是一个质量评估专家，只返回 JSON，不返回其他内容。",
        userPrompt: assessPrompt,
        temperature: 0.1,
        maxTokens: 100
      });
      const jsonMatch = assessRaw.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.confidence === "number") {
          confidence = Math.max(0, Math.min(1, parsed.confidence));
        }
        if (typeof parsed.hasKnowledgeBasis === "boolean") {
          hasKnowledgeBasis = parsed.hasKnowledgeBasis;
        }
      }
    } catch {
    }
    const risk = assessMessageRisk(
      input.messageBody,
      replyContent,
      confidence,
      hasKnowledgeBasis
    );
    let autoSent = false;
    if (risk.level === "low") {
      autoSent = policy.autoReplyType === "auto_low_risk";
    }
    const finalContent = replyContent + AI_DELEGATION_BADGE;
    const result = {
      content: finalContent,
      riskLevel: risk.level,
      highRiskReasons: risk.reasons.length > 0 ? risk.reasons : void 0,
      confidence,
      autoSent,
      knowledgeCitations: citations,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await index.delegationService.appendAuditEvent({
      action: "auto_reply_generated",
      actorId: input.recipientUserId,
      actorUsername: input.recipientUserId,
      detail: {
        sourceType: input.sourceType,
        sourceMessageId: input.sourceMessageId,
        riskLevel: risk.level,
        confidence,
        autoSent,
        citationCount: citations.length
      }
    });
    let pendingReply = null;
    if (!autoSent) {
      pendingReply = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: input.recipientUserId,
        sourceType: input.sourceType,
        sourceMessageId: input.sourceMessageId,
        sourceThreadId: input.sourceThreadId,
        senderName: input.senderName,
        senderAddress: input.senderAddress,
        messageSummary: input.messageBody.slice(0, 200),
        replyContent: finalContent,
        riskLevel: risk.level,
        highRiskReasons: risk.reasons.length > 0 ? risk.reasons : void 0,
        confidence,
        knowledgeCitations: citations.map((c) => ({
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          quote: c.quote
        })),
        status: "pending_review",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await index.delegationService.savePendingReply(pendingReply);
      await index.delegationService.appendAuditEvent({
        action: "auto_reply_queued_review",
        actorId: input.recipientUserId,
        actorUsername: input.recipientUserId,
        entityId: pendingReply.id,
        detail: {
          riskLevel: risk.level,
          reasons: risk.reasons
        }
      });
    } else {
      await index.delegationService.appendAuditEvent({
        action: "auto_reply_sent",
        actorId: input.recipientUserId,
        actorUsername: input.recipientUserId,
        detail: {
          sourceType: input.sourceType,
          sourceMessageId: input.sourceMessageId,
          riskLevel: risk.level
        }
      });
    }
    return { result, pendingReply };
  }
}
const autoReplyService = new AutoReplyService();
exports.AutoReplyService = AutoReplyService;
exports.autoReplyService = autoReplyService;
