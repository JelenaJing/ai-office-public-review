import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { ERROR_CODES } from "../../../shared/constants.js";

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function unzipToFiles(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files = {};
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    files[entry.name] = await entry.async("string");
  }
  return files;
}

function validateManifest(manifestText) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "manifest invalid json" };
  }
  if (manifest.schema_version !== "ai-office-skin-v1") {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "unsupported skin schema_version" };
  }
  if (manifest.package_type !== "aoskin") {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "package_type must be aoskin" };
  }
  if (manifest.closed_world !== true) {
    return { ok: false, code: ERROR_CODES.CLOSED_WORLD_REQUIRED, message: "closed_world must be true" };
  }
  if (manifest.external_skill_calls_allowed !== false) {
    return { ok: false, code: ERROR_CODES.EXTERNAL_CALLS_FORBIDDEN, message: "external_skill_calls_allowed must be false" };
  }
  if (!manifest.skill?.skill_id || !manifest.skill?.version) {
    return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FIELDS, message: "manifest skill id/version missing" };
  }
  return { ok: true, manifest };
}

function validateChecksums(files, checksumsText) {
  let checksums;
  try {
    checksums = JSON.parse(checksumsText);
  } catch {
    return { ok: false, code: ERROR_CODES.CHECKSUM_MISMATCH, message: "checksums invalid json" };
  }
  if (checksums.algorithm !== "sha256" || !Array.isArray(checksums.files)) {
    return { ok: false, code: ERROR_CODES.CHECKSUM_MISMATCH, message: "checksums format invalid" };
  }
  for (const item of checksums.files) {
    if (!item.path || !item.sha256) {
      return { ok: false, code: ERROR_CODES.CHECKSUM_MISMATCH, message: "checksums item invalid" };
    }
    const content = files[item.path];
    if (typeof content !== "string") {
      return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FILE, message: `missing checksummed file: ${item.path}` };
    }
    const computed = sha256Hex(content);
    if (computed !== item.sha256) {
      return {
        ok: false,
        code: ERROR_CODES.CHECKSUM_MISMATCH,
        message: `checksum mismatch: ${item.path}`,
        details: { expected: item.sha256, actual: computed }
      };
    }
  }
  return { ok: true };
}

function validateSignature(checksumsText, signatureText) {
  let sig;
  try {
    sig = JSON.parse(signatureText);
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature invalid json" };
  }
  if (sig.algorithm !== "ed25519") {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature algorithm must be ed25519" };
  }
  try {
    const publicKey = createPublicKey(sig.public_key_pem);
    const digest = sha256Hex(checksumsText);
    const valid = verify(
      null,
      Buffer.from(digest, "utf8"),
      publicKey,
      Buffer.from(sig.signature_base64, "base64")
    );
    if (!valid) return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature verify failed" };
    return { ok: true };
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature verify exception" };
  }
}

export async function decodeAoskinInstallPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD, message: "payload invalid" };
  }
  let files = null;
  if (payload.capsule?.files && typeof payload.capsule.files === "object") {
    files = payload.capsule.files;
  } else if (typeof payload.skin_binary_base64 === "string") {
    const zipBuffer = Buffer.from(payload.skin_binary_base64, "base64");
    files = await unzipToFiles(zipBuffer);
  } else if (typeof payload.skin_path === "string") {
    const zipBuffer = await readFile(payload.skin_path);
    files = await unzipToFiles(zipBuffer);
  } else {
    return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FIELDS, message: "capsule.files or skin_binary_base64 or skin_path required" };
  }

  if (!files["AOSKIN"] || !files["manifest.json"] || !files["checksums.json"] || !files["signature.sig"]) {
    return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FILE, message: "AOSKIN/manifest/checksums/signature missing" };
  }
  if (files["AOSKIN"].trim() !== "AI_OFFICE_SKIN_CAPSULE_V1") {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "invalid AOSKIN marker" };
  }

  const manifestResult = validateManifest(files["manifest.json"]);
  if (!manifestResult.ok) return manifestResult;
  const checksumsResult = validateChecksums(files, files["checksums.json"]);
  if (!checksumsResult.ok) return checksumsResult;
  const signatureResult = validateSignature(files["checksums.json"], files["signature.sig"]);
  if (!signatureResult.ok) return signatureResult;

  return {
    ok: true,
    manifest: manifestResult.manifest,
    files,
    package_hash: `sha256:${sha256Hex(files["checksums.json"])}`
  };
}

let cachedRuntimeConfig = null;

function parseEnvText(envText) {
  const out = {};
  const lines = String(envText || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }
  return out;
}

async function resolveRuntimeConfig() {
  if (cachedRuntimeConfig) return cachedRuntimeConfig;
  let envLocal = {};
  try {
    const envPath = path.resolve(process.cwd(), "../.env.local");
    const raw = await readFile(envPath, "utf8");
    envLocal = parseEnvText(raw);
  } catch {
    // ignore missing .env.local
  }

  const explicitKey =
    process.env.SKILL_LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    envLocal.SKILL_LLM_API_KEY ||
    envLocal.OPENAI_API_KEY ||
    "";

  const deepseekKey = process.env.DEEPSEEK_API_KEY || envLocal.DEEPSEEK_API_KEY || "";
  const qwenKey = process.env.QWEN_API_KEY || envLocal.QWEN_API_KEY || "";

  let apiKey = explicitKey;
  let model =
    process.env.SKILL_LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    envLocal.SKILL_LLM_MODEL ||
    envLocal.OPENAI_MODEL ||
    "gpt-4o-mini";
  let baseUrl =
    process.env.SKILL_LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    envLocal.SKILL_LLM_BASE_URL ||
    envLocal.OPENAI_BASE_URL ||
    "https://api.openai.com/v1/chat/completions";

  if (!apiKey && deepseekKey) {
    apiKey = deepseekKey;
    if (!process.env.SKILL_LLM_BASE_URL && !envLocal.SKILL_LLM_BASE_URL) {
      baseUrl = "https://api.deepseek.com/chat/completions";
    }
    if (!process.env.SKILL_LLM_MODEL && !envLocal.SKILL_LLM_MODEL) {
      model = "deepseek-chat";
    }
  } else if (!apiKey && qwenKey) {
    apiKey = qwenKey;
    if (!process.env.SKILL_LLM_BASE_URL && !envLocal.SKILL_LLM_BASE_URL) {
      baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    }
    if (!process.env.SKILL_LLM_MODEL && !envLocal.SKILL_LLM_MODEL) {
      model = "qwen-plus";
    }
  }

  cachedRuntimeConfig = { apiKey, model, baseUrl };
  return cachedRuntimeConfig;
}

function compactText(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function buildPrompts(hostAction, request) {
  const input = request.input || {};
  const prompt = compactText(input.prompt || input.instruction || input.topic || input.query || "");
  const source = compactText(input.documentText || input.draftText || input.paragraph || input.context || "");
  const language = compactText(input.language || "zh");

  const defaultUserPrompt = prompt
    ? `任务要求：${prompt}${source ? `\n\n参考内容：\n${source}` : ""}`
    : source || "请根据上下文生成高质量内容。";

  const map = {
    "writing.continue": {
      system: "你是专业学术写作助手。请直接续写正文，不要解释，不要复述输入。",
      user: `请续写以下内容，语言=${language}，至少输出300字正文。\n${defaultUserPrompt}`
    },
    "writing.rewrite": {
      system: "你是专业学术编辑。请在保持原意前提下重写文本，提升严谨性与流畅度。",
      user: `请重写以下内容，语言=${language}，至少输出200字。\n${defaultUserPrompt}`
    },
    "writing.assistant": {
      system: "你是专业 AI 写作助手。根据用户要求输出完整正文，直接给结果。",
      user: `请完成写作任务，语言=${language}，若无特殊限制请输出不少于500字。\n${defaultUserPrompt}`
    },
    "writing.outline": {
      system: "你是论文写作顾问。输出结构化 Markdown 大纲。",
      user: `请为主题生成论文大纲，语言=${language}。\n${defaultUserPrompt}`
    },
    "writing.topic": {
      system: "你是资深科研导师。请输出选题分析，包含价值、问题、创新点与关键词。",
      user: `请分析论文选题，语言=${language}。\n${defaultUserPrompt}`
    },
    "writing.experiment_plan": {
      system: "你是实验设计顾问。输出严谨的实验计划，包含目标、变量、数据、指标、风险。",
      user: `请生成实验计划，语言=${language}。\n${defaultUserPrompt}`
    },
    "paper.generate": {
      system: "你是专业论文写作助手。请输出一篇完整论文初稿（Markdown）。",
      user: `请生成论文初稿，语言=${language}。\n${defaultUserPrompt}`
    },
    "ppt.generate": {
      system: "你是演示文稿专家。请生成可直接用于 PPT 的结构化内容。",
      user: `请生成 PPT 文案（封面、目录、逐页要点、总结），语言=${language}。\n${defaultUserPrompt}`
    },
    "writing.generate": {
      system: "你是高质量写作助手。请按要求直接输出最终稿。",
      user: `请生成内容，语言=${language}。\n${defaultUserPrompt}`
    },
    "analysis.generate": {
      system: "你是资深分析师。请输出结构化分析报告，含结论与建议。",
      user: `请完成分析任务，语言=${language}。\n${defaultUserPrompt}`
    }
  };

  return map[hostAction] || map["writing.assistant"];
}

async function callLlmForHostAction(hostAction, request) {
  const { apiKey, baseUrl, model } = await resolveRuntimeConfig();
  const prompts = buildPrompts(hostAction, request);
  if (!apiKey) {
    return `[fallback]\n${prompts.user}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 2600,
        stream: false,
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user }
        ]
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return compactText(data?.choices?.[0]?.message?.content, "");
}

export async function runAoskinOperation(installedSkill, request) {
  const op = (installedSkill.manifest.operations || []).find((item) => item.operation === request.operation);
  if (!op) {
    return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FIELDS, message: `operation not found: ${request.operation}` };
  }

  const hostAction = op.host_action;
  const primaryArtifactId = `artifact_${request.run_id}`;
  let contentText = "";
  try {
    contentText = await callLlmForHostAction(hostAction, request);
  } catch (error) {
    return {
      ok: false,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "host_action execution failed",
      details: { host_action: hostAction, reason: error instanceof Error ? error.message : String(error) }
    };
  }

  const artifactPackage = {
    schema_version: "ai-office-artifact-package-v1",
    run_id: request.run_id,
    skill_id: request.skill_id,
    status: "completed",
    primary_artifact_id: primaryArtifactId,
    artifacts: [
      {
        artifact_id: primaryArtifactId,
        type: "document",
        title: `${request.skill_id} output`,
        mime_type: "application/vnd.ai-office.document+json",
        content: { blocks: [{ block_id: "blk_1", type: "paragraph", text: contentText }] },
        metadata: { host_action: hostAction, operation: request.operation }
      }
    ]
  };
  return { ok: true, artifactPackage, hostAction };
}

