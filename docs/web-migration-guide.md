# AI Writer 3.0 — 网页版迁移说明

> 目标：将现有 Electron 桌面应用部署到服务器，用户通过浏览器访问域名即可使用。本地版保持不变，不做任何修改。

---

## 一、整体架构变化

### 现在（本地版）

```
Electron 桌面程序
  ├── Renderer 进程（React UI）
  │     └── window.electronAPI.*  ← 通过 contextBridge 调用
  └── Main 进程（Node.js）
        ├── IPC handlers（100+）
        ├── 本地文件系统（fs）存储所有数据
        └── 直接调用 AI API
```

### 目标（服务器版）

```
用户浏览器
  └── React UI（静态文件，由 Nginx 托管）
        └── HTTP fetch / SSE  ←→  Express 后端服务器（Node.js）
                                        ├── 文件系统存储（服务器磁盘）
                                        └── 调用 AI API
```

---

## 二、前端需要做的改动

### 2.1 构建成纯网页（改 vite.config.ts）

当前 `vite.config.ts` 使用了 `vite-plugin-electron`，这个插件专门给 Electron 用，部署到服务器时必须去掉。

**改法：** 新建一个 `vite.web.config.ts`，内容与现有 `vite.config.ts` 完全一样，只去掉 `electron(...)` 插件部分：

```ts
// vite.web.config.ts
plugins: [
  react(),
  // 不加 electron(...)
]
```

在 `package.json` 加两条脚本：
```json
"dev:web":   "vite --config vite.web.config.ts",
"build:web": "vite build --config vite.web.config.ts"
```

运行 `npm run build:web` 后，`dist/` 目录就是可以直接部署到 Nginx 的静态网页文件。

---

### 2.2 替换所有 window.electronAPI.* 调用

这是前端改动量最大的地方。项目里所有调用 `window.electronAPI.xxx()` 的地方，都需要改成调用你自己写的后端 HTTP 接口。

**建议方式：** 新建一个 `src/services/api.ts`，把所有 `window.electronAPI.*` 包一层，改成 `fetch('/api/...')`，然后把项目里的调用点改为调用 `api.ts` 里的函数。

这样改完后本地版（Electron）也可以让 `window.electronAPI` 继续工作——只需要让 `api.ts` 在 Electron 环境下转发给 `window.electronAPI`，在网页环境下走 HTTP。

**判断当前运行环境：**
```ts
const isElectron = typeof window !== 'undefined' && !!window.electronAPI
```

**需要替换的调用分类（按 electron.d.ts 整理）：**

| 分类 | electronAPI 方法前缀 | 对应后端接口 |
|------|---------------------|-------------|
| 设置 | `getSettings` / `saveSettings` | `GET/POST /api/settings` |
| 工作区 | `listWorkspaces` / `createWorkspace` / `getWorkspaceTree` 等 | `GET/POST /api/workspaces` |
| 文档 | `readWorkspaceDocumentSchema` / `saveWorkspaceDocumentSchema` | `GET/PUT /api/workspaces/:id/document` |
| 知识库 | `listKnowledgeDocuments` / `importKnowledgeDocuments` 等 | `GET/POST /api/knowledge` |
| 部门 | `listDepartments` / `createDepartment` 等 | `GET/POST /api/departments` |
| AI 写作 | `continueWriting` / `rewriteParagraph` / `generatePaper` 等 | `POST /api/ai/write`（SSE 流式） |
| 图像生成 | `generateImage` | `POST /api/ai/image` |
| 文件操作 | `openFileDialog` / `readFile` / `saveFileDialog` | 改用浏览器 `<input type="file">` 和下载链接 |
| 图片存储 | `saveImageToWorkspace` / `readImageAsDataUrl` | `POST /api/workspaces/:id/images`，用 URL 访问 |
| 邮件 | `emailFetchInbox` / `emailSend` 等 | `GET/POST /api/email` |
| PPTX | `generatePptx` | `POST /api/pptx` |
| 个人库 | `personalLibraryAPI.*` | `GET/POST /api/personal-library` |
| OOXML | `readOoxmlPackage` / `writeOoxmlPackage` | `POST /api/document/ooxml` |
| PDF 导出 | `exportPdfFromEditor` | `POST /api/document/export-pdf` |
| 语音 | `voiceStart` / `voiceSend` 等 | 改用浏览器 Web Speech API |

---

### 2.3 文件对话框的替代方案

Electron 的 `dialog.showOpenDialog` / `dialog.showSaveDialog` 在浏览器里无法使用，需要替换：

| 原来 | 网页替代 |
|------|---------|
| `openFileDialog()` 选择要导入的文件 | `<input type="file">` 组件，获取 `File` 对象后上传到后端 |
| `saveFileDialog()` 选择保存路径 | 后端生成文件，前端用 `<a href="..." download>` 触发浏览器下载 |
| `importFilesToWorkspace()` | `<input type="file" multiple>` + `POST /api/workspaces/:id/import` |

---

### 2.4 图片 URL 处理

本地版图片存在本地磁盘，用 `file://` 路径访问。服务器版需要改成 HTTP URL：

- 原来：`file:///path/to/workspace/images/xxx.png`
- 改为：`/api/workspaces/:id/files/images/xxx.png`

后端提供一个静态文件服务接口，把工作区文件夹里的图片以 HTTP URL 暴露出来。

---

### 2.5 AI 流式输出（SSE 替代 IPC 事件）

本地版用 Electron IPC 事件推送 AI 流式输出：
```ts
window.electronAPI.onAiEvent((payload) => { ... })
```

服务器版改用 **SSE（Server-Sent Events）**：
```ts
const es = new EventSource('/api/ai/stream?taskId=xxx')
es.onmessage = (e) => { /* 接收流式内容 */ }
```

或者用 `fetch` + `ReadableStream` 读取流式响应，效果相同。

---

## 三、后端需要做的事情

### 3.1 服务器入口

新建 `server/index.ts`，用 **Express** 启动一个 HTTP 服务器，监听某个端口（比如 3000）。

### 3.2 复用现有 Service 文件（重点！）

`electron/main/services/` 里大部分文件**只依赖 Node.js 标准模块**，不依赖 Electron，可以直接在 Express 服务器里 `import` 使用：

| 文件 | 服务器端能否直接复用 | 备注 |
|------|---------------------|------|
| `workspaceService.ts` | ✅ 直接复用 | 改传入数据目录路径 |
| `knowledgeService.ts` | ✅ 直接复用 | 改传入数据目录路径 |
| `departmentService.ts` | ✅ 直接复用 | |
| `settingsStore.ts` | ✅ 直接复用 | 改传入数据目录路径 |
| `llmClient.ts` | ✅ 直接复用 | |
| `imageClient.ts` | ✅ 直接复用 | |
| `paperGenerator.ts` | ✅ 直接复用 | |
| `documentEngineService.ts` | ✅ 直接复用 | |
| `emailService.ts` | ✅ 直接复用 | |
| `personalLibraryService.ts` | ✅ 直接复用 | |
| `pptxGenerator.ts` | ✅ 直接复用 | |
| `plotAgentService.ts` | ⚠️ 依赖外部 Python 进程 | 需要服务器上部署 Python 环境 |
| `voskModelService.ts` | ❌ Electron 专用 | 改用 Web Speech API |
| `voiceProxyService.ts` | ❌ Electron 专用 | 改用 Web Speech API |
| `pdfExporter.ts` | ⚠️ 部分依赖 Electron | 需要改造 |

**最关键的改动**：这些 Service 里用到了 `app.getPath('userData')` 来获取数据存储路径。服务器版需要把这个路径改成读取**环境变量**，例如 `process.env.DATA_DIR` 或直接写死一个服务器目录（如 `/app/data`）。

### 3.3 路由结构

Express 服务器大约需要这些路由文件：

```
server/
  index.ts              ← 启动入口，挂载所有路由
  middleware/
    auth.ts             ← JWT 鉴权（可选，单用户可跳过）
  routes/
    settings.ts         ← 复用 SettingsStore
    workspaces.ts       ← 复用 WorkspaceService
    knowledge.ts        ← 复用 KnowledgeService / DepartmentService
    ai.ts               ← 复用 llmClient / paperGenerator（SSE 流式）
    image.ts            ← 复用 imageClient
    document.ts         ← 复用 documentEngineService（OOXML/PDF）
    email.ts            ← 复用 emailService
    files.ts            ← 静态文件服务（工作区图片等）
    personal-library.ts ← 复用 personalLibraryService
    pptx.ts             ← 复用 pptxGenerator
```

### 3.4 路径替换（核心改动）

所有 Service 里的 `app.getPath('userData')` 要替换掉。改法：

```ts
// 原来（Electron 里）
const knowledgeRootPath = path.join(app.getPath('userData'), 'knowledge-base')

// 服务器版
const knowledgeRootPath = path.join(process.env.DATA_DIR ?? '/app/data', 'knowledge-base')
```

统一在 `server/appPaths.ts` 封装这个函数，所有 Service 初始化时传入正确路径。

### 3.5 TypeScript 编译

服务器端代码需要单独编译，新建 `tsconfig.server.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "outDir": "dist-server",
    "target": "ES2022"
  },
  "include": ["server/**/*", "electron/main/services/**/*", "src/document/**/*", "src/shared/**/*"]
}
```

在 `package.json` 加脚本：
```json
"build:server": "tsc -p tsconfig.server.json",
"start:server": "node dist-server/server/index.js"
```

---

## 四、数据存储

### 4.1 文件系统（推荐，最简单）

直接用**服务器本地磁盘**存数据，结构和本地版完全一样：

```
/app/data/                     ← DATA_DIR 环境变量指向这里
  workspaces/
    workspace-xxx/
      document.json
      images/
      documents/
  knowledge-base/
    dept-xxx/
      ...
  personal-library/
  generated-images/
  settings.json
```

优点：
- 和本地版数据格式完全兼容，甚至可以直接把本地数据目录打包上传
- 不需要数据库，改动量最小
- Service 代码几乎不用改，只换路径

缺点：
- 单台服务器，多用户需要手动建目录隔离
- 文件不会自动备份

### 4.2 多用户隔离（需要的话）

如果要支持多用户，最简单的做法是在路径里加用户 ID：

```
/app/data/users/
  user-alice/
    workspaces/
    knowledge-base/
  user-bob/
    workspaces/
    knowledge-base/
```

每个 HTTP 请求鉴权后，根据 userId 找到对应的数据目录。

---

## 五、部署结构

```
服务器
  ├── Nginx
  │     ├── /           → 静态文件（dist/ 目录，Vite 构建结果）
  │     └── /api/       → 反向代理到 Node.js :3000
  │
  ├── Node.js 进程（用 PM2 或 systemd 管理）
  │     └── server/index.ts 编译后运行
  │
  └── /app/data/        ← 数据目录（挂载持久化磁盘）
```

### Nginx 核心配置

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    # 静态前端文件
    root /app/dist;
    index index.html;

    # 前端路由（React SPA）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # SSE 流式输出必须加这几行
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }
}
```

### 环境变量（.env 或服务器环境变量）

```bash
DATA_DIR=/app/data
PORT=3000
JWT_SECRET=换成随机字符串
AUTH_DISABLED=true          # 单用户内网部署可设为 true，跳过登录

# AI API Keys（沿用现有的）
AI_WRITER_DEFAULT_QWEN_API_KEY=xxx
AI_WRITER_DEFAULT_DEEPSEEK_API_KEY=xxx
```

---

## 六、迁移步骤（推荐顺序）

### Step 1：先把前端跑起来（1-2天）

1. 新建 `vite.web.config.ts`，去掉 electron 插件
2. 运行 `npm run build:web`，确认 `dist/` 能生成
3. 用 Nginx 托管 `dist/`，访问域名能看到界面（此时 API 都 404，只是看界面）

### Step 2：搭 Express 骨架（1天）

1. 新建 `server/index.ts`，启动 Express，加一个 `GET /api/health` 返回 `{ok:true}`
2. 配置 Nginx `/api/` 反向代理到 Node.js
3. 前端能访问到 `/api/health`

### Step 3：接通核心功能（逐个做，每个1-2天）

按以下顺序接通，每接一个就能在浏览器里用这个功能：

1. **设置接口** — `GET/POST /api/settings`（复用 `settingsStore.ts`）
2. **工作区接口** — `GET/POST /api/workspaces`（复用 `workspaceService.ts`）
3. **文档读写** — `GET/PUT /api/workspaces/:id/document`
4. **知识库** — `GET/POST /api/knowledge`（复用 `knowledgeService.ts`）
5. **AI 写作流式接口** — `POST /api/ai/write`，SSE 推流（复用 `llmClient.ts`）
6. **图像生成** — `POST /api/ai/image`
7. **文件上传/下载** — `POST /api/workspaces/:id/import`，`GET /api/files/:path`
8. **邮件** — `GET/POST /api/email`（复用 `emailService.ts`）
9. **PPTX/PDF 导出** — `POST /api/document/export`

### Step 4：改前端调用（和 Step 3 同步进行）

每接通一个后端接口，同步修改前端对应的 `window.electronAPI.xxx()` 调用，改成 `fetch('/api/...')`。

---

## 七、需要特别注意的地方

### AI 流式输出

现有代码里 AI 流式输出是通过 Electron IPC 事件（`onAiEvent`）推到前端的。服务器版需要改成 **SSE（EventSource）** 或 **fetch ReadableStream**。

后端 SSE 写法：
```ts
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
// 每次有内容就 write
res.write(`data: ${JSON.stringify({ type: 'chunk', content: '...' })}\n\n`)
// 完成
res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
res.end()
```

前端接收：
```ts
const es = new EventSource('/api/ai/write?taskId=xxx')
es.onmessage = (e) => {
  const data = JSON.parse(e.data)
  if (data.type === 'chunk') appendText(data.content)
  if (data.type === 'done') es.close()
}
```

### OOXML / DOCX 导入

现有的 `documentEngineService.ts` 里处理 DOCX 需要读写本地文件路径。服务器版需要：
1. 用户上传 DOCX 文件（multipart/form-data）
2. 后端先把文件写到临时目录
3. 再调用 `documentEngineService` 处理
4. 处理完删临时文件

### PDF 导出

`pdfExporter.ts` 里可能用到了 Electron 的 `webContents.printToPDF()`，这个在服务器端不能用。  
替代方案：用 `puppeteer`（无头 Chrome）在服务器端生成 PDF。

### 语音输入

Vosk 本地识别方案在服务器端无意义（用户的麦克风在浏览器里，不在服务器）。  
替代方案：直接用浏览器原生的 **Web Speech API**：
```ts
const recognition = new window.SpeechRecognition()
recognition.onresult = (e) => console.log(e.results[0][0].transcript)
recognition.start()
```

### 工作区文件里的图片 URL

本地版文档里图片 src 存的是 `file:///绝对路径`，在浏览器里无法访问。  
需要后端提供一个静态文件接口（如 `GET /api/files?path=workspaces/xxx/images/yyy.png`），并在导入/保存文档时把图片 src 转换为这个 HTTP URL。

---

## 八、不需要改的内容 ✅

以下内容完全不用动，直接可以在网页版里运行：

- 所有 React 组件（TipTap 编辑器、UI 面板等）
- `src/document/` 文档逻辑
- `src/shared/ai/providerCatalog.ts` AI 提供商配置
- `src/utils/` 工具函数
- `src/contexts/` 所有 Context（状态管理层）
- 样式（Styled Components）
- 国际化（i18n）
- `electron/main/services/` 里的绝大多数文件（搬到后端继续用）
- **Electron 本地版的所有代码（完全不动）**
