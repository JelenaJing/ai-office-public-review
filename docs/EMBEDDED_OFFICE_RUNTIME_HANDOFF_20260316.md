# AI Writer 3.0 Embedded Office Runtime 续接文档

## 当前这一步已经完成什么

### 1. 主进程 OOXML 能力已从占位改成真实包解析，并升级到 block/object 级快照

当前文件：

- electron/main/services/documentEngineService.ts
- electron/main/index.ts
- electron/preload/index.ts
- src/types/electron.d.ts

已经完成的事情：

- `readOoxmlPackage` 不再只是判断二进制里是否出现 `[Content_Types].xml`。
- 现在会真实打开 DOCX zip 包，读取：
  - `[Content_Types].xml`
  - `word/document.xml`
  - zip entry 列表
- 会从 `word/document.xml` 中抽取：
  - `paragraphs`
  - `blocks`
  - `plainText`
  - `html`
  - `paragraphCount`
  - `blockCount`
  - `entryCount`
- block 级别目前已覆盖：
  - 标题
  - 普通段落
  - 图片占位
  - 公式占位
  - 表格占位
- 表格不再只是尺寸占位：现在会抽取带 `colspan/rowspan` 和段落列表的单元格结构，并在 HTML 快照中输出真实 `table/tr/th/td` 结构，供 legacy runtime 编辑后再回写。
- `writeOoxmlPackage` 不再写 `.ooxml.json sidecar`。
- 现在会直接改写原 DOCX 包里的 `word/document.xml`，并重新打包保存。
- 标题写回不再丢掉模板段落样式：现在优先复用原始 heading 模板段落，并只覆写目标 `w:pStyle` 与正文文本。

当前写回语义已经不再是单纯 paragraph array 替换，而是 block/object aware 的第一版写回。

### 2. file:read / file:writeDocx 已接到真实 OOXML 路径

当前行为：

- 读取 `.docx` 时，优先走 `DocumentEngineService.readOoxmlPackage()`。
- 只有当真实包解析失败时，才退回 `mammoth.convertToHtml()`。
- 保存 `.docx` 时，优先走 `DocumentEngineService.writeOoxmlPackage()`。
- 只有在目标不是可改写的现有 DOCX 包时，才退回通用 `exportDocxToPath()` 导出新文件。

这意味着：

- 已经打通“打开现有 DOCX -> 解析 OOXML -> 修改内容 -> 回写原包”的最小闭环。
- 当前回写已经能按 block/object 处理标题、图片、公式、表格，不再依赖 sidecar；其中图片已经能抽取 rel/media 资源并生成 preview，公式已经能从 LaTeX 生成更完整的 OMML 结构而不是只写线性文本。

### 3. Embedded Office Adapter 第一版 runtime 已落地

当前文件：

- src/engines/documentEngine/embeddedOfficeAdapter.ts
- src/components/EmbeddedOfficeEnginePanel.tsx

已经完成的事情：

- `embedded-office-engine` 现在不再只是说明卡片。
- 它已经具备第一版 runtime：
  - `loadDocument`
  - `saveDocument`
  - `getSelection`
  - `insertComment`
  - `upsertFormula`
  - `insertAnchoredImage`
- 第一版承载方式仍然是“文本页 + block marker + 对象预览卡片”，而不是原生 Word 布局对象：
  - 标题会保留成 `# / ## / ###` 标记
  - 图片会保留成 `[图片占位: ...]`
  - 公式会保留成 `[公式占位: ...]`
  - 表格会保留成 `[表格占位: RxC]`
- embedded panel 现在还会在 textarea 上方额外回显：
  - 图片 media 路径、缩略预览、尺寸、inline/anchor 布局、wrap 与 anchor 线索
  - 公式 KaTeX 可视预览
- 面板支持：
  - 打开 DOCX
  - 保存回写
  - 刷新 OOXML 包摘要
  - `Ctrl/Cmd + O`
  - `Ctrl/Cmd + S`

### 4. open/save 入口已经上收到宿主层

当前文件：

- src/engines/documentEngine/hostCommands.tsx
- src/App.tsx
- src/components/FileExplorer.tsx
- src/components/EditorPanel.tsx
- src/components/EmbeddedOfficeEnginePanel.tsx

已经完成的事情：

- FileExplorer 不再直接决定如何读 DOCX，而是把打开动作交给宿主层。
- legacy editor 和 embedded panel 的 open/save 动作都通过 host commands 触发。
- `Ctrl/Cmd + O`、`Ctrl/Cmd + S` 也已经由宿主统一接管。
- `Ctrl/Cmd + Shift + S`、toolbar 的“另存为”、以及 autosave 现在也统一走 host command。
- 现在真正决定“如何打开/保存”的是当前活动 runtime，而不是某个具体面板私有逻辑。

### 5. UI 约束仍然保持

- 默认活动引擎现已切换为 `embedded-office-engine`
- 2.0 的 UI 壳层仍然复用，但文档主路径已经迁到 embedded runtime
- `legacy-tiptap-bridge` 仅作为兼容与回退桥接层保留

## 当前这一步还没有完成什么

这些点不能误判成“已经解决”：

1. 现在的 OOXML 写回虽然已经升级到 block/object placeholder 级，但仍不是完整 Word 语义写回。
2. 表格、复杂分页、批注结构、脚注、绘图锚点、公式对象、页眉页脚等高级语义还没有做真实保真更新。
3. 当前 embedded runtime 的编辑面板仍是文本页，不是原生 Word/WPS 级可视排版引擎。
4. `DocumentEngineHost` 当前默认已挂 embedded panel，但 embedded runtime 仍不是原生 Word/WPS 级可视排版引擎。
5. host 虽然已经接管 open/save/save-as/autosave，但更细粒度的工作区刷新、文件重命名/移动之类文件动作还没有完全统一到 host command 总线。

## 下一步应该继续做什么

### 下一步 1：把 block/object placeholder 写回推进到真正的结构语义写回

目标：

- 不只保留 placeholder。
- 要开始把这些对象往真实 OOXML 结构推进：
  - 标题样式保真
  - 图片对象和锚点
  - 公式对象
  - 表格结构与单元格内容

当前这一步的进度：

- 标题样式保真已进入“模板段落复用 + pStyle 覆写”的阶段。
- 表格已进入“单元格内容矩阵 + `colspan/rowspan` + 单元格段落列表读写 + 真实 OOXML `w:tbl/w:tr/w:tc` 回写”的阶段。
- 图片已进入“保留原始 drawing/pic OOXML + 解析 `document.xml.rels` 与 media 资源 + 回显 preview + 提取尺寸/inline-or-anchor/wrap/anchor 线索 + 更新 docPr 元数据”的阶段。
- 公式已进入“优先复用原始 OMML 容器；当表达式变化时，优先走 LaTeX-aware OMML 兜底，再辅以 MathML->OMML 转换，已覆盖分式、上下标、根式、矩阵、n-ary、accent、delimiter、aligned 等高价值结构”的阶段。

验证补充：

- 仓库内已经新增 `npm run smoke:ooxml`。
- 这条 smoke test 会实际构造最小 DOCX 包并验证：
  - 图片 media preview 提取
  - 图片尺寸/anchor 信息提取
  - 公式 richer OMML 生成
  - 公式 n-ary / accent / delimiter / aligned 结构生成
  - 表格 `colspan/rowspan` 与多段落单元格 round-trip

建议落点：

- 继续在 `documentEngineService.ts` 上做，不要回退到 paragraph-only 方案。
- 把当前 placeholder block 转成更接近真实 OOXML 对象的读写器。

### 下一步 2：把 embedded panel 从 textarea 推进到真正的宿主视图

目标：

- 保留当前 UI 壳层不变。
- 但 embedded panel 内部不再只是 textarea。
- 至少进入“段落级结构化视图 + 选区同步”的状态。

建议落点：

- 先做 block renderer，再做 block editor。
- 不要一开始就追求完整 Word 排版；先把 block 级编辑闭环跑通。

### 下一步 3：把更多编辑事件继续统一到宿主层

目标：

- 自动保存也走 host command。
- 顶部更多文件动作统一走 host command。
- 让工作区文档刷新与活动引擎状态同步，不再由面板各自维护局部规则。

当前这一步的进度：

- autosave 已经改走 host command。
- 顶部“打开 / 保存 / 另存为”已统一到 host command。
- 下一步可以继续收敛 rename/move/delete 后的活动文档同步，以及更多 workspace 级文件动作。

建议落点：

- 保持 `hostCommands.tsx` 作为唯一 open/save 入口。
- 后续把 autosave 和更多 file actions 继续并进这条总线。

## 当前实现时需要记住的边界

1. 当前目标是先换内核接缝，不先换 2.0 壳层。
2. 现在已经可以说“有真实 OOXML 包解析与原包回写”，但不能说“已实现 Word/WPS 原生兼容引擎”。
3. 接下来最值钱的工作不是再修 placeholder 文档，而是把现在的 block/object placeholder 写回推进成更真实的 OOXML 对象语义写回。
4. 如果后续要把 embedded engine 切成默认，必须先验证：
   - 工作区打开/保存不退化
   - 自动保存不退化
   - 引用/公式/图片插入不退化
   - DOCX round-trip 不比 2.0 更差
