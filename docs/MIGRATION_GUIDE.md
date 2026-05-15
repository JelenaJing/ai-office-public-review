# AI Writer 3.0 — 迁移说明

> 适用版本：`3.0.0-alpha.1`  
> 适用场景：将本项目源码迁移至新机器或新开发环境并完成开发/打包配置。

---

## 目录

1. [环境要求](#1-环境要求)
2. [获取源码](#2-获取源码)
3. [安装依赖](#3-安装依赖)
4. [配置 AI 接口密钥](#4-配置-ai-接口密钥)
5. [启动开发服务器](#5-启动开发服务器)
6. [打包 Windows 安装包](#6-打包-windows-安装包)
7. [目录结构说明](#7-目录结构说明)
8. [常见问题](#8-常见问题)

---

## 1. 环境要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 18.x LTS | 建议使用 20.x LTS |
| npm | 9.x | 随 Node.js 一同安装 |
| Git | 2.x | 可选，仅用于版本管理 |
| Windows OS | Windows 10 64-bit | 目标打包平台 |
| Python | 3.x | 仅在需要运行 `build/` 中 `.py` 辅助脚本时需要 |

> **注意**：项目使用 Electron 28，请确保 Node.js 版本与其 ABI 兼容（Node 18 / 20 均可）。

---

## 2. 获取源码

### 方式一：从压缩包解压

```
ai_writer3.0-source-<日期>.zip
```

将压缩包中的 `ai_writer3.0/` 目录解压到目标位置，例如 `D:\projects\ai_writer3.0`。

### 方式二：从 Git 仓库克隆

```bash
git clone <仓库地址>
cd ai_writer3.0
```

---

## 3. 安装依赖

在项目根目录执行：

```bash
npm install
```

安装完成后会在根目录生成 `node_modules/`。Electron 二进制文件会在此阶段自动下载（约 100 MB），网络不畅时可先配置 npm 镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
npm install
```

---

## 4. 配置 AI 接口密钥

项目需要至少配置一个 LLM 服务密钥才能正常使用 AI 功能。

### 4.1 创建本地环境变量文件

在项目根目录创建 `.env.local` 文件（**不会被 Git 提交**）：

```ini
# 阿里云 Qwen（当前默认 LLM provider）
AI_WRITER_DEFAULT_QWEN_API_KEY=sk-xxxxxxxxxxxxxxxx

# DeepSeek（可选）
AI_WRITER_DEFAULT_DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx

# Nanobanana 图片生成（可选）
AI_WRITER_DEFAULT_NANOBANANA_API_KEY=your-nanobanana-key
```

> 密钥获取地址：
> - Qwen：https://dashscope.aliyuncs.com
> - DeepSeek：https://platform.deepseek.com
> - Nanobanana：https://grsai.dakka.com.cn

### 4.2 切换默认 LLM Provider

编辑 `build/ai-config.json`，修改 `llm.active` 字段：

```json
{
  "llm": {
    "active": "qwen"   // 可改为 "deepseek" / "openai" / "anthropic" / "custom"
  }
}
```

修改后需重启开发服务器或重新构建。

### 4.3 打包内置密钥（可选）

如需将密钥内置到安装包中，创建 `build/builtin-keys.local.json`（参考 `build/builtin-keys.example.json`）：

```json
{
  "qwenApiKey": "sk-xxxxxxxx",
  "deepseekApiKey": "sk-xxxxxxxx",
  "nanobananaApiKey": "your-key"
}
```

> ⚠️ 此文件包含明文密钥，**禁止提交到版本控制**（已在 `.gitignore` 中排除）。

---

## 5. 启动开发服务器

```bash
npm run dev
```

首次启动会编译 Electron 主进程与渲染进程，随后自动打开应用窗口。

### 类型检查（可选）

```bash
npm run typecheck
```

---

## 6. 打包 Windows 安装包

### 标准打包

```bash
npm run package:win
```

输出目录：`release/`

### 含图表运行时的完整打包

```bash
npm run package:win:full
```

> 完整打包前需先准备 Plot Runtime：
> ```powershell
> npm run prepare:plot-runtime:win
> ```

### 构建流程说明

`npm run package:win` 会依次执行：

1. `npm run sync:builtin-keys` — 将 `build/builtin-keys.local.json`（如存在）同步为构建时内置密钥
2. `vite build` — 编译渲染进程和 Electron 主进程
3. `electron-builder` — 打包为 Windows `.exe` 安装程序

---

## 7. 目录结构说明

```
ai_writer3.0/
├── src/                    # 渲染进程源码（React + TypeScript）
│   ├── engines/            # 文档引擎核心
│   ├── services/           # 前端服务层
│   ├── components/         # UI 组件
│   └── shared/ai/          # AI provider 配置入口
├── electron/
│   ├── main/               # Electron 主进程
│   └── preload/            # 预加载脚本
├── build/                  # 构建脚本与配置
│   ├── ai-config.json      # AI provider 配置（可提交）
│   └── builtin-keys.local.json  # 本地内置密钥（不提交）
├── public/                 # 静态资源
├── docs/                   # 项目文档
├── .env.local              # 本地环境变量（不提交）
├── vite.config.ts          # Vite / Electron 构建配置
├── electron-builder.json   # 打包器配置
└── package.json
```

---

## 8. 常见问题

### Q：`npm install` 后 Electron 下载失败

配置国内镜像后重试：

```bash
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
npm install
```

### Q：启动时报 `build/ai-config.json 不存在`

压缩包中已包含 `build/ai-config.json`，请确认解压完整。若仍缺失，可从 `build/ai-config.json` 示例内容手动创建。

### Q：AI 功能无响应，提示"未配置密钥"

检查 `.env.local` 是否存在且包含有效的 API Key，然后重启开发服务器。

### Q：打包后安装包无法启动

运行验证脚本检查打包产物完整性：

```bash
npm run verify:package:win
```

### Q：如何切换到 DeepSeek 作为默认 LLM

1. 修改 `build/ai-config.json`：`"active": "deepseek"`
2. 在 `.env.local` 中填写 `AI_WRITER_DEFAULT_DEEPSEEK_API_KEY`
3. 重启 `npm run dev`
