import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const config = {
  port: Number(argValue("--port") || process.env.SKILL_STORE_PORT || 4030),
  libraryBaseUrl: argValue("--library-base-url") || process.env.SKILL_LIBRARY_BASE_URL || "http://localhost:4010",
  accountCenterUrl: process.env.ACCOUNT_CENTER_URL || "http://10.20.5.61:13100",
  internalToken: process.env.SKILL_INTERNAL_API_TOKEN || "change-this-token"
};

const publicDir = join(process.cwd(), "apps", "skill-store-web", "public");
const demoUsers = new Map([
  [
    "demo@ai-office.local",
    {
      id: "user_001",
      username: "demo@ai-office.local",
      displayName: "演示用户",
      departmentId: "tenant_001",
      role: "creator"
    }
  ]
]);

function getContentType(filePath) {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf-8");
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseDemoToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer demo-token-")) return null;
  return demoUsers.get("demo@ai-office.local") || null;
}

async function tryAccountCenter(path, method = "GET", token = "", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${config.accountCenterUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: token } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.text();
    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function proxyToLibrary(req, res, path, method = "GET", body = null) {
  const incomingUserId = req.headers["x-user-id"] || parseDemoToken(req)?.id || "user_001";
  const incomingTenantId = req.headers["x-tenant-id"] || parseDemoToken(req)?.departmentId || "tenant_001";
  const response = await fetch(`${config.libraryBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(incomingUserId),
      "X-Tenant-Id": String(incomingTenantId)
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseText = await response.text();
  res.writeHead(response.status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(responseText);
}

async function serveStatic(res, routePath) {
  const staticPath = routePath === "/" ? "/index.html" : routePath;
  const directFilePath = normalize(join(publicDir, staticPath));
  const safePath = directFilePath.startsWith(publicDir) ? directFilePath : join(publicDir, "index.html");
  try {
    const content = await readFile(safePath);
    res.writeHead(200, { "Content-Type": getContentType(safePath) });
    res.end(content);
  } catch {
    const fallback = join(publicDir, "index.html");
    const content = await readFile(fallback);
    res.writeHead(200, { "Content-Type": getContentType(fallback) });
    res.end(content);
  }
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routePath = url.pathname;

  try {
    if (method === "GET" && routePath === "/health") {
      json(res, 200, { status: "ok", service: "skill-store-web" });
      return;
    }

    if (method === "POST" && routePath === "/api/auth/login") {
      const body = await readJson(req);
      try {
        const remote = await tryAccountCenter("/api/auth/login", "POST", "", body);
        if (remote.status >= 200 && remote.status < 300) {
          res.writeHead(remote.status, { "Content-Type": "application/json; charset=utf-8" });
          res.end(remote.payload);
          return;
        }
      } catch {
        // Demo mode keeps the local store usable when the account center is unavailable.
      }
      const user = demoUsers.get(String(body.username || body.identifier || "demo@ai-office.local")) || demoUsers.get("demo@ai-office.local");
      json(res, 200, { token: `demo-token-${Date.now()}`, user, demo: true });
      return;
    }

    if (method === "GET" && routePath === "/api/auth/me") {
      const user = parseDemoToken(req);
      if (user) {
        json(res, 200, user);
        return;
      }
      try {
        const remote = await tryAccountCenter("/api/auth/me", "GET", req.headers.authorization || "");
        res.writeHead(remote.status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(remote.payload);
      } catch {
        json(res, 200, demoUsers.get("demo@ai-office.local"));
      }
      return;
    }

    if (method === "POST" && routePath === "/api/auth/logout") {
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && routePath === "/api/store/session") {
      const user = parseDemoToken(req);
      json(res, 200, {
        user_id: String(req.headers["x-user-id"] || user?.id || "user_001"),
        tenant_id: String(req.headers["x-tenant-id"] || user?.departmentId || "tenant_001")
      });
      return;
    }

    if (method === "GET" && routePath === "/api/docs") {
      json(res, 200, {
        service: "skill-store-web",
        version: "v1",
        remote_access: true,
        gateway_base: "/api",
        endpoints: [
          { method: "GET", path: "/api/store/skills", description: "获取技能列表（含工作/学习/生活分类、论坛模块、优先级）" },
          { method: "GET", path: "/api/store/skills/{skillId}", description: "获取技能详情" },
          { method: "POST", path: "/api/store/skills/{skillId}/purchase", description: "购买技能" },
          { method: "GET", path: "/api/store/my-purchases", description: "获取我的购买记录" },
          { method: "GET", path: "/api/creator/skills", description: "获取创作者技能列表" },
          { method: "POST", path: "/api/creator/skills", description: "发布技能" },
          { method: "POST", path: "/api/creator/withdrawals", description: "提交提现请求" }
        ]
      });
      return;
    }

    if (method === "GET" && routePath === "/api/store/skills") {
      await proxyToLibrary(req, res, "/store/skills");
      return;
    }

    if (method === "GET" && routePath.match(/^\/api\/store\/skills\/[^/]+\/aoskin$/)) {
      const user = parseDemoToken(req);
      if (!user) { json(res, 401, { error: "unauthorized", message: "请先登录" }); return; }
      const skillId = routePath.split("/")[4];
      try {
        const skillRes = await fetch(`${config.libraryBaseUrl}/store/skills/${skillId}`, {
          headers: { "X-User-Id": user.id, "X-Tenant-Id": user.departmentId || "tenant_001" }
        });
        if (!skillRes.ok) { json(res, 404, { error: "skill_not_found" }); return; }
        const skill = await skillRes.json();
        const version = skill.latest_version || "1.0.0";
        const packageId = `pkg_${skillId}_${version.replace(/\./g, "_")}`;
        const filePath = resolve(process.cwd(), "skins", "imported");
        const pkgRes = await fetch(`${config.libraryBaseUrl}/skills/packages/${packageId}`, {
          headers: { "Authorization": `Bearer ${config.internalToken}`, "X-User-Id": user.id }
        });
        if (!pkgRes.ok) { json(res, 404, { error: "package_not_found" }); return; }
        const pkg = await pkgRes.json();
        if (!pkg.package_file) {
          json(res, 404, { error: "aoskin_file_not_configured", message: "此 Skill 包文件暂不可用" });
          return;
        }
        const aoskinPath = resolve(filePath, pkg.package_file);
        let data;
        try {
          data = await readFile(aoskinPath);
        } catch {
          json(res, 404, { error: "aoskin_file_missing", message: "Skill 包文件在服务器上不存在" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${pkg.package_file}"`,
          "Content-Length": String(data.length),
          "X-Package-Hash": pkg.package_hash || ""
        });
        res.end(data);
      } catch (err) {
        json(res, 500, { error: "download_failed", message: err.message });
      }
      return;
    }

    if (method === "GET" && routePath.startsWith("/api/store/skills/")) {
      const skillId = routePath.split("/").pop();
      await proxyToLibrary(req, res, `/store/skills/${skillId}`);
      return;
    }

    if (method === "POST" && routePath.match(/^\/api\/store\/skills\/[^/]+\/purchase$/)) {
      const skillId = routePath.split("/")[4];
      await proxyToLibrary(req, res, `/store/skills/${skillId}/purchase`, "POST");
      return;
    }

    if (method === "GET" && routePath === "/api/store/my-purchases") {
      await proxyToLibrary(req, res, "/store/my-purchases");
      return;
    }

    if (method === "GET" && routePath === "/api/creator/skills") {
      await proxyToLibrary(req, res, "/store/creator/skills");
      return;
    }

    if (method === "POST" && routePath === "/api/creator/skills") {
      const body = await readJson(req);
      await proxyToLibrary(req, res, "/store/creator/skills", "POST", body);
      return;
    }

    if (method === "POST" && routePath === "/api/creator/withdrawals") {
      const body = await readJson(req);
      await proxyToLibrary(req, res, "/store/creator/withdrawals", "POST", body);
      return;
    }

    if (method === "GET" && routePath === "/embed") {
      const tokenParam = url.searchParams.get("token") || "";
      const dest = tokenParam ? `/?token=${encodeURIComponent(tokenParam)}` : "/";
      res.writeHead(302, { "Location": dest });
      res.end();
      return;
    }

    await serveStatic(res, routePath);
  } catch (error) {
    json(res, 502, { error: "store_unavailable", message: error.message });
  }
});

server.listen(config.port, () => {
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      service: "skill-store-web",
      level: "info",
      message: "server_started",
      port: config.port
    })}\n`
  );
});
