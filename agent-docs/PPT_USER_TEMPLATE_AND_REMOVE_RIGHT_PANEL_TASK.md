# PPT 工作台：用户上传 PPT 模板与删除右边栏任务

> 建议文件位置：`docs/PPT_USER_TEMPLATE_AND_REMOVE_RIGHT_PANEL_TASK.md`  
> 项目：AI Office / AI Writer 3.0  
> 技术栈：Electron + Vite + React + TypeScript  
> 目标模块：PPT 工作台  
> 本次任务范围：  
> 1. 支持用户上传 `.pptx` 作为 PPT 模板  
> 2. 删除 PPT 工作台右边栏  
> 3. 不改邮件、文稿、Excel、知识库、Skill 商店等其他模块

---

## 1. 当前问题

PPT 工作台目前存在两个需要调整的问题。

### 问题 1：不能让用户上传自己的 PPT 模板

现在用户只能使用默认模板、内置模板或已有 Skill 模板。  
需要支持用户上传本地 `.pptx` 文件作为模板，并能用于后续 PPT 生成或模板替换。

### 问题 2：右边栏不需要

当前右边栏显示：

```text
内容文档
状态
当前模板
生成进度
导出文件
提示卡片
```

这部分占空间，而且大多数信息不应该放在右侧固定栏里。  
本次要求删除右边栏，不是折叠，不是隐藏。

---

## 2. 本次修改范围

只修改 PPT 工作台相关代码。

请优先检查：

```text
src/modules/ppt/
src/pages/
src/components/
src/skills/
pptTemplateRegistry
RetemplateEngine
deckDocumentService
pptxGenerator
pptxBackgroundInjector
layoutMatcher
slotBinder
contentPaginator
electron/main
electron/preload
src/types/electron.d.ts
```

搜索关键词：

```text
PPT 工作台
ppt
pptx
deck
DeckDocument
template
templateRegistry
pptTemplateRegistry
RetemplateEngine
retemplate
currentTemplate
uploadTemplate
openDirectory
rightPanel
sidebar
内容文档
当前模板
生成进度
导出文件
```

---

## 3. 用户上传 PPT 模板

### 3.1 入口

请在 PPT 工作台顶部或模板选择区域增加入口：

```text
上传模板
```

或：

```text
导入 PPT 模板
```

不要把入口放在右侧栏，因为右侧栏要删除。

### 3.2 支持文件

第一阶段只要求支持：

```text
.pptx
```

可以暂时不支持：

```text
.ppt
```

如果用户选择 `.ppt`，应显示明确提示：

```text
当前仅支持 .pptx 模板文件。
```

### 3.3 上传流程

用户点击“上传模板”后：

```text
点击上传模板
→ 打开 Windows 文件选择器
→ 用户选择 .pptx 文件
→ 将文件复制到当前工作区的 PPT 模板目录
→ 生成用户模板 manifest
→ 注册到当前模板列表
→ 自动设为 currentTemplate
```

建议模板保存目录：

```text
workspace/templates/ppt/
```

如果项目已有 PPT 模板存储路径，优先复用现有路径。

---

## 4. 用户 PPT 模板 Manifest

建议新增或等价实现：

```ts
export interface UserPptTemplateManifest {
  id: string;
  name: string;
  sourceFilePath: string;
  workspaceTemplatePath: string;
  createdAt: string;
  type: 'user_pptx_template';
}
```

要求：

1. `id` 稳定且唯一。
2. `name` 默认来自文件名，允许后续扩展为用户自定义。
3. `sourceFilePath` 只用于本地复制过程，不要暴露给 LLM。
4. `workspaceTemplatePath` 指向工作区内模板副本。
5. manifest 应按当前工作区保存。
6. 不要写死用户路径。
7. 路径统一使用 `path.join`。

---

## 5. 用户上传模板注册

上传成功后，需要把用户模板注册进当前模板列表。

模板来源至少区分：

```text
内置模板
Skill 模板
用户上传模板
```

用户上传模板应可以：

```text
1. 显示在模板选择列表中
2. 被设为 currentTemplate
3. 参与 PPT 生成
4. 参与已有 DeckDocument 的重新渲染
```

---

## 6. 模板解析策略

请根据项目现有能力选择稳妥实现。

### 6.1 优先方案：复用已有模板解析能力

如果当前项目已有 PPTX 模板解析 / slot 提取 / layout 匹配能力，请复用：

```text
layoutMatcher
slotBinder
contentPaginator
RetemplateEngine
pptTemplateRegistry
PptTemplateManifest
```

目标：

```text
1. 读取用户上传 PPTX
2. 提取页面尺寸
3. 提取每页 layout 信息
4. 识别文本框、标题框、图片框
5. 生成 template manifest
6. 接入 RetemplateEngine
7. 将 DeckDocument 绑定到上传模板
```

### 6.2 MVP 降级方案

如果当前还没有稳定的 PPTX slot 提取能力，则使用 MVP 降级方案：

```text
1. 复制用户上传的 PPTX 到工作区模板目录
2. 提取基本元数据：文件名、页数、页面尺寸
3. 注册到模板列表
4. 设置为 currentTemplate
5. 生成 PPT 时优先复用模板主题、尺寸、背景或版式
```

如果无法完整解析 slot，需要显示应用内提示：

```text
已导入模板。当前版本将优先复用模板主题和页面尺寸，复杂占位符匹配将在后续版本增强。
```

不要静默失败。  
不要让按钮点击后没有反馈。  
不要写 demo / mock / test。

---

## 7. 模板切换逻辑

用户上传模板后，应自动设为当前模板。

### 如果当前已有 DeckDocument

```text
切换模板
→ 使用现有 DeckDocument
→ 重新渲染 / retemplate
→ 不调用 LLM
→ 不消耗 token
```

### 如果当前没有 DeckDocument

```text
切换模板
→ 只更新 currentTemplate
→ 等用户之后生成 PPT 时使用
```

要求：

1. 切换模板不重新生成内容。
2. 切换模板不消耗 token。
3. 切换失败时显示明确错误。
4. 不要把模板切换和 AI 内容生成耦合。

---

## 8. 删除 PPT 工作台右边栏

### 8.1 要删除的右边栏内容

删除截图中的右侧栏，包括：

```text
内容文档
状态
当前模板
生成进度
导出文件
提示卡片
```

尤其删除这类提示：

```text
替换模板和重新渲染不会消耗 token，只有点击“AI 优化结构”才会使用模型。
```

### 8.2 删除要求

1. 不是折叠。
2. 不是隐藏。
3. 不保留空白右侧区域。
4. 主预览区 / 编辑区应该自动占满右侧空间。
5. 删除右边栏相关布局代码。
6. 删除不再使用的 styled components / CSS。
7. 删除不再使用的 state / props / imports。

---

## 9. 右边栏必要功能迁移

如果右侧栏中有必要功能，不要直接丢失，而是移动到更合适的位置。

建议迁移：

```text
当前模板 → 顶部工具栏或模板选择区域
上传模板 → 顶部工具栏或模板选择区域
导出文件 → 顶部工具栏或生成结果区域
生成进度 → 底部生成区或中央状态卡片
打开目录 → 顶部工具栏保留
提示卡片 → 删除
```

不要再新增一个新的右侧固定栏。

---

## 10. 调整后的 PPT 工作台布局

建议最终结构：

```text
顶部栏
├── 当前文件名
├── PPT 工作台标题
├── 当前模板选择
├── 上传模板
├── 导出 PPT
└── 打开目录

左侧
└── 幻灯片缩略图列表

中间
└── PPT 预览 / 生成状态 / 空状态

底部
├── PPT 生成输入框
└── 生成 PPT 按钮
```

不要再有右边栏。

---

## 11. 必须保留的能力

修改时必须保留：

```text
现有 PPT 生成能力
现有 DeckDocument 内容结构
现有模板替换 / retemplate 能力
现有导出 PPTX 能力
打开目录功能
已有内置模板
已有 Skill 模板
当前工作区保存逻辑
不消耗 token 的模板切换逻辑
```

---

## 12. 不要破坏的模块

不要破坏：

```text
文稿工作台
邮件工作台
Excel 功能
知识库
Skill 商店
登录 / 工作区选择
```

---

## 13. 用户上传模板的错误处理

需要处理这些情况：

```text
未选择工作区
用户取消文件选择
选择了非 .pptx 文件
模板复制失败
模板解析失败
模板注册失败
模板切换失败
当前 DeckDocument 不存在
当前 workspace 路径失效
中文工作区路径
```

要求：

1. 错误要显示应用内提示。
2. 不要静默失败。
3. 不要弹出无法理解的系统错误。
4. 中文路径必须正常。
5. 不要硬编码路径。

---

## 14. 删除多余代码

完成后清理：

```text
右边栏组件
右边栏 styled components
右边栏专用 state
右边栏提示卡片
不再使用的 props
不再使用的 imports
不再使用的 CSS
没有调用的模板状态展示逻辑
```

不要只是注释。  
不要只是隐藏。  
不再使用的代码直接删除。

---

## 15. 验收要求

完成后运行：

```bash
npm run build
```

如果可以，再运行：

```bash
npm run typecheck
```

最终输出：

```text
1. 用户上传 PPT 模板入口放在哪里。
2. 上传后的模板保存到哪里。
3. 用户上传模板如何注册到模板列表。
4. 当前模板如何切换为用户上传模板。
5. 有 DeckDocument 时是否能重新渲染且不调用 LLM。
6. 没有 DeckDocument 时是否能只设置模板。
7. 右边栏是否已删除，而不是隐藏。
8. 右边栏里的必要功能移动到了哪里。
9. 是否仍保留 PPT 生成、导出、打开目录能力。
10. 删除了哪些多余代码。
11. build 是否通过。
12. typecheck 是否通过；如果失败，区分本次新增错误和历史错误。
```

---

## 16. 最终目标

PPT 工作台应该支持：

```text
用户上传自己的 PPTX 模板
→ 模板进入模板列表
→ 设置为当前模板
→ 使用现有 DeckDocument 重新渲染
→ 不消耗 token
```

同时 UI 应该变成：

```text
无右边栏
中间区域更宽
模板选择与上传在顶部
生成输入在底部
```

最终原则：

```text
用户模板是正式模板来源，不是 demo。
右侧栏要删除，不是折叠或隐藏。
```
