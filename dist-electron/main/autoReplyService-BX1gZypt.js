"use strict";Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});const S=require("node:path"),T=require("electron"),w=require("./index-CT1FK6FT.js"),A={id:"default",name:"默认策略",autoReplyType:"auto_low_risk",lowRiskConfidenceThreshold:.75,mediumRiskConfidenceThreshold:.5,allowExternalEmailReply:!0,allowChatReply:!0},k=`

---
**[AI 托管回复]** 此回复由 AI 助手根据知识库自动生成，并非本人亲自作答。如有重要事项，请等待本人回复。`;function R(n,e,a,y){const i=[],c=`${n} ${e}`.toLowerCase();y||i.push("no_kb_basis"),a<.45&&i.push("low_confidence");const p=["批准","审批","同意","拒绝","否决","授权","审核通过"],g=["付款","转账","报销","预算","合同金额","开票","财务","账户","汇款"],u=["辞退","开除","处分","降职","警告","劝退","停职","解雇"],m=["投诉","举报","违规","违法","检举","纪律"],f=["法律","诉讼","仲裁","赔偿","起诉","合同纠纷","律师"],s=["身份证","银行卡","密码","个人信息","医疗","隐私"];p.some(o=>c.includes(o))&&i.push("approval_decision"),g.some(o=>c.includes(o))&&i.push("financial_commitment"),u.some(o=>c.includes(o))&&i.push("personnel_action"),m.some(o=>c.includes(o))&&i.push("complaint_handling"),f.some(o=>c.includes(o))&&i.push("legal_liability"),s.some(o=>c.includes(o))&&i.push("sensitive_personal");const l=[...new Set(i)],r=["approval_decision","financial_commitment","personnel_action","complaint_handling","legal_liability","sensitive_personal"],h=l.some(o=>r.includes(o));let t;h||l.includes("no_kb_basis")?t="high":a<.6||l.includes("low_confidence")?t="medium":t="low";const d=h?.9:a<.6?.5:.2;return{level:t,reasons:l,score:d}}function $(n,e){const a=n.sourceType==="email"?"邮件":"内部通讯",y=n.messageSubject?`
主题：${n.messageSubject}`:"";return`你是一个专业的 AI 助手，正在代替员工处理其${a}。员工当前处于"AI 托管"状态（下班中）。

任务：
1. 阅读来自 "${n.senderName}" 的${a}内容
2. 根据知识库中的相关信息生成一条得体、专业的回复
3. 如果知识库中没有相关信息，回复中应说明无法确认，并提示等待本人回复
4. 回复语言与原消息一致（中文消息用中文回复，英文用英文）
5. 不要伪装成员工本人，不要承诺任何具体事项
6. 保持简洁、礼貌、专业

来自 ${n.senderName} 的消息：${y}
${n.messageBody}

${e?`知识库参考资料：
${e}`:"（当前未找到相关知识库资料）"}

请直接输出回复正文，不要包含主题行，不要签名（系统会自动添加 AI 标识）：`}function b(n,e,a){return`请评估以下 AI 生成回复的质量和置信度。

原始消息：
${n.slice(0,500)}

生成的回复：
${e.slice(0,500)}

知识库依据：
${a?a.slice(0,400):"无"}

请以 JSON 格式返回置信度评估，只返回 JSON，不要有其他文字：
{"confidence": 0.0-1.0, "hasKnowledgeBasis": true/false, "reason": "简短原因"}`}async function x(n,e,a){if(e.length===0)return{context:"",citations:[]};try{const{KnowledgeService:y}=await Promise.resolve().then(()=>require("./index-CT1FK6FT.js")).then(g=>g.knowledgeService),i=T.app.getPath("userData"),c=[],p=[];for(const g of e.slice(0,3)){const u=S.join(i,"knowledge",g==="default"?"":g);try{const m=new y(u),f=await m.listDocuments();if(f.length===0)continue;const s=n.toLowerCase(),l=f.filter(r=>{var t;return r.title.toLowerCase().includes(s.slice(0,20))||((t=r.previewText)==null?void 0:t.toLowerCase().includes(s.slice(0,20)))}).slice(0,2);for(const r of l){const h=await m.getDocument(r.id).catch(()=>null);if(!h)continue;const t=h.extractedText??"";t.length>100&&(p.push(`[${r.title}]
${t.slice(0,600)}`),c.push({documentId:r.id,documentTitle:r.title,chunkId:r.id,quote:t.slice(0,120)}))}}catch{}}return{context:p.slice(0,4).join(`

`),citations:c.slice(0,6)}}catch{return{context:"",citations:[]}}}class _{async generateReply(e,a,y=A){const i=[e.messageSubject,e.messageBody].filter(Boolean).join(" "),{context:c,citations:p}=await x(i,e.knowledgeBases),g=$(e,c);let u;try{u=await w.completeText(a,{systemPrompt:"你是一个专业、谨慎的 AI 助手，正在帮助处于下班托管状态的员工回复消息。",userPrompt:g,temperature:.4,maxTokens:800})}catch(d){const o=d instanceof Error?d.message:String(d);throw new Error(`AI 回复生成失败: ${o}`)}u=u.trim();let m=.6,f=p.length>0;try{const d=b(e.messageBody,u,c),I=(await w.completeText(a,{systemPrompt:"你是一个质量评估专家，只返回 JSON，不返回其他内容。",userPrompt:d,temperature:.1,maxTokens:100})).match(/\{[^}]+\}/);if(I){const v=JSON.parse(I[0]);typeof v.confidence=="number"&&(m=Math.max(0,Math.min(1,v.confidence))),typeof v.hasKnowledgeBasis=="boolean"&&(f=v.hasKnowledgeBasis)}}catch{}const s=R(e.messageBody,u,m,f);let l=!1;s.level==="low"&&(l=y.autoReplyType==="auto_low_risk");const r=u+k,h={content:r,riskLevel:s.level,highRiskReasons:s.reasons.length>0?s.reasons:void 0,confidence:m,autoSent:l,knowledgeCitations:p,generatedAt:new Date().toISOString()};await w.delegationService.appendAuditEvent({action:"auto_reply_generated",actorId:e.recipientUserId,actorUsername:e.recipientUserId,detail:{sourceType:e.sourceType,sourceMessageId:e.sourceMessageId,riskLevel:s.level,confidence:m,autoSent:l,citationCount:p.length}});let t=null;return l?await w.delegationService.appendAuditEvent({action:"auto_reply_sent",actorId:e.recipientUserId,actorUsername:e.recipientUserId,detail:{sourceType:e.sourceType,sourceMessageId:e.sourceMessageId,riskLevel:s.level}}):(t={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,userId:e.recipientUserId,sourceType:e.sourceType,sourceMessageId:e.sourceMessageId,sourceThreadId:e.sourceThreadId,senderName:e.senderName,senderAddress:e.senderAddress,messageSummary:e.messageBody.slice(0,200),replyContent:r,riskLevel:s.level,highRiskReasons:s.reasons.length>0?s.reasons:void 0,confidence:m,knowledgeCitations:p.map(d=>({documentId:d.documentId,documentTitle:d.documentTitle,quote:d.quote})),status:"pending_review",createdAt:new Date().toISOString()},await w.delegationService.savePendingReply(t),await w.delegationService.appendAuditEvent({action:"auto_reply_queued_review",actorId:e.recipientUserId,actorUsername:e.recipientUserId,entityId:t.id,detail:{riskLevel:s.level,reasons:s.reasons}})),{result:h,pendingReply:t}}}const C=new _;exports.AutoReplyService=_;exports.autoReplyService=C;
