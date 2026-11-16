# Reel Studio

Reel Studio is an open-source workspace for planning and producing short videos, by Alex Yarosh. Organize drafts, editable templates, immutable video versions, account connections, and approval and publication records in one place.

Reel Studio is **beta software**. Version 0.4.0 adds a shared setup interface for Codex and BB, your own Codex or Claude Code executor, and optional voice, research and publishing connections. Host installation, generation and publishing depend on your environment; see [host compatibility](docs/hosts.md). Public documentation and interface text are in English.

Recommended download: **[0.4.1 beta](https://github.com/offflinerpsy/reel-studio/releases/tag/v0.4.1)**, with fixes from independent security, concurrency and clean-install testing.

## Get started

You need Node.js 22 or later, npm, and FFmpeg with `ffprobe` on your `PATH`. Production jobs use your own authenticated official Codex or Claude Code CLI on the execution host. The editable examples also require Python 3. Keep credentials and personal media outside this repository.

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

The local preview uses a temporary library so you can explore the interface without opening an existing production library. It does not verify generation or an external integration. After installing a host integration, open **Settings** to choose an executor and connect optional services through protected setup pages. See [getting started](docs/getting-started.md) and the [provider and cost guide](docs/provider-setup.md).

## What you can do

- Save briefs, reuse templates, run production jobs with your selected CLI, and review video versions.
- Keep approvals tied to an exact video, publication copy and destination.
- Prepare browser publishing handoffs for YouTube, TikTok and Instagram through a compatible authenticated host.
- Generate full-script Azure narration, listen to the saved audio, and attach a completed narration to a project before generation.
- Connect your own DataForSEO account for bounded YouTube search research independently of the selected executor.
- Export approved media and copy, or explicitly send a video to a configured Telegram destination.
- Connect a YouTube channel using your own Google Desktop OAuth client; API upload helpers are included, with the limits below.

Rendering uses editable HTML, GSAP and Three.js compositions, HyperFrames and FFmpeg. It does not require HeyGen. Image generation is not automatically provided by either executor: use supplied assets or a separately available host tool. Azure and DataForSEO can incur separate charges under your accounts.

The YouTube connection flow identifies and checks a channel; it does not establish an end-to-end upload workflow in the panel. Browser handoffs depend on a compatible authenticated host. These are source capabilities, not proof that your services are connected or that native host acceptance has passed for this release. See [configuration and integration limits](docs/configuration.md). Verify a public post at its destination; a saved record or a sent handoff is not proof of publication.

## How it fits together

The shared React studio and its MCP App live in `packages/studio`. Codex embeds the app using host appearance styles. `packages/bb` contains a native BB adapter built with `@get-bb/plugin-sdk`. Shared changes are built and synchronized from one source; the synchronization process checks for conflicting target edits. See [architecture](docs/architecture.md).

## Editable examples

Start with [Kinetic Promo](examples/kinetic-promo/README.md) for moving typography or [Portfolio Showreel](examples/portfolio-showreel/README.md) for layouts and camera transitions. Both contain fictional content, editable source and dependency notices.

The [Paper Worlds Science recipe](examples/paper-worlds-science/README.md) adds sanitized V5 design constraints for layered science explanations. It is a design brief, not an executable composition, and contains no film media or account configuration.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Owner-authored code is available under the [MIT License](LICENSE); third-party components retain their own terms. The repository does not include personal finished videos.

You can fork and develop your own version, report an issue or propose a pull request. Maintainers review what enters this repository; support is best effort. When sharing or reusing changes, preserve the applicable license and copyright notices. See the [testing guide](docs/testing.md) for verification expectations.

If Reel Studio is useful to you, please [star the repository](https://github.com/offflinerpsy/reel-studio).
