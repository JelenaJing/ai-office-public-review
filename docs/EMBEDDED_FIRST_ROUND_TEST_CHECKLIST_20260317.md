# Embedded 首轮最小回归清单

本清单用于 Windows 第一轮手工回归，目标是用最短路径确认 embedded 主线没有被最近几轮 EditorPanel/Composer/OOXML 改动打断。

1. 启动 [release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe) ，确认窗口标题、可执行文件名、压缩包名均为 AI-Writer 3.0。
2. 新建文档，确认默认主编辑面板是 embedded，而不是直接进入 legacy fallback。
3. 输入两到三段测试文本，选中其中一句后右键执行“仅改写选中内容”，确认 composer 打开，生成完成后只替换当前选区。
4. 选中一段主题句后右键执行“一键生成全文”，确认 document 模式 composer 被打开，且初始指令已带入当前选中文字。
5. 在已有正文尾部执行“AI 续写”，确认结果写回当前文档当前位置，不会写到别的标签页。
6. 选中一段事实性描述执行“查找文献并插入”，确认引用标记插入成功，并且对应工作区引用文件被刷新。
7. 选中一段图像描述执行“生成图片并插入”，确认图片对象出现在当前文档，同时工作区 figures 或图片目录出现对应文件。
8. 点击“保存回写”导出 DOCX，关闭并重开该文件，确认以下三项都保留：改写后的正文、插入的引用标记、插入的图片对象。
9. 做一次 fallback 冒烟：切到 legacy EditorPanel 打开文档，确认打开/保存仍正常，且顶部 AI 工具条与右键文案仍和 embedded 基本一致。

建议记录

- 每一步是否通过
- 首个失败步骤编号
- 是否只在 embedded 失败、还是 embedded 与 fallback 都失败
- 保存回写后的 DOCX 是否能稳定重开