import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import * as path from "node:path";
import { AUDIT_EVENTS, ERROR_CODES, errorBody } from "../../../shared/constants.js";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const config = {
  port: Number(argValue("--port") || process.env.SKILL_LIBRARY_PORT || 4010),
  env: process.env.SKILL_ENV || "development",
  token: process.env.SKILL_INTERNAL_API_TOKEN || "change-this-token",
  allowedOrigins: (process.env.SKILL_ALLOWED_ORIGINS || "http://localhost:4030")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
};

if (config.env === "production" && config.token === "change-this-token") {
  throw new Error("SKILL_INTERNAL_API_TOKEN must be set in production.");
}

const categoryLabels = {
  "工作": "工作",
  "学习": "学习",
  "生活": "生活",
  writing: "写作",
  research: "研究",
  docs: "文档",
  productivity: "效率",
  analysis: "分析",
  creative: "创意",
  developer: "开发"
};

const baseSkills = [
  {
    skill_id: "paper_writer_v1",
    name: "论文写作助手",
    description: "从选题、提纲、正文到参考文献，帮助团队生成结构清晰的学术论文草稿。",
    category: "写作",
    price: 299,
    latest_version: "1.0.0",
    tags: ["论文", "引用", "研究"],
    rating: 4.9,
    sales: 12458,
    package_file: "paper_writer_v1-1.0.0.aoskin",
    package_hash: "sha256:8f952313a8e4d618cc1b813d50cb2743e0a3c3c1adb569b40e28af1acce9fef6",
    size: 1422
  },
  {
    skill_id: "ppt_generator_v1",
    name: "PPT 生成器",
    description: "根据资料自动整理演示结构、页标题和讲稿，适合汇报、培训和方案展示。",
    category: "文档",
    price: 199,
    latest_version: "1.0.0",
    tags: ["PPT", "汇报", "大纲"],
    rating: 4.8,
    sales: 8421
  },
  {
    skill_id: "continue_writer_v1",
    name: "续写助手",
    description: "保持原文语气与结构，快速补完段落、章节和营销文案。",
    category: "写作",
    price: 99,
    latest_version: "1.0.0",
    tags: ["续写", "润色"],
    rating: 4.7,
    sales: 7210
  },
  {
    skill_id: "rewrite_writer_v1",
    name: "改写润色",
    description: "对文本进行风格改写、压缩扩写、语气转换和专业化表达。",
    category: "写作",
    price: 99,
    latest_version: "1.0.0",
    tags: ["改写", "润色", "风格"],
    rating: 4.8,
    sales: 6816
  },
  {
    skill_id: "writing_assistant_v1",
    name: "通用写作工作台",
    description: "覆盖邮件、方案、周报和制度文本的日常写作助手。",
    category: "效率",
    price: 149,
    latest_version: "1.0.0",
    tags: ["办公", "邮件", "方案"],
    rating: 4.6,
    sales: 5321
  },
  {
    skill_id: "outline_generator_v1",
    name: "提纲生成器",
    description: "根据主题和目标读者生成层次分明、可直接展开的内容骨架。",
    category: "效率",
    price: 79,
    latest_version: "1.0.0",
    tags: ["提纲", "规划"],
    rating: 4.5,
    sales: 4188
  },
  {
    skill_id: "topic_analyzer_v1",
    name: "选题分析器",
    description: "分析主题价值、受众意图、竞品内容和可执行切入点。",
    category: "分析",
    price: 89,
    latest_version: "1.0.0",
    tags: ["选题", "洞察"],
    rating: 4.6,
    sales: 3770
  },
  {
    skill_id: "experiment_plan_v1",
    name: "实验方案设计",
    description: "把研究假设转成变量、分组、步骤、风险和数据记录模板。",
    category: "研究",
    price: 109,
    latest_version: "1.0.0",
    tags: ["实验", "研究", "计划"],
    rating: 4.7,
    sales: 2914
  },
  {
    skill_id: "ppt_template_cuhk_business",
    name: "港中大商务汇报模板",
    description: "港中大（深圳）风格商务汇报 PPT 模板，适合部门汇报、项目陈述和校企合作展示。",
    category: "文档",
    price: 0,
    latest_version: "1.0.0",
    tags: ["PPT", "模板", "商务"],
    rating: 4.8,
    sales: 1200,
    package_file: "ppt_template_cuhk_business-1.0.0.aoskin",
    package_hash: "sha256:5f825ab8fcf74da18c04cc674315ff33a09bf4c7e81f60c77b8f78d35fc09548",
    size: 612274
  },
  {
    skill_id: "ppt_template_academic_defense",
    name: "学术答辩模板",
    description: "适合毕业答辩、学术研讨和课题汇报的清晰结构化 PPT 模板。",
    category: "研究",
    price: 0,
    latest_version: "1.0.0",
    tags: ["PPT", "模板", "答辩"],
    rating: 4.7,
    sales: 980,
    package_file: "ppt_template_academic_defense-1.0.0.aoskin",
    package_hash: "sha256:6debe3d8493c42ba6fc880f4224b438837810d5481be28c1c78b3c7a3f3a9eeb",
    size: 10619
  }
];

const skills = [];
const packages = [];
const purchases = [];
const creatorPublishedSkills = [];
const withdrawals = [];
const entitlements = [
  {
    entitlement_id: "ent_001",
    user_id: "user_001",
    tenant_id: "tenant_001",
    skill_id: "paper_writer_v1",
    allowed_versions: ">=1.0.0 <2.0.0",
    status: "active"
  },
  {
    entitlement_id: "ent_002",
    user_id: "user_001",
    tenant_id: "tenant_001",
    skill_id: "ppt_template_cuhk_business",
    allowed_versions: ">=1.0.0 <2.0.0",
    status: "active"
  },
  {
    entitlement_id: "ent_003",
    user_id: "user_001",
    tenant_id: "tenant_001",
    skill_id: "ppt_template_academic_defense",
    allowed_versions: ">=1.0.0 <2.0.0",
    status: "active"
  }
];
const installReports = [];
const auditEvents = [];

function normalizeSkill(item, index = 0) {
  const rawCategory = String(item.scene_category || item.category || "").toLowerCase();
  const category =
    categoryLabels[item.scene_category] ||
    (["writing", "docs", "productivity", "analysis", "developer"].includes(rawCategory) ? "工作" : null) ||
    (["research"].includes(rawCategory) ? "学习" : null) ||
    (["creative"].includes(rawCategory) ? "生活" : null) ||
    (["写作", "文档", "效率", "分析", "开发"].includes(String(item.category || "")) ? "工作" : null) ||
    (["研究", "学习"].includes(String(item.category || "")) ? "学习" : null) ||
    (["创意", "生活"].includes(String(item.category || "")) ? "生活" : null) ||
    categoryLabels[item.category] ||
    item.category ||
    "工作";
  const price = Number.isFinite(Number(item.price)) ? Number(item.price) : 99;
  const tags = Array.isArray(item.tags)
    ? item.tags
    : [category, item.operation, item.host_action].filter(Boolean).slice(0, 3);
  const priorityTier = item.priority_tier || "filler";
  const coreRank = Number(item.core_rank || 9999);
  return {
    skill_id: item.skill_id,
    name: item.name || item.skill_id,
    description: item.description || "一个可安装的 AI Office Skill。",
    category,
    price,
    latest_version: item.latest_version || item.version || "1.0.0",
    tags,
    rating: Number(item.rating || (4.4 + ((index % 6) * 0.1)).toFixed(1)),
    sales: Number(item.sales || (priorityTier === "core" ? 100000 - coreRank * 200 : 900 + index * 137)),
    source: item.source || null,
    scene_category: category,
    forum_module: item.forum_module || "forum-work",
    priority_tier: priorityTier,
    core_rank: coreRank
  };
}

function ensurePackage(skill, item = {}) {
  const packageId = item.package_id || `pkg_${skill.skill_id}_${String(skill.latest_version).replaceAll(".", "_")}`;
  if (packages.some((pkg) => pkg.package_id === packageId)) return;
  packages.push({
    package_id: packageId,
    skill_id: skill.skill_id,
    version: item.version || skill.latest_version || "1.0.0",
    package_hash: item.package_hash || `sha256:${skill.skill_id}`,
    signature: item.signature || "ed25519:demo-signature",
    size: Number(item.size || 1024 * (18 + (packages.length % 11))),
    package_file: item.package_file || null,
    manifest: {
      schema_version: "ai-office-skin-v1",
      package_type: "aoskin",
      closed_world: true,
      external_skill_calls_allowed: false,
      operations: [{ operation: item.operation || `${skill.skill_id}.run`, host_action: item.host_action || "skill.run" }],
      skill: {
        skill_id: skill.skill_id,
        version: item.version || skill.latest_version || "1.0.0",
        name: skill.name,
        category: skill.category
      }
    }
  });
}

function seedBaseSkills() {
  for (const [index, item] of baseSkills.entries()) {
    const skill = normalizeSkill(item, index);
    skills.push(skill);
    ensurePackage(skill, item);
  }
}

async function mergeImportedCatalog() {
  const catalogPath = path.resolve("skins", "imported", "catalog.json");
  try {
    await access(catalogPath);
    const text = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(text);
    const items = Array.isArray(catalog.items) ? catalog.items : [];
    for (const [index, item] of items.entries()) {
      if (!item.skill_id) continue;
      if (skills.some((skill) => skill.skill_id === item.skill_id)) continue;
      const skill = normalizeSkill(item, skills.length + index);
      skills.push(skill);
      ensurePackage(skill, item);
    }
    log("info", "imported_catalog_loaded", { count: items.length, catalogPath });
  } catch (error) {
    log("warn", "imported_catalog_missing", { catalogPath, message: error.message });
  }
}

function log(level, message, meta = {}) {
  const payload = { ts: new Date().toISOString(), service: "skill-library-backend", level, message, ...meta };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function writeAudit(event, requestId, detail = {}) {
  const record = {
    event_id: `evt_${randomUUID()}`,
    event,
    request_id: requestId,
    created_at: new Date().toISOString(),
    detail
  };
  auditEvents.push(record);
  if (auditEvents.length > 2000) auditEvents.shift();
  log("info", "audit_event", record);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id, X-Tenant-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, statusCode, code, message, requestId, details) {
  json(res, statusCode, errorBody({ code, message, requestId, details }));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requireInternalToken(req, res, requestId) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${config.token}`) {
    sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "unauthorized", requestId);
    return false;
  }
  return true;
}

function purchasedSkillIds(userId) {
  return new Set([
    ...purchases.filter((purchase) => purchase.user_id === userId).map((purchase) => purchase.skill_id),
    ...entitlements.filter((item) => item.user_id === userId && item.status === "active").map((item) => item.skill_id)
  ]);
}

function storeSkill(skill, purchasedSet) {
  return {
    ...skill,
    purchased: purchasedSet.has(skill.skill_id)
  };
}

function sortedStoreSkills(userId) {
  const owned = purchasedSkillIds(userId);
  return [...skills]
    .sort((a, b) => {
      const aCore = a.priority_tier === "core" ? 1 : 0;
      const bCore = b.priority_tier === "core" ? 1 : 0;
      if (aCore !== bCore) return bCore - aCore;
      const aRank = Number(a.core_rank || 9999);
      const bRank = Number(b.core_rank || 9999);
      if (aRank !== bRank) return aRank - bRank;
      return Number(b.sales || 0) - Number(a.sales || 0);
    })
    .map((skill) => storeSkill(skill, owned));
}

function buildSyncPlan(installedSkills) {
  const installedMap = new Map(
    installedSkills.filter((item) => item?.skill_id && item?.version).map((item) => [item.skill_id, item.version])
  );
  const toInstall = [];
  const toUpdate = [];
  const alreadyLatest = [];

  for (const pkg of packages) {
    const installedVersion = installedMap.get(pkg.skill_id);
    if (!installedVersion) {
      toInstall.push({ skill_id: pkg.skill_id, version: pkg.version, package_id: pkg.package_id, size: pkg.size });
    } else if (installedVersion !== pkg.version) {
      toUpdate.push({ skill_id: pkg.skill_id, from_version: installedVersion, to_version: pkg.version, package_id: pkg.package_id });
    } else {
      alreadyLatest.push({ skill_id: pkg.skill_id, version: pkg.version });
    }
  }

  return { to_install: toInstall, to_update: toUpdate, to_disable: [], already_latest: alreadyLatest };
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routePath = url.pathname;
  const requestId = randomUUID();
  setCors(req, res);
  res.setHeader("X-Request-Id", requestId);

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  log("info", "request", { requestId, method, path: routePath });

  if (method === "GET" && routePath === "/health") {
    json(res, 200, { status: "ok", service: "skill-library-backend" });
    return;
  }

  if (method === "GET" && routePath === "/ready") {
    json(res, 200, { status: "ok", checks: { memory: "ok", in_memory_store: "ok" }, skill_count: skills.length });
    return;
  }

  if (method === "GET" && routePath === "/store/skills") {
    const userId = req.headers["x-user-id"] || "user_001";
    json(res, 200, sortedStoreSkills(userId));
    return;
  }

  if (method === "GET" && routePath.startsWith("/store/skills/")) {
    const skillId = routePath.split("/").pop();
    const skill = skills.find((item) => item.skill_id === skillId);
    if (!skill) return sendError(res, 404, ERROR_CODES.SKILL_NOT_FOUND, "skill_not_found", requestId);
    const userId = req.headers["x-user-id"] || "user_001";
    json(res, 200, storeSkill(skill, purchasedSkillIds(userId)));
    return;
  }

  if (method === "POST" && routePath.match(/^\/store\/skills\/[^/]+\/purchase$/)) {
    const skillId = routePath.split("/")[3];
    const skill = skills.find((item) => item.skill_id === skillId);
    if (!skill) return sendError(res, 404, ERROR_CODES.SKILL_NOT_FOUND, "skill_not_found", requestId);
    const userId = req.headers["x-user-id"] || "user_001";
    const tenantId = req.headers["x-tenant-id"] || "tenant_001";
    const existing = purchases.find((item) => item.user_id === userId && item.skill_id === skillId);
    if (existing) {
      writeAudit(AUDIT_EVENTS.STORE_PURCHASE_DUPLICATE, requestId, { user_id: userId, skill_id: skillId });
      json(res, 200, { ...existing, status: "already_purchased" });
      return;
    }

    const purchase = {
      purchase_id: `pur_${randomUUID()}`,
      user_id: userId,
      tenant_id: tenantId,
      skill_id: skillId,
      price: skill.price,
      payment_status: "paid",
      created_at: new Date().toISOString()
    };
    purchases.push(purchase);
    entitlements.push({
      entitlement_id: `ent_${randomUUID()}`,
      user_id: userId,
      tenant_id: tenantId,
      skill_id: skillId,
      allowed_versions: ">=1.0.0 <2.0.0",
      status: "active"
    });
    writeAudit(AUDIT_EVENTS.STORE_PURCHASE_CREATED, requestId, { user_id: userId, skill_id: skillId, purchase_id: purchase.purchase_id });
    json(res, 201, purchase);
    return;
  }

  if (method === "GET" && routePath === "/store/my-purchases") {
    const userId = req.headers["x-user-id"] || "user_001";
    const rows = purchases
      .filter((item) => item.user_id === userId)
      .map((purchase) => ({ ...purchase, skill: skills.find((skill) => skill.skill_id === purchase.skill_id) || null }));
    json(res, 200, rows);
    return;
  }

  if (method === "GET" && routePath === "/store/creator/skills") {
    const userId = req.headers["x-user-id"] || "user_001";
    json(res, 200, creatorPublishedSkills.filter((item) => item.creator_user_id === userId));
    return;
  }

  if (method === "POST" && routePath === "/store/creator/skills") {
    try {
      const body = await readJson(req);
      if (!body.skill_id || !body.name || !body.version) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, "skill_id/name/version required", requestId);
      }
      const userId = req.headers["x-user-id"] || "user_001";
      const skill = normalizeSkill(
        {
          skill_id: String(body.skill_id),
          name: String(body.name),
          description: String(body.description || ""),
          category: String(body.category || "效率"),
          price: Number(body.price || 0),
          latest_version: String(body.version || "1.0.0"),
          tags: String(body.quality_metrics || "")
            .split(/[、,]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 4)
        },
        skills.length
      );
      const record = {
        ...skill,
        creator_user_id: userId,
        status: "published",
        audience: body.audience || "",
        input_schema: body.input_schema || "",
        output_schema: body.output_schema || "",
        quality_metrics: body.quality_metrics || "",
        safety: body.safety || "",
        package_file: body.package_file || null,
        created_at: new Date().toISOString()
      };
      creatorPublishedSkills.push(record);
      if (!skills.some((item) => item.skill_id === skill.skill_id)) {
        skills.push(skill);
        ensurePackage(skill, {
          package_file: body.package_file || null,
          version: body.version || "1.0.0",
          operation: `${skill.skill_id}.run`,
          host_action: "skill.run"
        });
      }
      json(res, 201, record);
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "POST" && routePath === "/store/creator/withdrawals") {
    try {
      const body = await readJson(req);
      const amount = Number(body.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendError(res, 400, ERROR_CODES.INVALID_PAYLOAD, "amount must be greater than 0", requestId);
      }
      const withdrawal = {
        withdrawal_id: `wd_${randomUUID()}`,
        user_id: req.headers["x-user-id"] || "user_001",
        amount,
        account: body.account || "demo-wallet",
        status: "payment_confirmation_required",
        payment_url: `/payments/withdrawals/demo?withdrawal_id=wd_demo`,
        created_at: new Date().toISOString()
      };
      withdrawals.push(withdrawal);
      json(res, 201, withdrawal);
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "GET" && routePath === "/skills/audit/events") {
    if (!requireInternalToken(req, res, requestId)) return;
    json(res, 200, { events: auditEvents });
    return;
  }

  if (routePath.startsWith("/skills/") && !requireInternalToken(req, res, requestId)) return;

  if (method === "GET" && routePath === "/skills/entitlements") {
    writeAudit(AUDIT_EVENTS.ENTITLEMENTS_FETCHED, requestId, { count: entitlements.length });
    json(res, 200, {
      user_id: "user_001",
      tenant_id: "tenant_001",
      entitlements: entitlements.filter((item) => item.status === "active")
    });
    return;
  }

  if (method === "POST" && routePath === "/skills/sync-plan") {
    try {
      const body = await readJson(req);
      const installedSkills = Array.isArray(body.installed_skills) ? body.installed_skills : [];
      writeAudit(AUDIT_EVENTS.SYNC_PLAN_GENERATED, requestId, { installed_count: installedSkills.length });
      json(res, 200, buildSyncPlan(installedSkills));
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "POST" && routePath === "/skills/install-token") {
    try {
      const body = await readJson(req);
      const pkg = packages.find((item) => item.package_id === body.package_id);
      if (!pkg) return sendError(res, 404, ERROR_CODES.PACKAGE_NOT_FOUND, "package_not_found", requestId);
      writeAudit(AUDIT_EVENTS.INSTALL_TOKEN_ISSUED, requestId, { package_id: pkg.package_id, skill_id: pkg.skill_id });
      json(res, 200, {
        allowed: true,
        install_token: `install_${randomUUID()}`,
        expires_in: 300,
        download_url: `/skills/packages/${pkg.package_id}/download`,
        package_hash: pkg.package_hash,
        signature: pkg.signature
      });
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "GET" && routePath.match(/^\/skills\/packages\/[^/]+\/download$/)) {
    const packageId = routePath.split("/")[3];
    const pkg = packages.find((item) => item.package_id === packageId);
    if (!pkg) return sendError(res, 404, ERROR_CODES.PACKAGE_NOT_FOUND, "package_not_found", requestId);
    if (!pkg.package_file) return sendError(res, 404, ERROR_CODES.PACKAGE_NOT_FOUND, "package_file_not_configured", requestId);
    const filePath = path.resolve("skins", "imported", pkg.package_file);
    let data;
    try {
      data = await readFile(filePath);
    } catch {
      return sendError(res, 404, ERROR_CODES.PACKAGE_NOT_FOUND, "aoskin_file_not_found", requestId);
    }
    writeAudit(AUDIT_EVENTS.INSTALL_TOKEN_ISSUED, requestId, { package_id: packageId, action: "download" });
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${pkg.package_file}"`,
      "Content-Length": String(data.length),
      "X-Package-Hash": pkg.package_hash || ""
    });
    res.end(data);
    return;
  }

  if (method === "GET" && routePath.startsWith("/skills/packages/")) {
    const packageId = routePath.split("/").pop();
    const pkg = packages.find((item) => item.package_id === packageId);
    if (!pkg) return sendError(res, 404, ERROR_CODES.PACKAGE_NOT_FOUND, "package_not_found", requestId);
    writeAudit(AUDIT_EVENTS.PACKAGE_METADATA_READ, requestId, { package_id: packageId });
    json(res, 200, {
      package_id: pkg.package_id,
      skill_id: pkg.skill_id,
      version: pkg.version,
      format: ".aoskin",
      package_hash: pkg.package_hash,
      signature: pkg.signature,
      package_file: pkg.package_file || null,
      skin_path: pkg.package_file ? path.resolve("skins", "imported", pkg.package_file) : null,
      manifest: pkg.manifest
    });
    return;
  }

  if (method === "POST" && routePath === "/skills/install-report") {
    try {
      const body = await readJson(req);
      const report = { report_id: `report_${randomUUID()}`, ...body, created_at: new Date().toISOString() };
      installReports.push(report);
      writeAudit(AUDIT_EVENTS.INSTALL_REPORT_ACCEPTED, requestId, { report_id: report.report_id, status: report.status });
      json(res, 200, { accepted: true, report_id: report.report_id });
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  sendError(res, 404, ERROR_CODES.NOT_FOUND, "not_found", requestId);
});

seedBaseSkills();
mergeImportedCatalog()
  .catch((error) => {
    log("error", "imported_catalog_load_failed", { message: error.message });
  })
  .finally(() => {
    server.listen(config.port, () => {
      log("info", "server_started", { port: config.port, env: config.env, skill_count: skills.length, package_count: packages.length });
    });
  });

function shutdown(signal) {
  log("warn", "shutdown_start", { signal });
  server.close(() => {
    log("info", "shutdown_complete");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
