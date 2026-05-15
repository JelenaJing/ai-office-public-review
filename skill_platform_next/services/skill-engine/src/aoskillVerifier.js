import { createHash, createPublicKey, verify } from "node:crypto";
import { ERROR_CODES } from "../../../shared/constants.js";

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function verifyRequiredFiles(files) {
  const required = ["AOSKILL", "manifest.json", "checksums.json", "signature.sig"];
  for (const path of required) {
    if (!(path in files)) {
      return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FILE, message: `missing file: ${path}` };
    }
  }
  if (files["AOSKILL"].trim() !== "AI_OFFICE_SKILL_CAPSULE_V1") {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "invalid AOSKILL marker" };
  }
  return { ok: true };
}

function verifyManifest(manifestText) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_MANIFEST, message: "manifest is not valid json" };
  }
  if (manifest.closed_world !== true) {
    return { ok: false, code: ERROR_CODES.CLOSED_WORLD_REQUIRED, message: "closed_world must be true" };
  }
  if (manifest.external_skill_calls_allowed !== false) {
    return {
      ok: false,
      code: ERROR_CODES.EXTERNAL_CALLS_FORBIDDEN,
      message: "external_skill_calls_allowed must be false"
    };
  }
  return { ok: true, manifest };
}

function verifyChecksums(files, checksumsText) {
  let checksums;
  try {
    checksums = JSON.parse(checksumsText);
  } catch {
    return { ok: false, code: ERROR_CODES.CHECKSUM_MISMATCH, message: "checksums json invalid" };
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
      return { ok: false, code: ERROR_CODES.MISSING_REQUIRED_FILE, message: `checksums target missing: ${item.path}` };
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
  return { ok: true, checksums };
}

function verifySignature(checksumsText, signatureText) {
  let signature;
  try {
    signature = JSON.parse(signatureText);
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature json invalid" };
  }
  if (signature.algorithm !== "ed25519") {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "only ed25519 is supported" };
  }
  try {
    const publicKey = createPublicKey(signature.public_key_pem);
    const signatureBuf = Buffer.from(signature.signature_base64, "base64");
    const digest = createHash("sha256").update(checksumsText, "utf8").digest("hex");
    const ok = verify(null, Buffer.from(digest, "utf8"), publicKey, signatureBuf);
    if (!ok) {
      return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature verify failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_SIGNATURE, message: "signature verify exception" };
  }
}

export function verifyAoskillCapsule(capsule) {
  if (!capsule || typeof capsule !== "object" || typeof capsule.files !== "object") {
    return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD, message: "capsule.files is required" };
  }
  const files = capsule.files;
  const required = verifyRequiredFiles(files);
  if (!required.ok) return required;

  const manifestResult = verifyManifest(files["manifest.json"]);
  if (!manifestResult.ok) return manifestResult;

  const checksumsResult = verifyChecksums(files, files["checksums.json"]);
  if (!checksumsResult.ok) return checksumsResult;

  const signatureResult = verifySignature(files["checksums.json"], files["signature.sig"]);
  if (!signatureResult.ok) return signatureResult;

  return {
    ok: true,
    manifest: manifestResult.manifest,
    package_hash: `sha256:${sha256Hex(files["checksums.json"])}`
  };
}

