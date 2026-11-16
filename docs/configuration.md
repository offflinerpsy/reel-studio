# Configuration and integrations

Start with the [local preview](getting-started.md) to inspect the interface. Installation does not connect accounts, migrate a library or provision a remote worker. Configure real work in the environment that starts the Studio server.

## Settings

Open **Settings → Deployment** to see the currently serving host, runtime, data folder and plugin folder. These active facts are separate from the preferences for your next launch.

1. Choose **Local computer** or **Remote server over SSH**. Enter absolute local data/plugin paths and, for SSH, the existing host alias, remote data/plugin paths and remote Node executable.
2. Select **Save installation preferences**. Studio saves private preferences in `installation-settings.json` inside the current server's data folder. Saving does not move projects, change this connection, sign in or start a worker.
3. Select **Prepare setup commands**. Studio returns a launch command and, for SSH, creates private `installation-setup/remote.json` on the server currently serving Studio.
4. Apply the generated launch environment in your host's MCP configuration, then reconnect Reel Studio. If the setup JSON was created on a remote server, copy it privately to the client and adjust `REEL_REMOTE_CONFIG` to its absolute client path. Local paths must refer to that client.

Preferences and exported JSON contain installation references, not raw tokens. The Telegram destination field prepares an exact target reference; it does not set environment variables. Configure credentials securely in the environment of the server that performs the action. The SSH relay passes the selected remote data folder to the remote server and does not transfer credentials from your client.

## Local execution

The default runtime starts `codex app-server --stdio` on the same host as the server. It uses that host's existing Codex authentication. Set `CODEX_BIN` to an executable path if Codex is not available on `PATH` or in `~/.local/bin/codex`.

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

The relay keeps the interface local while tools and media use Studio on the remote Linux server. It requires existing SSH access and compatible builds on both ends. A separately started Mac worker is needed only for jobs routed back to the Mac; configuring the relay does not start that worker. Paths on the remote server must be normalized POSIX paths using letters, digits, underscores, periods, hyphens and slashes. The configuration parser rejects unknown fields. Credentials are not copied between hosts. A missing or unhealthy route stops work; it does not silently start the job elsewhere. Existing jobs retain their original route.

This implementation does not establish general host compatibility. Test your exact topology in an isolated library before using production data. See [host compatibility](hosts.md).

## Main chat

In Codex, **Settings → Main chat** shows **Current host chat**. Commands return to the chat where you opened Studio; this plugin cannot list or select another Codex chat. Open Studio in the desired chat to use that destination. The command chat is separate from a production job's assigned computer.

In BB, open **Main chat** in the native panel. Choose **Computer or server → Project → Main chat**, then select **Use this chat**. Eligible destinations are existing Codex chats on connected, active local or remote computers. BB verifies the chat, project, workspace, host and destination fingerprint when binding and before a handoff. Choosing or binding creates no chat and sends no task; a prepared request is sent only through an explicit Studio action.

The choice lasts for the panel session. Use **Change main chat** to choose another destination; earlier requests remain tied to their original chat. Browser access, the signed-in account and approved media must already be available in the receiving chat's environment. Selecting a remote chat does not transfer them, configure the browser or verify publication.

## Services and publication

| Service or action | Public implementation | Required configuration and limits |
| --- | --- | --- |
| Codex production | Starts jobs through the local or explicitly configured runtime. | Existing Codex authentication and compatible CLI; rendering also needs the selected template's dependencies. |
| Azure Speech | Reads the voice catalog and creates speech samples using the Azure Speech SDK. | Your Azure Speech resource and credentials. The standard sample route accepts eligible catalog voices; an HD voice does not automatically enable an HD route. |
| YouTube, TikTok and Instagram | Prepares scoped browser handoffs and records observations/results. | A compatible host with supported browser control and an existing authenticated account. Preparing a handoff does not upload a video. |
| Telegram | Contains a direct Bot API send action and manual export; browser publishing is not implemented. | Set `REEL_TELEGRAM_BOT_TOKEN` and `REEL_TELEGRAM_CHAT_ID` on the server process, then reconnect. The requested target must match exactly, and the bot needs permission to post. Verify the destination after a send. |
| Export | Packages a selected version and its platform copy. | An export does not publish or authenticate an account. |

YouTube and Instagram API helper code is included, but a bundled OAuth flow and an end-to-end API publishing setup are not provided. There is no built-in HeyGen or ElevenLabs account setup. A provider or voice name saved in a production profile is recipe data, not evidence that the service is connected.

Use **Settings → YouTube and Telegram setup** for the current setup guidance, then add the exact destination in Connections. YouTube supports an existing browser session or **Export only**; verify or sign in on the computer that will operate the browser. Telegram shows credential presence and the active environment target without exposing the token. Credential presence does not verify access or delivery.

For Azure Speech, the simplest environment configuration uses `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. The implementation also accepts an Entra token (`AZURE_SPEECH_AAD_TOKEN`), Azure CLI authentication (`AZURE_SPEECH_USE_AZURE_CLI=1`), or managed identity (`AZURE_SPEECH_USE_MANAGED_IDENTITY=1`) where supported by your resource and host. A host-local configuration file can be selected with `AZURE_SPEECH_CONFIG_PATH`; its default is `~/.config/reel-studio-speech.json`. Resource identity and access must match your selected authentication method. Speech generation can incur Azure charges under your account.

Keep secrets in host configuration, outside Git, screenshots and issue reports. After any uncertain external action, reconcile the same attempt and destination before retrying. A stored approval, a dispatched prompt and a successful HTTP response each describe different stages; only destination readback establishes the actual publication result.
