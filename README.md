# ai-office

AI Writer 3.0 的本地工作副本。

## AI 配置入口

- 默认 provider、模型名、接口地址统一收口在 src/shared/ai/providerCatalog.ts。
- 运行时设置读写在 electron/main/services/settingsStore.ts。
- 开发态内置 key 优先从 .env / .env.local 读取，模板见 .env.example。
- 打包或本地构建也兼容 build/builtin-keys.local.json 作为内置 key 来源。

当前默认文字 provider 已切到 Qwen：

- model: qwen3.6-plus
- base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
- 推荐唯一填写位置: .env.local 中的 AI_WRITER_DEFAULT_QWEN_API_KEY

## 内置 Key 优先级

1. build/builtin-keys.local.json
2. .env / .env.local 中的 AI_WRITER_DEFAULT_* 变量
3. 兼容变量名 QWEN_API_KEY / DEEPSEEK_API_KEY / NANOBANANA_API_KEY

设置页和 AI 侧栏会显示当前内置 key 来源，但不会回显内置 key 明文。
