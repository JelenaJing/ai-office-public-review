import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { AUDIT_EVENTS, ERROR_CODES, errorBody } from "../../../shared/constants.js";
import { decodeAoskinInstallPayload, runAoskinOperation } from "./aoskinRuntime.js";

const config = {
  port: Number(process.env.SKILL_ENGINE_PORT || 4020),
  env: process.env.SKILL_ENV || "development",
  token: process.env.SKILL_INTERNAL_API_TOKEN || "change-this-token"
};

if (config.env === "production" && config.token === "change-this-token") {
  throw new Error("SKILL_INTERNAL_API_TOKEN must be set in production.");
}

const installedSkills = new Map();
const runs = new Map();
const auditEvents = [];

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function log(level, message, meta = {}) {
  const payload = { ts: new Date().toISOString(), service: "skill-engine", level, message, ...meta };
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
      if (!body) {
        resolve({});
        return;
      }
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

function validateRunRequest(payload) {
  if (!payload || typeof payload !== "object") return ERROR_CODES.INVALID_PAYLOAD;
  if (payload.schema_version !== "ai-office-skill-run-v1") return ERROR_CODES.INVALID_SCHEMA_VERSION;
  if (!payload.skill_id || !payload.operation || !payload.run_id) return ERROR_CODES.MISSING_REQUIRED_FIELDS;
  if (!payload.input || !Array.isArray(payload.input.source_artifacts)) return ERROR_CODES.MISSING_SOURCE_ARTIFACTS;
  return null;
}

const server = createServer(async (req, res) => {
  const { method, url } = req;
  const path = new URL(url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  const requestId = randomUUID();
  res.setHeader("X-Request-Id", requestId);
  log("info", "request", { requestId, method, path });

  if (method === "GET" && path === "/health") {
    json(res, 200, { status: "ok", service: "skill-engine" });
    return;
  }

  if (method === "GET" && path === "/ready") {
    json(res, 200, { status: "ok", checks: { in_memory_runtime: "ok" } });
    return;
  }
  if (method === "GET" && path === "/engine/audit/events") {
    if (!requireInternalToken(req, res, requestId)) return;
    json(res, 200, { events: auditEvents });
    return;
  }

  if (path.startsWith("/engine/") && !requireInternalToken(req, res, requestId)) {
    return;
  }

  if (method === "POST" && path === "/engine/install") {
    try {
      const body = await readJson(req);
      const verifyResult = await decodeAoskinInstallPayload(body);
      if (!verifyResult.ok) {
        writeAudit(AUDIT_EVENTS.ENGINE_INSTALL_REJECTED, requestId, { code: verifyResult.code, message: verifyResult.message });
        return sendError(res, 400, verifyResult.code, verifyResult.message, requestId, verifyResult.details);
      }
      const manifest = verifyResult.manifest;
      const skillId = manifest?.skill?.skill_id;
      const version = manifest?.skill?.version;
      if (!skillId || !version) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, "skill_id/version missing", requestId);
      }
      writeAudit(AUDIT_EVENTS.ENGINE_INSTALL_VALIDATED, requestId, { skill_id: skillId, version });
      installedSkills.set(skillId, {
        skill_id: skillId,
        version,
        manifest,
        files: verifyResult.files,
        closed_world: true,
        external_skill_calls_allowed: false,
        package_hash: verifyResult.package_hash,
        installed_at: new Date().toISOString()
      });
      writeAudit(AUDIT_EVENTS.ENGINE_INSTALL_COMPLETED, requestId, { skill_id: skillId, version });
      json(res, 200, { installed: true, skill_id: skillId, version, package_hash: verifyResult.package_hash });
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "POST" && path === "/engine/run") {
    try {
      const body = await readJson(req);
      const validationError = validateRunRequest(body);
      if (validationError) {
        writeAudit(AUDIT_EVENTS.ENGINE_RUN_REJECTED, requestId, { code: validationError });
        sendError(res, 400, validationError, "run request invalid", requestId);
        return;
      }

      const installed = installedSkills.get(body.skill_id);
      if (!installed) {
        writeAudit(AUDIT_EVENTS.ENGINE_RUN_REJECTED, requestId, { code: ERROR_CODES.SKILL_NOT_INSTALLED, skill_id: body.skill_id });
        sendError(res, 404, ERROR_CODES.SKILL_NOT_INSTALLED, "skill_not_installed", requestId);
        return;
      }

      writeAudit(AUDIT_EVENTS.ENGINE_RUN_STARTED, requestId, { run_id: body.run_id, skill_id: body.skill_id });
      const runtimeResult = await runAoskinOperation(installed, body);
      if (!runtimeResult.ok) {
        writeAudit(AUDIT_EVENTS.ENGINE_RUN_REJECTED, requestId, { code: runtimeResult.code, message: runtimeResult.message });
        sendError(res, 400, runtimeResult.code, runtimeResult.message, requestId);
        return;
      }
      const artifactPackage = runtimeResult.artifactPackage;
      runs.set(body.run_id, {
        run_id: body.run_id,
        skill_id: body.skill_id,
        status: "completed",
        host_action: runtimeResult.hostAction,
        result: artifactPackage,
        updated_at: new Date().toISOString()
      });

      writeAudit(AUDIT_EVENTS.ENGINE_RUN_COMPLETED, requestId, { run_id: body.run_id, skill_id: body.skill_id });
      json(res, 200, artifactPackage);
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  if (method === "GET" && path.startsWith("/engine/runs/")) {
    const runId = path.split("/").pop();
    const run = runs.get(runId);
    if (!run) {
      sendError(res, 404, ERROR_CODES.RUN_NOT_FOUND, "run_not_found", requestId);
      return;
    }
    json(res, 200, run);
    return;
  }

  if (method === "POST" && path === "/engine/uninstall") {
    try {
      const body = await readJson(req);
      if (!body.skill_id) {
        sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, "missing skill_id", requestId);
        return;
      }
      installedSkills.delete(body.skill_id);
      writeAudit(AUDIT_EVENTS.ENGINE_UNINSTALL_COMPLETED, requestId, { skill_id: body.skill_id });
      json(res, 200, { uninstalled: true, skill_id: body.skill_id });
    } catch {
      sendError(res, 400, ERROR_CODES.INVALID_JSON, "invalid_json", requestId);
    }
    return;
  }

  sendError(res, 404, ERROR_CODES.NOT_FOUND, "not_found", requestId);
});

server.listen(config.port, () => {
  log("info", "server_started", { port: config.port, env: config.env });
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

