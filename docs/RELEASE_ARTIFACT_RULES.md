# Release 产物规则

当前 Windows 打包以 AI-Office 3.0 为唯一正式产物名。

规则如下：

1. release 根目录只保留当前可分发产物。
2. 当前可分发产物统一使用 AI-Office 前缀。
3. 所有以 AI-Writer 开头的旧产物都视为历史遗留，不再和当前产物混放。
4. 打包脚本会在正式打包前，自动把 release 根目录中的 AI-Writer 旧产物归档到 release/legacy-ai-writer。
5. 当前 Windows 打包脚本只产出 portable 和 zip，不再产出 Setup 安装包。

当前目录约定：

- release/AI-Office 3.0-<version>-win.zip
- release/AI-Office-3.0-<version>-Portable.exe
- release/win-unpacked/
- release/builder-debug.yml
- release/builder-effective-config.yaml
- release/legacy-ai-writer/

常用命令：

- 正常打包：npm run package:win
- 仅归档旧 AI-Writer 产物：node build/package-win.mjs --archive-legacy-only
- 仅校验 plot runtime：node build/package-win.mjs --verify-only

判断标准：

- 看到 AI-Office 前缀，属于当前版本产物。
- 看到 AI-Writer 前缀，属于历史版本产物，应进入 legacy-ai-writer 归档目录。