# Configuration and integrations

Start with the [local preview](getting-started.md) to inspect the interface. Installation does not connect accounts, migrate a library or provision a remote worker. Open **Settings** for executor selection, protected provider setup and readiness checks. The [provider and cost guide](provider-setup.md) describes this recommended onboarding path. Configure real work on the host that starts the Studio server.

## Settings

Open **Settings → Advanced installation settings → Deployment** to see the currently serving host, runtime, data folder and plugin folder. These active facts are separate from the preferences for your next launch.

1. Choose **Local computer** or **Remote server over SSH**. Enter absolute local data/plugin paths and, for SSH, the existing host alias, remote data/plugin paths and remote Node executable.
2. Select **Save installation preferences**. Studio saves private preferences in `installation-settings.json` inside the current server's data folder. Saving does not move projects, change this connection, sign in or start a worker.
3. Select **Prepare setup commands**. Studio returns a launch command and, for SSH, creates private `installation-setup/remote.json` on the server currently serving Studio.
4. Apply the generated launch environment in your host's MCP configuration, then reconnect Reel Studio. If the setup JSON was created on a remote server, copy it privately to the client and adjust `REEL_REMOTE_CONFIG` to its absolute client path. Local paths must refer to that client.

Preferences and exported JSON contain installation references, not raw tokens. The advanced Telegram destination field prepares an exact launch reference; use **Publishing connections** to save and verify the running server's bot credentials. The SSH relay passes the selected remote data folder to the remote server and does not transfer credentials from your client.

## Local execution

The selected executor runs on the same host as the Studio server. Codex starts `codex app-server --stdio` with that host's ChatGPT authentication. Claude uses the unmodified official Claude Code CLI and your own subscription. Select the engine in Settings; existing jobs keep their original engine. Set `CODEX_BIN` or `CLAUDE_BIN` to an executable path when needed. The protected login actions require the corresponding official command to be available as `codex` or `claude` on the server's `PATH`; otherwise sign in directly with the selected executable.

The default Studio library is `~/.local/share/reel-studio`. The BB adapter defaults to `~/.local/share/reel-studio-bb`. Set `REEL_STUDIO_HOME` on the server process to select a different library. Use a new directory for evaluation: an existing directory can contain projects, account bindings, paused producers and uncertain publication attempts. The preview command selects a temporary directory for you.

## Optional remote execution

The SSH relay is an advanced, explicitly configured route. It is not required for local use. Set `REEL_REMOTE_CONFIG` to a normalized absolute path to a JSON configuration file outside the repository. Its supported fields are:

| Field | Meaning |
| --- | --- |
| `sshHost` | An existing SSH hostname or `user@hostname`, without shell options. |
| `remoteHome` | Absolute Studio data path on the remote server. |
| `remotePlugin` | Absolute Studio package path on the remote server. |
| `remoteNode` | Absolute Node executable path on the remote server. |
| `localHome` | Optional local worker data path; defaults to `~/.local/share/reel-studio-worker`. |
| `localPlugin` | Optional local Studio package path; defaults to the running package. |
| `codexBinary` | Optional absolute Codex executable path for the local worker. |

The relay keeps the interface local while tools and media use Studio on the remote Linux server. It requires existing SSH access and compatible builds on both ends. The executor and optional service credentials must be configured on that remote execution host. Protected setup links use an owned SSH loopback forward so your client browser can reach the remote setup page; credentials remain on the server. A separately started Mac worker is needed only for jobs routed back to the Mac; configuring the relay does not start that worker. Existing managed compute routes retain their admitted executor and authority; the ordinary engine selector does not migrate them. Paths on the remote server must be normalized POSIX paths using letters, digits, underscores, periods, hyphens and slashes. The configuration parser rejects unknown fields. A missing or unhealthy route stops work; it does not silently start the job elsewhere. Existing jobs retain their original route.

This implementation does not establish general host compatibility. Test your exact topology in an isolated library before using production data. See [host compatibility](hosts.md).

## Main chat

In Codex, **Settings → Main chat** shows **Current host chat**. Commands return to the chat where you opened Studio; this plugin cannot list or select another Codex chat. Open Studio in the desired chat to use that destination. The command chat is separate from a production job's assigned computer.

In BB, open **Main chat** in the native panel. Choose **Computer or server → Project → Main chat**, then select **Use this chat**. Eligible destinations are existing Codex chats on connected, active local or remote computers. BB verifies the chat, project, workspace, host and destination fingerprint when binding and before a handoff. Choosing or binding creates no chat and sends no task; a prepared request is sent only through an explicit Studio action.

The choice lasts for the panel session. Use **Change main chat** to choose another destination; earlier requests remain tied to their original chat. Browser access, the signed-in account and approved media must already be available in the receiving chat's environment. Selecting a remote chat does not transfer them, configure the browser or verify publication.

## Services and publication

See the [capability and cost matrix](provider-setup.md#capability-and-cost-matrix) for supported account connections and their limits. Protected setup pages are the primary path for Azure Speech, DataForSEO, Telegram and YouTube Desktop OAuth. Saved credentials are private plaintext files with restricted permissions, not encrypted or keychain storage. A provider or voice name in a production profile is recipe data, not connection evidence.

YouTube OAuth provides channel authorization and identity checks. Resumable-upload helpers exist in source, but the panel does not provide a complete API upload workflow. Instagram API primitives also exist without bundled Instagram OAuth onboarding. YouTube, TikTok and Instagram browser handoffs require a compatible host and an existing account session on the computer performing publication. Manual export remains available. Preparing a handoff does not upload a video.

After any uncertain external action, reconcile the same attempt and destination before retrying. A stored approval, a dispatched prompt and a successful HTTP response describe different stages; destination readback establishes the publication result.

## Advanced provider configuration

Existing server environment configuration remains supported. Saved protected-page credentials take precedence for that service; removing them can reveal environment fallback. Keep secrets outside Git, screenshots and issue reports.

| Service | Environment fallback |
| --- | --- |
| Azure Speech key | `AZURE_SPEECH_KEY` or `AZURE_COGNITIVE_SERVICES_KEY`, with `AZURE_SPEECH_REGION` |
| DataForSEO | `DATAFORSEO_LOGIN` / `DATAFORSEO_API_LOGIN` and `DATAFORSEO_PASSWORD` / `DATAFORSEO_API_PASSWORD` |
| Telegram | `REEL_TELEGRAM_BOT_TOKEN` and `REEL_TELEGRAM_CHAT_ID` |

Azure also supports an Entra token (`AZURE_SPEECH_AAD_TOKEN`), Azure CLI authentication (`AZURE_SPEECH_USE_AZURE_CLI=1`), or managed identity (`AZURE_SPEECH_USE_MANAGED_IDENTITY=1`) where supported by the resource and host. A host-local configuration file can be selected with `AZURE_SPEECH_CONFIG_PATH`; its default is `~/.config/reel-studio-speech.json`. Resource identity and access must match the chosen authentication method. Explicit invalid saved credentials do not borrow a different host identity.

The narration UI uses eligible standard Azure voices; a catalog HD voice does not automatically enable an HD route. The backend has an explicit DragonHD route with separate control validation. SDK narration can retain word timings; the REST route does not fabricate timings. Listen to the saved audio and review its timing in the film before approval.
