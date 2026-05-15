import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

const env = {
  ...process.env,
  SKILL_INTERNAL_API_TOKEN: process.env.SKILL_INTERNAL_API_TOKEN || "change-this-token"
};

function start(command, args) {
  const child = spawn(command, args, { env, stdio: "pipe" });
  child.stdout.on("data", (buf) => process.stdout.write(buf));
  child.stderr.on("data", (buf) => process.stderr.write(buf));
  return child;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const library = start("node", ["services/skill-library-backend/src/server.js"]);
  const engine = start("node", ["services/skill-engine/src/server.js"]);
  await wait(1200);

  const headers = { Authorization: `Bearer ${env.SKILL_INTERNAL_API_TOKEN}`, "Content-Type": "application/json" };
  const entRes = await fetch("http://localhost:4010/skills/entitlements", { headers });
  if (!entRes.ok) throw new Error("entitlements check failed");

  const installRes = await fetch("http://localhost:4020/engine/install", {
    method: "POST",
    headers,
    body: JSON.stringify({
      skin_path: "D:/Projects/Codex/ai_writer3.0/skill_platform_next/skins/paper_writer_v1-1.0.0.aoskin"
    })
  });
  if (!installRes.ok) throw new Error("engine install check failed");

  const runRes = await fetch("http://localhost:4020/engine/run", {
    method: "POST",
    headers,
    body: JSON.stringify({
      schema_version: "ai-office-skill-run-v1",
      run_id: "run_smoke_001",
      skill_id: "paper_writer_v1",
      operation: "generate_paper",
      workspace_id: "workspace_001",
      input: { source_artifacts: [{ artifact_id: "artifact_doc_001" }] }
    })
  });
  if (!runRes.ok) throw new Error("engine run check failed");

  process.stdout.write("[smoke] all checks passed\n");
  library.kill();
  engine.kill();
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function buildDemoCapsule(skillId, version) {
  const manifest = {
    schema_version: "ai-office-skill-v1",
    closed_world: true,
    external_skill_calls_allowed: false,
    skill: { skill_id: skillId, version }
  };
  const files = {
    AOSKILL: "AI_OFFICE_SKILL_CAPSULE_V1",
    "manifest.json": JSON.stringify(manifest),
    "runtime/skill.wasm": "placeholder-wasm-binary-content"
  };
  const checksums = {
    algorithm: "sha256",
    files: Object.keys(files).map((path) => ({ path, sha256: sha256Hex(files[path]) }))
  };
  files["checksums.json"] = JSON.stringify(checksums);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const digest = sha256Hex(files["checksums.json"]);
  const signatureBuf = sign(null, Buffer.from(digest, "utf8"), privateKey);
  files["signature.sig"] = JSON.stringify({
    algorithm: "ed25519",
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    signature_base64: signatureBuf.toString("base64")
  });
  return { files };
}

main().catch((error) => {
  process.stderr.write(`[smoke] failed: ${error.stack || error.message}\n`);
  process.exit(1);
});

