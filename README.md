<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/wordmark-dark.svg">
    <img src="docs/media/wordmark-light.svg" alt="Reel Studio" width="340">
  </picture>
</p>

<h3 align="center">Build short videos from code, inside your coding chat.</h3>

<p align="center">
  Describe the video. Edit its source. Render an MP4.<br>
  A panel for <strong>Codex and BB</strong>, with your own <strong>Codex or Claude Code CLI</strong> as the executor.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="docs/media/project-status.svg" alt="MIT license · Node.js 22 or newer · Public beta" width="316">
</p>

<p align="center">
  <a href="https://github.com/offflinerpsy/reel-studio/releases/tag/v0.4.1"><img src="docs/media/link-download.svg" alt="Download the 0.4.1 beta" width="172"></a>
  &nbsp;
  <a href="#get-started"><img src="docs/media/link-start.svg" alt="Quick start" width="172"></a>
  &nbsp;
  <a href="#start-with-a-format"><img src="docs/media/link-templates.svg" alt="See editable templates" width="172"></a>
</p>

## How video is made

Reel Studio is an open-source workspace for video production. Each film is an editable HTML composition: layout, typography, animation, timing and media references live in source files.

1. **Write a brief.** Choose a format and add images, footage or audio you have the right to use.
2. **Your official CLI edits the source.** Codex or Claude Code authors the HTML composition, animation and supporting assets, using GSAP and Three.js where needed.
3. **HyperFrames renders; FFmpeg prepares the MP4.** HyperFrames renders the HTML motion into video; FFmpeg checks the encoded video and combines it with supplied audio. Rendering runs on your computer or a configured server.
4. **Review and export.** Check picture and sound, keep versions, then export the film and publication copy or use a supported publishing handoff.

No manual timeline editing in a graphical video editor is required. Graphics can be drawn in code or supplied as files. The AI edits source; rendering uses your compute, with no paid video-generation API or HeyGen account required.

## What you need

| Requirement | Purpose |
| --- | --- |
| Compatible **Codex or BB** host | Opens the Studio panel. Claude Code is an executor, not a panel host. |
| Your own **official Codex or Claude Code CLI**, installed and signed in where Studio runs | Authors and edits production projects through your account and plan. |
| **Node.js 22+ and npm** | Runs Studio and installs dependencies. |
| **Python 3** | Runs the bundled starter builders. |
| **FFmpeg and ffprobe**, plus the template's runtime and dependencies | Follow each example's setup for HyperFrames, libraries and fonts. |
| A brief, plus any media your film needs | Use your own text, images, footage or audio. Typography-only videos can use code and the template's fonts. |

No AI subscriptions or provider credits are bundled. You supply your CLI plan, compute and any optional services. See [accounts and costs](docs/provider-setup.md) and [host compatibility](docs/hosts.md).

## Get started

To explore the interface from source with Node.js 22+ and npm:

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm run preview
```

**This isolated preview only demonstrates the interface. Production and publication are disabled.** It does not render films or verify your host installation.

For production, [install the Codex or BB integration](docs/getting-started.md#install-a-host-integration), open **Settings**, sign in to your executor and install the format's dependencies. Start with a separate test library. The interface and technical docs are in English.

**[Full installation guide](docs/getting-started.md)** · **[Configure your accounts](docs/provider-setup.md)** · **[Host limits](docs/hosts.md)**

## Start with a format

| Built-in format | Editable source |
| --- | --- |
| [Kinetic Promo](examples/kinetic-promo/README.md) | Bold typography, rhythmic scenes and dimensional backgrounds. |
| [Portfolio Showreel](examples/portfolio-showreel/README.md) | Layouts, page motion, branding and camera transitions. |

Both formats include builders and fictional content. Their panel previews are illustrative cards; finished template demo videos are not bundled. Add your content and render your version.

[Paper Worlds Science](examples/paper-worlds-science/README.md) is a separate design recipe, **not an executable template**. Each example documents dependencies and third-party licenses.

## Connect only what you need

| Job | Available path |
| --- | --- |
| Narration | Supply audio, or connect your Azure Speech resource to generate a WAV and attach it to the project. |
| Publication research | Optional DataForSEO connection with a bounded request budget. |
| Delivery | Export media and copy, explicitly send through your Telegram bot, or use a supported browser publishing handoff. |

Azure and DataForSEO bill your accounts separately. Configured image tools have their own terms and charges. See [provider setup](docs/provider-setup.md).

<details>
<summary>Current beta scope</summary>

Reel Studio is **0.4.1 public beta**. Host installation, sign-in and production depend on your environment. Local and configured-server rendering do not establish compatibility with every host.

YouTube OAuth checks a channel; a complete panel API-upload workflow is not available. Use supported browser handoffs or export.

Installation does not migrate existing private production data. Preserve libraries and settings. See [configuration](docs/configuration.md), [architecture](docs/architecture.md) and [updates](docs/getting-started.md#update-deliberately).

</details>

## Build it with us

Found a bug or have a better way to do something? **[Open an issue](https://github.com/offflinerpsy/reel-studio/issues/new/choose)** or **[send a pull request](CONTRIBUTING.md)**.

Forks, fixes and new formats are welcome. Maintainers review contributions; support is best effort. Preserve applicable license and copyright notices.

**[Contributing](CONTRIBUTING.md)** · **[Testing](docs/testing.md)** · **[Security](SECURITY.md)**

---

Created by **Alex Yarosh**. Owner-authored code is [MIT licensed](LICENSE); third-party components retain their own terms.

If Reel Studio is useful to you, please **[star the repository](https://github.com/offflinerpsy/reel-studio)**.
