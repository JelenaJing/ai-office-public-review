# AI Writer 3.0 内置 Office 兼容引擎接入方案

## 结论

3.0 的具体接入方案确定为：

以“独立文档引擎宿主 + OOXML 真源存储 + Electron 本地桥接”作为固定架构，后续把真正的 Office 兼容编辑运行时接到这个宿主层中，而不是继续把 TipTap 改造成 Word。

这不是一句口号，而是下面这套固定落点：

## 接入边界

保留不动的部分：

- 主应用壳层和整体 UI 布局
- 工作区管理
- 任务管理
- AI 生成链路
- 图片与引用服务
- 设置中心、终端输出、任务面板

被替换的部分：

- 主编辑器渲染核心
- 文档加载与保存核心
- 选区与批注底层实现
- 公式与图片锚定的底层写回方式

## 具体模块划分

### 1. Renderer 层

Renderer 不再直接持有具体编辑器实现，而是只认 DocumentEngineHost。

Host 负责：

- 挂载当前活动引擎
- 提供统一 UI 壳层
- 把工具栏、右键菜单、工作区事件和引擎 runtime 连接起来

这一步已经开始落地，当前路径：

- src/components/DocumentEngineHost.tsx
- src/engines/documentEngine/contracts.ts
- src/engines/documentEngine/runtime.tsx
- src/engines/documentEngine/legacyTiptapAdapter.ts

### 2. Preload 桥接层

Preload 后续需要补齐一组只服务于文档引擎的桥接能力：

- 打开 OOXML 包
- 保存 OOXML 包
- 查询工作区资源路径
- 请求图片落盘和重新映射
- 引用/批注增量写回
- 引擎事件到主进程任务事件的同步

关键点：

引擎不直接访问 Node 能力，仍然通过 preload 暴露的最小 IPC 面来做本地文件和任务交互。

当前已经落地的第一版桥接面包括：

- 查询当前活动文档引擎
- 设置首选文档引擎
- 读取 OOXML 包真实快照
- 回写原始 DOCX 包中的 word/document.xml

这里要明确：这批 IPC 已经具备“真实 OOXML 包解析 + 第一版 document.xml 回写”能力，但仍然只是文本级/段落级 runtime，不等于已经完成 Word/WPS 级排版兼容。

### 3. Main Process 文档服务层

主进程需要新增一层 document service，职责不是生成 UI，而是处理文档真源：

- OOXML 包读写
- 工作区文档索引
- 资源路径映射
- 批注、公式、图片资源的元数据对齐
- 与 AI 生成结果的合并策略

AI 结果写入不再只返回 HTML，而是需要支持结构化文档更新请求。

当前论文生成链已经进入下一阶段：

- paper content 事件以 structuredBlocks 作为主载荷
- cumulativeMarkdown 只保留为兼容字段，逐步从实时 transport 中退出
- renderer 侧预览优先消费结构化 block/object 模型，而不是依赖完整 Markdown 快照

### 4. 文档真源

3.0 后续的真源不再建议是 HTML，而应当是：

- 主真源：结构化文档模型或 OOXML 包
- 渲染缓存：引擎内部显示态
- 交换格式：DOCX
- 导出格式：PDF

这意味着后续加载和保存流程都要围绕 OOXML 语义而不是 HTML 字符串来设计。

## 六类能力的固定接口

这次已经先抽出六类引擎能力接口：

- loadDocument
- saveDocument
- getSelection
- insertComment
- upsertFormula
- insertAnchoredImage

后续真正的 Office 兼容引擎只要实现这六类 runtime，就可以替换掉 legacy TipTap adapter。

## 接入阶段

### 阶段 A：Legacy 适配稳定化

目标：

- 让当前 TipTap 继续提供 2.0 全部能力
- 但所有关键能力都经由 runtime contract 出入

这样 3.0 的 UI 仍与 2.0 保持一致，功能不少于 2.0。

### 阶段 B：Office 引擎占位接入

目标：

- 新增 embedded office engine adapter
- 支持只读打开 DOCX 包
- 支持基础编辑与保存回写
- 先不替换全部工具栏，只做宿主层并行接入

当前状态：

- 已有 embedded-office-engine 的 registry 项和宿主挂载点
- 已有 Electron 主进程 documentEngineService，并已接入真实 DOCX zip 包解析与 document.xml 写回
- 已有 EmbeddedOfficeEnginePanel 第一版运行界面，可打开/保存 DOCX
- 已有 embedded office adapter 第一版 runtime
- EmbeddedOfficeEnginePanel 已从单一 textarea 改为 block/object 编辑界面：标题/段落按块编辑，公式按对象编辑，图片对象可直接编辑 relationship target、尺寸、layout、anchor 和 wrap
- embedded office adapter 已不再依赖整文纯文本替换，评论/公式/图片走对象级插入接口
- OOXML 图片写回已扩展到 document.xml.rels 和 zip 内 media entry：当图片 target 或 previewSrc 发生变化时，会同步更新 rels target、drawing 元数据、对应 media 文件和 [Content_Types].xml
- 仍然缺少真正的高保真排版运行时，以及“从外部图片文件直接替换到 OOXML 包”的完整资源管理 UX

### 阶段 C：双引擎并行验证

目标：

- Legacy TipTap Bridge 继续可用
- Embedded Office Engine 可以在同一 UI 壳层下运行
- 用同一个工作区和任务体系验证两套引擎的行为一致性

### 阶段 D：切主引擎

目标：

- 把 embedded office engine 设为 active engine
- TipTap 退为 legacy adapter，仅做兼容兜底

## UI 约束

用户要求是：

- 最终 UI 与 2.0 一样
- 功能不少于 2.0

因此 3.0 的原则是：

- 先换内核，不先换壳
- 主界面、侧栏、任务抽屉、状态栏、文件树继续保持 2.0 风格
- 引擎切换发生在宿主层，不把 UI 改成另一套产品

## 验证标准

真正切到内置 Office 兼容引擎前，至少要满足：

1. 工作区打开、保存、自动保存不退化。
2. 选区、右键菜单、批注/引用插入不退化。
3. 公式编辑与图片插入不退化。
4. AI 生成整文写回不退化。
5. DOCX 导入导出回环比 2.0 更稳定，而不是更差。

## 现在的判断

3.0 当前已经满足阶段 A 的起点条件：

- UI 仍是 2.0 这套界面
- 宿主层已经存在
- 六类能力接口已经落地
- TipTap 已开始被降为 legacy adapter，而不是默认唯一文档核心

同时也已经完成了阶段 B 的基础脚手架：

- 宿主层可以识别 embedded-office-engine
- main/preload 已有 document-engine IPC 接缝
- OOXML 包解析与原包写回链路已经打通

下一步真正要做的，不再是继续修 TipTap，而是把 embedded office engine adapter 从“文本级第一版 runtime”推进成“结构化 block/object 级 runtime”。

## 当前已验证能力

目前已经可以稳定验证的能力包括：

- 真实 DOCX 包读取与原包回写
- heading / paragraph / table / formula / image block 的结构化快照与回写
- 图片对象的 relationship target、尺寸、anchor、wrap 改动回写
- 当图片 previewSrc 提供 data URL 时，把新图片二进制写回 word/media，并同步更新 [Content_Types].xml

对应的回归命令：

- npm run build
- npm run smoke:ooxml

## 和真正 Office 内核还差什么

当前这版已经有：

- 本地 OOXML 真源读写
- 页面容器内的文档块编辑
- 图片 / 公式 / 表格对象级编辑
- 图片 media entry 和表格结构回写

但它和真正的 Office 内核之间，还差至少下面这些层级：

### 1. 排版与版面引擎

- 现在没有真实分页算法，只有 A4 近似页面容器
- 没有行内排版、断行、孤行寡行、分页前后控制等 Word 级版面规则
- 没有段落样式、字符样式、页眉页脚、节、分栏、目录、脚注/尾注等完整布局语义
- 图片 anchor / wrap 已能写回，但还没有所见即所得的位置解算与重排

### 2. 编辑交互内核

- 现在仍以 block/object 数据模型驱动，不是真正的连续文档布局树编辑
- 没有 Word 级光标移动、跨对象选区、撤销栈、键盘编辑语义
- 表格编辑虽然已支持结构操作，但仍是结构化检查器式交互，不是原生网格编辑体验
- 公式仍是对象级编辑，不是行内数学布局内核

### 3. 文档语义覆盖面

- 当前重点覆盖 heading / paragraph / image / formula / table
- 仍缺：批注、修订、书签、域、交叉引用、目录域、页码域、文本框、形状、页眉页脚、节属性
- 样式继承、编号列表、复杂段落属性还没有完整映射到编辑态

### 4. 兼容性与 fidelity

- 现在是“高保真 OOXML 结构回写”方向，不是“完整 Word 兼容渲染”
- 复杂 DOCX 中的局部内容虽然能保留，但不保证所有对象都能被当前运行时正确编辑和回显
- 对第三方 Office 生成文档的兼容矩阵还没有做系统验证

### 5. 资源与协同能力

- 本地图片替换和媒体写回已打通，但资源管理 UX 还不完整
- 还没有批注流、修订流、协同变更、增量 merge、冲突解决机制

## 当前推进方向

当前推荐的推进策略不是试图一次性嵌入完整 Word 内核，而是继续沿着下面这条路线收敛：

1. 先把现有 embedded runtime 从“结构卡片编辑器”推进到“页内文档流编辑器”
2. 再把连续选区、撤销重做、段落/样式/列表等基础编辑内核补齐
3. 最后才考虑接入外部 Office 兼容 runtime 或更完整的排版引擎

最新一轮推进后，EmbeddedOfficeEnginePanel 已经开始向 Office 交互靠近：

- 顶部有页内标尺和页面状态条
- 文本块弱化了卡片化 chrome，按页内文档流呈现
- 图片 / 公式 / 表格对象默认以文档对象形态显示，只有激活后才展开检查器
- 图片支持预览框手柄缩放，表格支持选区式矩形合并