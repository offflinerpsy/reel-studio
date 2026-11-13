# Reel Studio

Reel Studio is an open-source workspace for planning and producing short videos, by Alex Yarosh. It brings drafts, reusable templates, video versions, connections, and approval and publication records into one studio.

[Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

The project is **beta**. Review media, permissions, and destination details before publishing. A record in the studio is not proof that a platform published a video. Host capabilities and integrations differ; see [host compatibility](docs/hosts.md).

## Get started

You need Node.js 22 or later and FFmpeg with `ffprobe` available on your path. Real generation also requires Codex authentication and any credentials required by the chosen integrations. Keep credentials and personal media out of the repository.

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

The local preview uses isolated data so you can explore the interface without connecting production records. See [getting started](docs/getting-started.md) for packaging and synchronization commands.

## How it fits together

The shared React studio and its MCP App live in `packages/studio`. Codex embeds the app using host appearance styles. `packages/bb` contains a native BB adapter built with `@get-bb/plugin-sdk`. Shared changes are built and synchronized from one source; the synchronization process checks for conflicting target edits. See [architecture](docs/architecture.md).

Video versions are immutable. Drafts and templates are editable, and the studio can keep connection, approval, and publication records. An external action still needs confirmation from the destination itself.

## Editable examples

Start with [Kinetic Promo](examples/kinetic-promo/README.md) for moving typography or [Portfolio Showreel](examples/portfolio-showreel/README.md) for layouts and camera transitions. Both contain fictional content, editable source and dependency notices.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Owner-authored code is available under the [MIT License](LICENSE); third-party components retain their own terms. The repository does not include personal finished videos.
