# Providers, accounts and costs

Open **Settings** in the installed Studio panel. Codex and BB share this setup interface. You can inspect the workspace and editable examples before connecting optional services.

## Choose an execution engine

Under **Execution engine**, choose **Codex** or **Claude Code**, then check readiness. This choice applies to new production jobs. Existing jobs retain their original engine and session; changing a setting does not move or relaunch them.

Install the official CLI you choose on the computer or server running Studio, and use your own account. The protected runtime setup page offers explicit official sign-in actions:

```sh
codex login --device-auth
claude auth login --claudeai
```

You can also run the appropriate command directly on that execution host. Opening Settings or a setup page does not start login or inference. For a server, complete the official authorization link in your browser; Claude's CLI may try to open a browser on the server. Password, two-factor authentication and account consent remain yours to complete. A completed login process and an authenticated runtime check are separate results.

Codex uses ChatGPT subscription authentication through `codex app-server --stdio`. Claude mode uses **your own subscription with the unmodified official Claude Code CLI**. It accepts official `sonnet` and `opus` aliases; the actual native model is recorded at execution. A listed alias does not prove your account's entitlement until a run succeeds. Claude mode rejects injected API keys, OAuth tokens, custom endpoints and third-party providers; it ignores project and user settings for its invocation. Neither mode offers a general API-key model runtime or silently switches providers.

Production executors start in the owned job directory with Full access and no interactive approval prompt; that directory is not a filesystem sandbox. Use a trusted installation and an isolated library while evaluating it. Optional remote setup requires an already provisioned server; see [configuration](configuration.md#optional-remote-execution).

## Capability and cost matrix

| Component | What Studio supports | Account or setup | Cost boundary |
| --- | --- | --- | --- |
| Codex executor | New production jobs through the official CLI; saved native job identity and reconciliation | Your ChatGPT-authenticated Codex CLI on the execution host | Your existing plan and its limits; no hidden API-key fallback |
| Claude Code executor | New production jobs through the official CLI; explicit terminal resume and read-only receipt reconciliation | Your own Claude subscription and official CLI sign-in | Your subscription and its limits; no API billing adapter |
| Local renderer | Code-based HTML/GSAP/Three.js compositions, HyperFrames and FFmpeg | Node, FFmpeg, `ffprobe`, and the chosen template's dependencies | Local compute or your server costs; dependencies retain their licenses |
| Images and footage | Supplied media and editable graphics; separately available host tools may be used when explicitly configured | Assets you have the right to use, or your chosen host tool | No automatic image provider or included generation credit; external tools can charge separately |
| Azure Speech | Voice catalog, samples and full-script narration saved as WAV; optional word timings and project attachment | Your Azure Speech resource, region and key, or supported host authentication | Azure usage is billed separately; generating narration is an explicit paid operation |
| DataForSEO | Bounded YouTube Google Trends and YouTube search-result research, cached receipts and budget checks | Your API login and password; independent of Codex/Claude selection | DataForSEO requests are billed separately; review the plan and budget before requesting research |
| Telegram | Bot/destination permission checks and an explicit video send action | Your bot token and exact destination; bot must be allowed to post | No Reel Studio service fee; your infrastructure and any provider terms apply |
| YouTube OAuth | Desktop OAuth authorization, refresh, channel identity and access checks | Your own Google OAuth Desktop client and channel consent | Your Google project, quotas and applicable terms; no included upload service |
| YouTube API helpers | Resumable upload, progress and video-read primitives in source | Channel grant plus a separately integrated upload workflow | OAuth success does not establish panel upload readiness or public visibility |
| Browser publishing / export | Scoped handoffs for YouTube, TikTok and Instagram, or media/copy export | Compatible host browser control and your existing account session; export needs no social login | Any host/service costs remain yours; a handoff or export is not publication |

Prices and plan entitlements can change. Studio is not a reseller of subscriptions, model access or provider credits. No HeyGen account is required by the renderer. There is no bundled ElevenLabs or Instagram OAuth setup.

## Connect optional services without editing credential files

Under **Voice and research** or **Publishing connections**, choose a service's setup button. Studio opens a protected loopback page outside the chat and panel. Enter credentials there, save, then use **Check connection**. Do not paste credentials into a chat, issue or production brief.

- **Azure:** enter the Speech subscription key and region. A catalog check does not synthesize audio. Choose an eligible voice in **Narration preview**, enter the full script (up to 5,000 characters), and explicitly generate. Listen before attaching the completed result in the project's narration controls. An unresolved request must be reconciled using the same request identity; it is not automatically submitted again. Narration audio is an input to the film, not a completed video.
- **DataForSEO:** enter the API login and password. The connection check reads account access. Actual research is a separate, budgeted request. Saved credentials allow this route with either executor; a Codex app grant is not required for the direct route.
- **Telegram:** enter the bot token and exact numeric chat ID or channel handle. The check reads bot identity, destination and posting permissions without sending a message. An explicit publication action still requires the approved video and exact target.
- **YouTube:** enter your Google Desktop OAuth client ID and optional client secret, then choose **Authorize your YouTube channel**. Consent requests upload and read scopes. Confirm the exact channel after returning. Studio pins that channel and checks it again when refreshing access. OAuth connection does not automatically upload a film; use a supported browser handoff or export unless you have separately integrated the upload helpers. Google project review, quota and visibility restrictions may still apply.

Saved secrets stay on the Studio execution host at `<Studio home>/private-connections/credentials.json`. Studio creates the directory with mode `0700` and the file with mode `0600`. **This is a private plaintext file protected by filesystem permissions, not encrypted storage or an OS keychain.** Restrict access to the host and its backups. Official CLI authentication stays in the CLI's own store; Studio does not copy its tokens into this file.

Setup links include an ephemeral capability for the running server. Keep the full link private and reopen it from the current panel if it expires. The HTTP listener is loopback-only. The SSH relay forwards protected setup pages to the client; it does not copy credentials between hosts or expose a public setup endpoint.

Removing saved credentials can reveal an existing environment fallback. If a service still appears configured, check the server's environment as well. Advanced authentication and environment variable names are in [configuration](configuration.md#advanced-provider-configuration). A configured status means presence; a successful check means the stated read succeeded at that time. Neither proves synthesis quality, delivery or a public post.
