# 主包安装包级别冒烟清单

本清单用于 Windows 安装包级别验收，范围只覆盖主包里的三个关键链路：PDF 导入、Remake 启动、结果导出。

目标不是重复开发态 smoke，而是确认最终分发物里的内置 Introduction Remake 窗口仍然可用，且导出结果包完整落盘。

## 适用产物

- [../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe)
- [../release/AI-Writer-3.0-3.0.0-alpha.1-Setup.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Setup.exe)
- [../release/AI-Writer 3.0-3.0.0-alpha.1-win.zip](../release/AI-Writer%203.0-3.0.0-alpha.1-win.zip)

建议优先验 Portable，再抽查 Setup 安装后的行为是否一致。

## 执行前提

1. 在 Windows x64 环境执行。
2. 主包已成功打包，且 [../release/win-unpacked/resources](../release/win-unpacked/resources) 下能看到 `introduction-remake-app`、`data`、`merged-plot-agent` 三类资源；当前默认瘦身包不再内置 `plot-agent-runtime`。
3. 已准备一个 3 到 5 页的正文型 PDF；开发机可直接复用 [../../introduction-remake-app/build/samples/introduction-remake-multipage-sample.pdf](../../introduction-remake-app/build/samples/introduction-remake-multipage-sample.pdf)。
4. 如果要完整走导出链路，需要可用的模型配置和联网能力；至少要保证 Remake 页面里的“测试连接”通过。

## 当前自动化预检

截至 2026-04-02，以下自动化检查已通过，可作为安装包手工验收前的基线：

1. `npm run smoke:pdf-dom`
   - PDF 导入完成后，编辑区已出现提取文字，`editorTextLength = 1559`
   - 进度提示为“PDF 解析完成，已识别出引言并完成结构整理”
   - 左侧 PDF 预览可见，摘要卡出现“1562 字 / 0 条 / 原文编辑”
2. `npm run smoke:intro-launcher`
   - 主启动器已接入内置 Remake 入口
   - 流式重写产生 `266` 个 delta 事件
   - 顺序引用结果包含 `2` 条参考文献
   - 导出目录已成功创建
3. Windows 打包校验
   - 主包已产出 Portable、Setup、Zip 三类分发物
   - `win-unpacked/resources` 已包含 `introduction-remake-app/dist/index.html` 和导出所需运行时资源

这些结果说明开发态与资源打包态都已经通过预检，但仍需要在最终安装包里手工确认 UI、窗口切换和导出交互没有回归。

## 安装包冒烟步骤

1. 启动 [../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe) 或安装 [../release/AI-Writer-3.0-3.0.0-alpha.1-Setup.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Setup.exe) 后启动应用，确认首先进入主启动器，而不是直接进入某个旧工作台。
2. 在启动器首页确认同时存在 AI-Writer 3.0 与 Introduction Remake 两个入口，并且 Remake 卡片文案明确说明它是“内置窗口”而不是独立 exe。
3. 点击“进入 Remake”，确认会打开新的 Remake 窗口，且主包本体不退出、不白屏、不出现资源缺失报错。
4. 进入 Remake 后，先检查基础壳层：左侧为 PDF 预览区，右侧为文字编辑区，顶部至少能看到“导入 PDF”“推断主题”“构建文献池”“开始重写/停止重写”“整理结果”这组操作。
5. 点击“导入 PDF”，选择测试 PDF，确认 60 秒内至少同时出现以下现象：
   - 左侧出现 PDF 预览画面
   - 右侧编辑区出现提取出的正文文本，长度明显大于 1000 字
   - 状态区出现“PDF 解析完成”或“已识别出引言并完成结构整理”这类完成提示
   - 摘要卡出现“识别引言 xx 字”“编辑模式 原文编辑”之类信息
6. 在导入完成后，确认主包里的 Remake 不是假壳：点击“推断主题”后应出现主题结果；点击“构建文献池”后“文献池”数量应从 `0` 变为正数。
7. 打开“更多设置”，在模型设置区点击“测试连接”；只有这里通过后再继续。若测试连接失败，本轮只记录为模型配置问题，不把它误判成主包集成故障。
8. 点击“开始重写”，确认右侧可切到 Remake 草稿，状态区会出现流式生成中的文字长度变化；完成后应看到“引用 x 条，可直接导出”或等价提示。
9. 点击“整理结果”，确认最终正文切换为顺序引用版，且状态区保留正文长度与引用数量。
10. 点击“导出结果包”，选择一个空目录，确认主包会创建 `RemakeTask-主题-时间戳` 目录，且目录内至少包含以下 9 个文件：
    - `00_summary.json`
    - `01_source_text.txt`
    - `02_remade_text_pool_indices.md`
    - `03_sequential_remade_text.md`
    - `04_references.txt`
    - `05_literature_pool.json`
    - `06_audit.txt`
    - `07_remade_formatted.html`
    - `08_remade_formatted.docx`
11. 打开导出目录，重点复核三项：
    - `03_sequential_remade_text.md` 中存在顺序引用编号，如 `[1]`、`[2]`
    - `04_references.txt` 的条目数与界面显示引用数一致
    - `08_remade_formatted.docx` 可被 Word 或 WPS 正常打开
12. 回到启动器，再次查看 Remake 卡片上的最近任务区域，确认刚才导出的任务已经出现，状态为 `exported` 或等价文案。

## 通过标准

- 通过：步骤 1 到 12 全部完成，且没有白屏、空窗口、资源缺失、导出目录为空等主包集成问题。
- 条件通过：PDF 导入、Remake 启动、导出落盘都正常，但模型连通性因环境配置失败；这类问题单独记录为环境问题。
- 不通过：出现以下任一情况即判失败：
  - 点击“进入 Remake”没有拉起内置窗口
  - PDF 导入后只有预览没有文本，或只有文本没有预览
  - 文献池始终为 0 且无明确错误解释
  - 导出按钮可点但未生成 `RemakeTask-*` 目录
  - 9 个导出文件缺失任意一个

## 记录建议

- 记录本次验证的产物类型：Portable / Setup / Zip 解压版。
- 记录测试 PDF 文件名与页数。
- 记录首个失败步骤编号与截图。
- 如果失败只发生在 Setup，不发生在 Portable，优先排查安装路径、权限和资源复制差异。