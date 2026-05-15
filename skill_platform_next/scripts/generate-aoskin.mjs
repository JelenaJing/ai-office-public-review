import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import JSZip from "jszip";

const outputDir = path.resolve("skins");

const defs = [
  ["paper_writer_v1", "论文写作", "generate_paper", "paper.generate", "writing"],
  ["ppt_generator_v1", "PPT 生成", "generate_pptx", "ppt.generate", "presentation"],
  ["continue_writer_v1", "续写", "continue_writing", "writing.continue", "writing"],
  ["rewrite_writer_v1", "重写", "rewrite_paragraph", "writing.rewrite", "writing"],
  ["writing_assistant_v1", "写作助手", "writing_assistant", "writing.assistant", "writing"],
  ["outline_generator_v1", "提纲生成", "generate_outline", "writing.outline", "writing"],
  ["topic_analyzer_v1", "选题分析", "analyze_topic", "writing.topic", "analysis"],
  ["experiment_plan_v1", "实验方案", "generate_experiment_plan", "writing.experiment_plan", "analysis"]
];

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function makeOne([skillId, name, operation, hostAction, category]) {
  const zip = new JSZip();
  const manifest = {
    schema_version: "ai-office-skin-v1",
    package_type: "aoskin",
    skill: { skill_id: skillId, name, version: "1.0.0", category },
    execution: { mode: "host_action" },
    operations: [{ operation, host_action: hostAction }],
    closed_world: true,
    external_skill_calls_allowed: false
  };
  const files = {
    AOSKIN: "AI_OFFICE_SKIN_CAPSULE_V1",
    "manifest.json": JSON.stringify(manifest, null, 2),
    "runtime/skin.wasm": "placeholder"
  };
  const checksums = {
    schema_version: "ai-office-checksums-v1",
    algorithm: "sha256",
    files: Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha(c) }))
  };
  files["checksums.json"] = JSON.stringify(checksums, null, 2);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const digest = sha(files["checksums.json"]);
  const sig = sign(null, Buffer.from(digest, "utf8"), privateKey).toString("base64");
  files["signature.sig"] = JSON.stringify({
    algorithm: "ed25519",
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    signature_base64: sig
  }, null, 2);
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const target = path.join(outputDir, `${skillId}-1.0.0.aoskin`);
  await writeFile(target, buffer);
  return target;
}

await mkdir(outputDir, { recursive: true });
const generated = [];
for (const def of defs) generated.push(await makeOne(def));
console.log(JSON.stringify({ outputDir, generated }, null, 2));

