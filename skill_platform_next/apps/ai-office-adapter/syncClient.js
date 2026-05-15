import { createHash, generateKeyPairSync, sign } from "node:crypto";

const DEFAULT_LIBRARY_BASE_URL = process.env.SKILL_LIBRARY_BASE_URL || "http://localhost:4010";
const DEFAULT_ENGINE_BASE_URL = process.env.SKILL_ENGINE_BASE_URL || "http://localhost:4020";
const INTERNAL_TOKEN = process.env.SKILL_INTERNAL_API_TOKEN || "change-this-token";

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTERNAL_TOKEN}`
    },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function fetchEntitlements() {
  const response = await fetch(`${DEFAULT_LIBRARY_BASE_URL}/skills/entitlements`, {
    headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` }
  });
  return response.json();
}

export async function createSyncPlan(installedSkills) {
  return postJson(`${DEFAULT_LIBRARY_BASE_URL}/skills/sync-plan`, {
    device_id: "device_001",
    installed_skills: installedSkills
  });
}

export async function requestInstallToken(packageId) {
  return postJson(`${DEFAULT_LIBRARY_BASE_URL}/skills/install-token`, {
    package_id: packageId,
    device_id: "device_001"
  });
}

export async function fetchPackageMeta(packageId) {
  const response = await fetch(`${DEFAULT_LIBRARY_BASE_URL}/skills/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` }
  });
  return response.json();
}

export async function installSkill(skillId, version, packageMeta) {
  const capsule = buildDemoCapsule(skillId, version, packageMeta);
  const payload = {
    skill_id: skillId,
    version
  };
  if (capsule.skin_path) payload.skin_path = capsule.skin_path;
  else payload.capsule = capsule;
  return postJson(`${DEFAULT_ENGINE_BASE_URL}/engine/install`, payload);
}

export async function runSkill(runRequest) {
  return postJson(`${DEFAULT_ENGINE_BASE_URL}/engine/run`, runRequest);
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function buildDemoCapsule(skillId, version, packageMeta) {
  if (packageMeta?.skin_path) {
    return { skin_path: packageMeta.skin_path };
  }
  const manifest = {
    schema_version: "ai-office-skin-v1",
    package_type: "aoskin",
    closed_world: true,
    external_skill_calls_allowed: false,
    skill: { skill_id: skillId, version },
    operations: [{ operation: "generate_paper", host_action: "paper.generate" }]
  };
  const files = {
    AOSKIN: "AI_OFFICE_SKIN_CAPSULE_V1",
    "manifest.json": JSON.stringify(manifest),
    "runtime/skin.wasm": "placeholder-wasm-binary-content"
  };
  const checksums = {
    algorithm: "sha256",
    files: Object.keys(files).map((path) => ({
      path,
      sha256: sha256Hex(files[path])
    }))
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

