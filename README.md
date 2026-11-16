# Reel Studio

Reel Studio is an open-source workspace for planning and producing short videos, by Alex Yarosh. Organize drafts, editable templates, immutable video versions, account connections, and approval and publication records in one place.

Reel Studio **v0.3.1 is beta software**. It includes a Codex MCP App and a native BB adapter. Host installation, generation and publishing depend on your environment; see [host compatibility](docs/hosts.md). Public documentation and interface text are in English.

## Get started

You need Node.js 22 or later, npm, and FFmpeg with `ffprobe` on your `PATH`. Generation uses an authenticated Codex CLI. The editable examples also require Python 3. Keep credentials and personal media outside this repository.

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

The local preview uses a temporary library so you can explore the interface without opening an existing production library. It does not verify generation or an external integration. See [getting started](docs/getting-started.md) for installation, configuration and release commands.

## What you can do

- Save briefs, reuse templates, run Codex production jobs, and review video versions.
- Keep approvals tied to an exact video, publication copy and destination.
- Prepare browser publishing handoffs for YouTube, TikTok and Instagram through a compatible authenticated host.
- Use the Azure Speech voice catalog and speech samples with your own Azure configuration.
- Export approved media and copy. A Telegram send implementation is available with host-configured bot credentials and an exact destination.

These are implementation boundaries, not a claim that your accounts are connected. There is no bundled YouTube OAuth setup, universal publishing provider, or automatic account sign-in. See [configuration and integration limits](docs/configuration.md). Verify a public post at its destination; a saved record or a sent handoff is not proof of publication.

## How it fits together

The shared React studio and its MCP App live in `packages/studio`. Codex embeds the app using host appearance styles. `packages/bb` contains a native BB adapter built with `@get-bb/plugin-sdk`. Shared changes are built and synchronized from one source; the synchronization process checks for conflicting target edits. See [architecture](docs/architecture.md).

## Editable examples

Start with [Kinetic Promo](examples/kinetic-promo/README.md) for moving typography or [Portfolio Showreel](examples/portfolio-showreel/README.md) for layouts and camera transitions. Both contain fictional content, editable source and dependency notices.

The [Paper Worlds Science recipe](examples/paper-worlds-science/README.md) adds sanitized V5 design constraints for layered science explanations. It is a design brief, not an executable composition, and contains no film media or account configuration.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Owner-authored code is available under the [MIT License](LICENSE); third-party components retain their own terms. The repository does not include personal finished videos.

If Reel Studio is useful to you, please [star the repository](https://github.com/offflinerpsy/reel-studio).
