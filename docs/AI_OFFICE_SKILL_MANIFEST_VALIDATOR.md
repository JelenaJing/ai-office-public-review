# AI Office Skill Manifest Validator

> 版本：v0.1  
> 适用范围：`ai_writer3.0-public`  
> 关联：[AI_OFFICE_CORE_CAPABILITY_API.md](./AI_OFFICE_CORE_CAPABILITY_API.md)、[AI_OFFICE_SKILL_BOUNDARY_DESIGN.md](./AI_OFFICE_SKILL_BOUNDARY_DESIGN.md)

---

## 1. 职责边界

| 模块 | 职责 |
|------|------|
| **Core Capability Catalog** | 定义平台能力 id、成熟度、invoke 策略 |
| **Capability Validator** | 校验 `requiredCapabilities` 是否合法、可否被 Skill 声明 |
| **Skill Manifest Validator** | 校验整个 Skill 包 `manifest.json` 是否可安全安装 |
| **skill.md** | 人类 / Agent 说明，**非**运行时唯一协议 |

代码位置：

- `src/skills/manifest/skillManifestTypes.ts`
- `src/skills/manifest/skillManifestValidator.ts`
- `scripts/smoke-skill-manifest-validator.ts`

---

## 2. manifest.json 字段

```json
{
  "schemaVersion": "ai-office-skill-manifest-v1",
  "skillId": "ppt.template.business_report",
  "name": "商务汇报 PPT 模板",
  "description": "可选说明",
  "version": "1.0.0",
  "kind": "template",
  "domain": "ppt",
  "requiredCapabilities": ["deck.render", "deck.preview", "deckTemplate.list"],
  "compatibleAgents": ["ppt-agent"],
  "inputs": {},
  "outputs": {},
  "assets": {
    "template": "assets/template.pptx"
  },
  "prompts": {
    "guide": "prompts/guide.md"
  },
  "permissions": ["workspace.write", "deck.write"],
  "workflow": {
    "steps": [
      { "id": "render", "capability": "deck.render" }
    ]
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `schemaVersion` | ✓ | 固定 `ai-office-skill-manifest-v1` |
| `skillId` | ✓ | `[a-z0-9._-]+` |
| `name` | ✓ | 显示名称 |
| `version` | ✓ | 建议 semver |
| `kind` | ✓ | `template` \| `workflow` \| `style` \| `adapter` |
| `domain` | ✓ | `document` \| `ppt` \| `email` \| … |
| `requiredCapabilities` | ✓ | Core Capability id 数组 |
| `assets` / `prompts` | | 键值对，值为**包内相对路径** |
| `permissions` | | 白名单权限字符串 |
| `workflow` | | 仅 `kind=workflow` 推荐；含 `steps[]` |

---

## 3. requiredCapabilities 校验

委托 `validateManifestCapabilities`（`callerType: skill`）：

| 情况 | 结果 |
|------|------|
| 未知 id / Agent Action 字符串 | **error** |
| `pptx.import`、`runtime.writeLog`（forbidden） | **error** |
| `planned` | **warning** `PLANNED_DECLARED` |
| `wrapper` 且 `invokeEnabled=false` | **warning** `WRAPPER_ONLY` |

---

## 4. assets / prompts 安全规则

- 必须为相对路径  
- 禁止绝对路径（含 `C:\`、`/etc/...`）  
- 禁止 `..`  
- 禁止 `file://`、`http://`、`https://`  
- 若校验时传入 `skillDir`，则检查文件是否存在于包内  

---

## 5. permissions 白名单

允许：

- `workspace.read` / `workspace.write`
- `knowledge.retrieve`
- `llm.generate`
- `document.write` / `deck.write`
- `email.read` / `email.draft`
- `calendar.write`

禁止（示例）：

- `shell.execute`
- `fs.absolute`
- `network.raw`
- `process.spawn`
- `system.admin`

Skill **不得**通过 manifest 申请 shell 或任意进程执行权限。

---

## 6. workflow.steps 规则

| 规则 | 级别 |
|------|------|
| 每步必须有 `id`、`capability` | error |
| `step.capability` 必须在 `requiredCapabilities` 中 | error |
| `step.capability` 须为合法 Capability id | error |
| 步骤不得使用 restricted / forbidden capability | error |
| `kind=template` 且含 `workflow.steps` | **warning** `WORKFLOW_ON_TEMPLATE` |

---

## 7. API

```typescript
import { validateSkillManifest, parseSkillManifestJson } from '@/skills/manifest'

const parsed = parseSkillManifestJson(rawJson)
if (!parsed.ok) { /* handle parse errors */ }

const result = validateSkillManifest(parsed.manifest, { skillDir: '/path/to/skill-package' })
// result.ok, result.errors[], result.warnings[]
```

---

## 8. 示例 manifest（PPT Template）

```json
{
  "schemaVersion": "ai-office-skill-manifest-v1",
  "skillId": "ppt.template.business_report",
  "name": "商务汇报 PPT 模板",
  "version": "1.0.0",
  "kind": "template",
  "domain": "ppt",
  "requiredCapabilities": [
    "deck.render",
    "deck.preview",
    "deckTemplate.list",
    "workspace.copyFile"
  ],
  "assets": {
    "template": "assets/template.pptx",
    "slotRules": "assets/slot-rules.json"
  },
  "permissions": ["workspace.write", "deck.write"]
}
```

---

## 9. 本地验证

```bash
npx tsx scripts/smoke-skill-manifest-validator.ts
npx tsx scripts/smoke-capability-layer.ts
```

---

*文档维护：架构组 · v0.1 · 2026-05*
