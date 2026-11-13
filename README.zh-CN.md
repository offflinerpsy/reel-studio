# Reel Studio

Reel Studio 是由 Alex Yarosh 创建的开源短视频策划与制作工作台。它将草稿、可复用模板、视频版本、连接以及审核和发布记录集中在一起。

[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md)

项目目前处于 **Beta** 阶段。发布前请检查视频、使用权限和目标平台。工作台中的记录本身不能证明平台已经发布视频。不同宿主和集成的功能有所差异，详见英文[宿主兼容性说明](docs/hosts.md)。

## 开始使用

需要 Node.js 22 或更高版本，以及可通过命令路径访问的 FFmpeg 和 `ffprobe`。实际生成还需要 Codex 身份验证以及所选集成服务要求的凭据。请勿将凭据或个人视频放入仓库。

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

本地预览使用隔离数据。打包和同步命令见英文[入门指南](docs/getting-started.md)。

共享的 React 工作台和 MCP App 位于 `packages/studio`；Codex 使用宿主的外观样式嵌入应用。`packages/bb` 是基于 `@get-bb/plugin-sdk` 的原生 BB 适配器。构建和同步使用同一份源码，并检查目标文件的冲突。详见[架构说明](docs/architecture.md)。

视频版本不可变；草稿和模板可以编辑。外部操作仍需由目标平台确认。

参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题报告方式见 [SECURITY.md](SECURITY.md)。作者编写的代码采用 [MIT 许可证](LICENSE)；第三方组件遵循各自条款。仓库不包含个人成片。
