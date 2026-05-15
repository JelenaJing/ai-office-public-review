import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import JSZip from "jszip";

const rootDir = path.resolve(".");
const skillsDownloadDir = process.env.SKILLS_DOWNLOAD_DIR || "D:/Projects/Codex/skin_bank/skills_download";
const manifestCsvPath = path.join(skillsDownloadDir, "manifest.csv");
const outDir = path.join(rootDir, "skins", "imported");
const catalogPath = path.join(outDir, "catalog.json");
const qualityReportPath = path.join(outDir, "quality-report.json");

const categoryRules = [
  {
    key: "continue_rewrite_assistant",
    target: 10,
    hostAction: "writing.assistant",
    price: 129,
    includeAny: [
      "continue",
      "rewrite",
      "writing assistant",
      "coauthor",
      "co-author",
      "doc coauthoring",
      "document writing",
      "article writing"
    ],
    mustAny: ["write", "writing", "rewrite", "continue", "document", "coauthor", "prose"],
    excludeAny: ["image", "video", "audio", "code", "security", "deploy", "devops"]
  },
  {
    key: "outline_topic",
    target: 10,
    hostAction: "writing.outline",
    price: 129,
    includeAny: [
      "outline",
      "topic",
      "research topic",
      "thesis topic",
      "brainstorm title",
      "paper outline"
    ],
    mustAny: ["outline", "topic", "paper", "thesis", "research"],
    excludeAny: ["image", "video", "audio", "code", "security", "deploy", "devops"]
  },
  {
    key: "paper_generation",
    target: 10,
    hostAction: "paper.generate",
    price: 169,
    includeAny: [
      "paper",
      "scientific",
      "manuscript",
      "thesis",
      "journal",
      "academic writing",
      "research writing",
      "citation"
    ],
    mustAny: ["paper", "scientific", "manuscript", "thesis", "journal", "citation"],
    excludeAny: ["image", "video", "audio", "code", "security", "deploy", "devops"]
  },
  {
    key: "experiment_plan",
    target: 10,
    hostAction: "writing.experiment_plan",
    price: 169,
    includeAny: [
      "experiment",
      "experimental design",
      "evaluation plan",
      "benchmark",
      "ab test",
      "methodology"
    ],
    mustAny: ["experiment", "evaluation", "benchmark", "methodology", "study design"],
    excludeAny: ["image", "video", "audio", "code", "security", "deploy", "devops"]
  },
  {
    key: "ppt_generation",
    target: 10,
    hostAction: "ppt.generate",
    price: 149,
    includeAny: [
      "ppt",
      "pptx",
      "powerpoint",
      "presentation",
      "slide",
      "deck"
    ],
    mustAny: ["ppt", "pptx", "powerpoint", "presentation", "slide", "deck"],
    excludeAny: ["image", "video", "audio", "code", "security", "deploy", "devops"]
  },
  {
    key: "analysis_report",
    target: 10,
    hostAction: "analysis.generate",
    price: 169,
    includeAny: [
      "analysis",
      "research",
      "market research report",
      "research report",
      "data analysis",
      "insight",
      "evaluate",
      "analysis report",
      "xlsx",
      "excel analysis"
    ],
    mustAny: ["analysis", "report", "research", "benchmark", "insight", "xlsx", "excel"],
    keywords: [
      "analysis",
      "research",
      "insight",
      "evaluate",
      "report"
    ]
  }
];

function sha(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function slug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function scoreByKeywords(text, keywords) {
  const value = String(text || "").toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (value.includes(keyword)) score += 1;
  }
  return score;
}

function inferOperation(category, skillName) {
  return `${category}_${slug(skillName) || "skill"}`;
}

async function readSkillMarkdown(localDir) {
  const candidates = ["SKILL.md", "skill.md", "README.md", "readme.md"];
  for (const fileName of candidates) {
    try {
      const content = await readFile(path.join(localDir, fileName), "utf8");
      return { fileName, content };
    } catch {
      // noop
    }
  }
  return null;
}

function toLowerBlob(entry) {
  return `${entry.name} ${entry.description} ${entry.skill_path}`.toLowerCase();
}

function sourcePriority(skillPath) {
  if (skillPath.includes(".cursor/skills")) return 3;
  if (skillPath.includes(".claude/skills")) return 2;
  if (skillPath.includes(".agents/skills")) return 1;
  return 0;
}

function scoreQuality(entry, markdownText) {
  let score = 0;
  const descLen = String(entry.description || "").trim().length;
  const mdLen = String(markdownText || "").trim().length;
  const lower = `${entry.name} ${entry.description}`.toLowerCase();

  if (descLen >= 120) score += 20;
  else if (descLen >= 60) score += 12;
  else if (descLen >= 30) score += 6;

  if (mdLen >= 2500) score += 25;
  else if (mdLen >= 1200) score += 18;
  else if (mdLen >= 500) score += 10;
  else if (mdLen >= 200) score += 4;

  if (/\b(use when|triggers|workflow|steps|output|quality|constraints?)\b/i.test(markdownText)) score += 12;
  if (/\b(example|checklist|template|best practice)\b/i.test(markdownText)) score += 8;
  if (/\b(paper|writing|report|outline|analysis|presentation|ppt)\b/i.test(lower)) score += 10;

  if (/\b(code|devops|docker|kubernetes|ci\/cd|security audit|penetration)\b/i.test(lower)) score -= 20;
  if (/\b(image|video|audio|animation|sticker|avatar)\b/i.test(lower)) score -= 20;

  score += sourcePriority(String(entry.skill_path || "")) * 3;
  return Math.max(0, Math.min(100, score));
}

function matchRule(entry, rule) {
  const blob = toLowerBlob(entry);
  const strongBlob = `${entry.name} ${entry.skill_path}`.toLowerCase();
  const hardReject = [
    "security",
    "penetration",
    "devops",
    "docker",
    "kubernetes",
    "ci/cd",
    "ci cd",
    "backend",
    "frontend",
    "api design",
    "coding",
    "programming",
    "x-api",
    "twitter",
    "video",
    "audio",
    "image",
    "sticker",
    "investor",
    "fundraising",
    "sales",
    "marketing campaign",
    "social media"
  ];
  if (hardReject.some((token) => blob.includes(token))) return false;
  if (rule.excludeAny?.some((token) => blob.includes(token))) return false;
  if (rule.mustAny?.length && !rule.mustAny.some((token) => strongBlob.includes(token))) return false;
  if (rule.includeAny?.some((token) => blob.includes(token))) {
    const officeCore = [
      "paper",
      "writing",
      "document",
      "outline",
      "topic",
      "experiment",
      "research",
      "analysis",
      "ppt",
      "presentation",
      "slide",
      "citation",
      "report",
      "excel",
      "xlsx"
    ];
    return officeCore.some((token) => blob.includes(token));
  }
  if (rule.keywords?.length) return scoreByKeywords(blob, rule.keywords) > 0;
  return false;
}

function isAllowedCandidate(entry) {
  const blob = toLowerBlob(entry);
  const blocked = [
    "issue",
    "debug",
    "threat",
    "sql",
    "database",
    "agentdb",
    "triage",
    "smoke-check",
    "localize",
    "systems thinking",
    "systemsthinking",
    "worldthreat",
    "fabric",
    "swim",
    "github issue",
    "gh-",
    "dev workflow",
    "code review",
    "testing framework"
  ];
  return !blocked.some((token) => blob.includes(token));
}

function inferSceneAndForum(ruleKey, entry) {
  const blob = toLowerBlob(entry);
  if (blob.includes("story") || blob.includes("daily life") || blob.includes("life")) {
    return { scene_category: "生活", forum_module: "forum-life" };
  }
  if (["paper_generation", "outline_topic", "experiment_plan"].includes(ruleKey)) {
    return { scene_category: "学习", forum_module: "forum-study" };
  }
  return { scene_category: "工作", forum_module: "forum-work" };
}

async function buildAoskin(entry, rule, privateKey, publicKeyPem, placementMeta) {
  const zip = new JSZip();
  const skillId = `${slug(entry.name)}_v1`;
  const operation = inferOperation(rule.key, entry.name);
  const hostAction = rule.hostAction;
  const markdown = (await readSkillMarkdown(entry.local_dir)) || { fileName: "", content: "" };
  const qualityScore = scoreQuality(entry, markdown.content);
  const scene = inferSceneAndForum(rule.key, entry);

  const manifest = {
    schema_version: "ai-office-skin-v1",
    package_type: "aoskin",
    closed_world: true,
    external_skill_calls_allowed: false,
    skill: {
      skill_id: skillId,
      name: entry.name,
      version: "1.0.0",
      category: rule.key,
      description: entry.description || ""
    },
    source: {
      github_repo: entry.github_repo,
      branch: entry.branch,
      skill_path: entry.skill_path,
      local_dir: entry.local_dir
    },
    execution: { mode: "host_action" },
    operations: [{ operation, host_action: hostAction }],
    quality: {
      score: qualityScore,
      imported_by: "import-skills-to-aoskin.mjs"
    },
    audience: {
      scene_category: scene.scene_category,
      forum_module: scene.forum_module,
      priority_tier: placementMeta.priority_tier
    }
  };

  const runtimeHint = {
    runtime: "mock",
    operation_outputs: {
      [operation]: {
        status: "completed",
        summary: `Imported from ${entry.github_repo}/${entry.skill_path}`
      }
    }
  };

  const files = {
    AOSKIN: "AI_OFFICE_SKIN_CAPSULE_V1",
    "manifest.json": JSON.stringify(manifest, null, 2),
    "runtime/skin.wasm": "placeholder",
    "runtime/mock_handler.json": JSON.stringify(runtimeHint, null, 2),
    "assets/source_meta.json": JSON.stringify(
      {
        source_url: entry.source_url,
        skill_doc_file: markdown.fileName || null
      },
      null,
      2
    ),
    "assets/skill_doc_excerpt.md": markdown.content.slice(0, 6000)
  };

  const checksums = {
    schema_version: "ai-office-checksums-v1",
    algorithm: "sha256",
    files: Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha(c) }))
  };
  files["checksums.json"] = JSON.stringify(checksums, null, 2);
  const digest = sha(files["checksums.json"]);
  const signature = sign(null, Buffer.from(digest, "utf8"), privateKey).toString("base64");
  files["signature.sig"] = JSON.stringify(
    {
      algorithm: "ed25519",
      public_key_pem: publicKeyPem,
      signature_base64: signature
    },
    null,
    2
  );

  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const packageId = `pkg_${skillId}_1_0_0`;
  const fileName = `${skillId}-1.0.0.aoskin`;
  const outPath = path.join(outDir, fileName);
  await writeFile(outPath, buffer);
  return {
    package_id: packageId,
    skill_id: skillId,
    version: "1.0.0",
    name: entry.name,
    description: entry.description || "",
    category: rule.key,
    price: rule.price,
    latest_version: "1.0.0",
    package_file: fileName,
    package_hash: `sha256:${sha(files["checksums.json"])}`,
    signature: "ed25519:generated",
    size: buffer.length,
    operation,
    host_action: hostAction,
    quality_score: qualityScore,
    scene_category: scene.scene_category,
    forum_module: scene.forum_module,
    priority_tier: placementMeta.priority_tier,
    core_rank: placementMeta.core_rank,
    is_core_selected: placementMeta.priority_tier === "core",
    source: {
      github_repo: entry.github_repo,
      branch: entry.branch,
      skill_path: entry.skill_path,
      local_dir: entry.local_dir,
      source_url: entry.source_url
    }
  };
}

async function rankForRule(rows, rule) {
  const bestByName = new Map();
  for (const row of rows) {
    if (!isAllowedCandidate(row)) continue;
    if (!matchRule(row, rule)) continue;
    const key = slug(row.name);
    const markdown = await readSkillMarkdown(row.local_dir);
    const quality = scoreQuality(row, markdown?.content || "");
    const rel = scoreByKeywords(toLowerBlob(row), rule.includeAny || rule.keywords || []);
    const finalScore = quality * 2 + rel * 5 + sourcePriority(String(row.skill_path || ""));
    const old = bestByName.get(key);
    if (!old || finalScore > old.finalScore) {
      bestByName.set(key, { ...row, finalScore, quality_score: quality });
    }
  }
  return Array.from(bestByName.values()).sort((a, b) => b.finalScore - a.finalScore);
}

async function clearImportedArtifacts() {
  const files = await readdir(outDir);
  const cleanup = files
    .filter((name) => name.endsWith(".aoskin"))
    .map((name) => unlink(path.join(outDir, name)));
  await Promise.all(cleanup);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await clearImportedArtifacts();
  const csv = await readFile(manifestCsvPath, "utf8");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const parts = parseCsvLine(line);
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = parts[idx] || "";
    });
    return obj;
  });

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const selected = [];
  const selectedNameSet = new Set();
  const report = { generated_at: new Date().toISOString(), rules: [] };
  for (const rule of categoryRules) {
    const ranked = await rankForRule(rows, rule);
    const picked = [];
    for (const row of ranked) {
      const nameKey = slug(row.name);
      if (selectedNameSet.has(nameKey)) continue;
      selected.push({ ...row, rule_key: rule.key, quality_score: row.quality_score });
      picked.push({ name: row.name, skill_path: row.skill_path, quality_score: row.quality_score });
      selectedNameSet.add(nameKey);
      if (picked.length >= rule.target) break;
    }
    report.rules.push({ rule: rule.key, host_action: rule.hostAction, selected_count: picked.length, selected: picked });
  }

  const selectedOrdered = [...selected].sort((a, b) => {
    const aScore = Number(a.finalScore || 0);
    const bScore = Number(b.finalScore || 0);
    return bScore - aScore;
  });

  const catalog = { generated_at: new Date().toISOString(), items: [] };
  for (const [index, item] of selectedOrdered.entries()) {
    const rule = categoryRules.find((oneRule) => oneRule.key === item.rule_key);
    if (!rule) continue;
    const one = await buildAoskin(
      item,
      rule,
      privateKey,
      publicKeyPem,
      {
        core_rank: index + 1,
        priority_tier: index < 50 ? "core" : "filler"
      }
    );
    catalog.items.push(one);
  }

  await writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8");
  await writeFile(qualityReportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ outDir, catalogPath, qualityReportPath, count: catalog.items.length }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
