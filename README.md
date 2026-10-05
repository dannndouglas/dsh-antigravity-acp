# dsh-antigravity-acp

Use Google's **official Antigravity ACP server** as a **primary text model
provider** in DeepSeek Harness. Authentication is delegated to the official server's `oauth-personal`
method. No API key is configured in this plugin.

**Install in DSH and chat.** The plugin automatically downloads Google's official
server when needed and selects Antigravity as the default for new chats. No binary
installation, environment variable, configuration file or login command is needed.
If your account is not already authorized, the official server opens the browser
on your first message; approve Google's login and the conversation continues.

**Version 0.2 is a text/reasoning backend. It cannot execute DSH tools.** ACP
exposes a complete agent, not a raw LLM API; native ACP tool activity is rejected
rather than represented as DSH tool calls. DSH owns its conversation, UI and
context; its coding tools and MCP are unavailable through this route.

[Português](docs/README.pt-BR.md) · [Architecture](docs/architecture.md) ·
[Real probe](docs/agy-acp-probe.md) · [Research](docs/research.md)

```text
DSH primary LlmAdapter → ACP v1 / JSON-RPC / stdio
                     → official agy_acp_server → Google Antigravity
```

## Requirements

- Node.js **22.19 or newer** (tested with 22.22.0).
- DSH **0.2.1-alpha.1**, Cordis 4.0.5-alpha.1. Peer versions are intentionally
  pinned to the inspected and tested DSH release. Older releases are unverified.
- Internet access for automatic installation of Google's official ACP server. Tested on Windows x64
  with **1.3.0**. Fake-server CI covers Windows, macOS and Linux.
- A Google account accepted by the official server. Credentials stay in its
  own storage; the plugin never reads that storage.

This plugin is independent of Google and DeepSeek. The official server and
account remain subject to [Google's terms](https://antigravity.google/terms).
Using an official binary establishes a transport boundary; it does not establish
permission under account/service terms.

## Install and use

```sh
dsh plugin --profile web add git+https://github.com/dannndouglas/dsh-antigravity-acp.git
```

The package's `dsh.bundle.patch` mounts `llm-antigravity-acp` automatically.
Open that DSH profile and send a message. No terminal setup is needed after adding
the plugin. Existing running profiles may need their normal reload/restart.
The installation requires its normal `llm` and
`subprocess` services, and does not edit DSH core or a global installation.
The built `dist/` is committed so Git installations do not need a TypeScript
compiler. For a local checkout:

```sh
npm ci
npm run build
npm pack
dsh plugin --profile web add /absolute/path/to/dsh-antigravity-acp-0.2.0.tgz
```

## Automatic server and login

The first model lookup or message checks for an existing server and otherwise
downloads the **complete, unmodified** 1.3.0 archive directly from `dl.google.com`,
using the six URLs in the [official ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json).
Windows, macOS and Linux on x64/arm64 are supported. The first download can take
a few minutes. Its versioned cache lives in `$DSH_HOME/cache/antigravity-acp` when
DSH provides that variable, or `~/.cache/dsh-antigravity-acp` otherwise. Later
launches reuse it without another download; chat still needs Google connectivity.
There is no npm postinstall script, administrator requirement or bundled Google binary.

Downloads use HTTPS with normal certificate validation and reject redirects.
ZIP extraction rejects unsafe paths, symlinks and oversized archives. A complete
cache is published atomically and incomplete downloads are removed. No upstream
checksum is advertised by the Registry; authenticity relies on the pinned Google
HTTPS origin, rather than an invented vendor checksum.

Google authorization happens automatically on the first message that requires
it. It remains a browser consent flow owned by the official server; the plugin
cannot approve your Google account for you. Credential reuse is server-owned.
Model discovery does not open a login browser in the background.

The bundle sets `agent-default-model` to `antigravity-acp/server-default`, so fresh
chats work without selecting a model. Explicit saved profile/session choices
still take precedence. You can optionally choose another announced model in
DSH's normal model picker. Models come from ACP `configOptions`, not a private API.

For advanced diagnostics only, the checkout provides these optional commands:

```sh
node dist/cli.js status
node dist/cli.js doctor
node dist/cli.js probe
```

The installed package also exports the `dsh-antigravity-acp` command with
`login`, `status`, `doctor`, `logout`, and `probe`. `npm run auth` and
`npm run probe` also support automatic installation. The optional login command calls `initialize`, checks
the advertised method, then asks **the official server** to authenticate.
Complete its browser flow if needed. No callback/token copy is requested.

The standalone CLI needs the optional `@deepseek-ai/dsh-subprocess-local` peer
supplied by DSH or by this checkout's dev dependencies. Normal plugin activation
uses the host's injected `ctx.subprocess`; it does not install another local
runtime or native build scripts into a DSH profile.

`status`/`doctor` never initiate OAuth: they test authenticated session creation.
Generation authenticates only if the server replies with an authentication
requirement. Restarting DSH reuses whatever authenticated state the official
server already owns. `logout` uses the official ACP method only when announced;
it ends that server's account state and may affect other clients using it.

## Optional configuration

No configuration is required. Discovery order is `config.command`, `AGY_ACP_BIN`,
PATH, `~/.local/bin`, `~/.local/share/antigravity-acp`, then automatic installation.
An explicit override is authoritative; an invalid path fails instead of silently
downloading another executable. Linux servers receive the Registry's `--uid=` flag.

In the **profile's** `cordis.patch.yml`, target the already inserted row:

```yaml
- id: llm-antigravity-acp
  config:
    command: /absolute/path/to/agy_acp_server.par
    auth: oauth-personal
    provider: antigravity-acp
    toolPolicy: text-only
```

On Windows use a single-quoted path, for example
`command: 'C:\Tools\antigravity-acp\agy_acp_server.exe'`. Do not add another
`insert` with the same row ID. An id-targeted patch replaces `config`; the schema
fills omitted defaults.

| Option | Default | Meaning |
|---|---|---|
| `provider` | `antigravity-acp` | DSH provider route |
| `command` | empty | Official executable discovery |
| `autoInstall` | `true` | Download the official server automatically when none is found |
| `installTimeoutMs` | `180000` | Automatic download/extraction deadline |
| `args` | `[]` | Extra argv, never shell-interpreted |
| `auth` | `oauth-personal` | Only accepted authentication method |
| `defaultModel` | empty | Exact ACP model ID; empty uses server default |
| `models` | `[]` | Additional advertised IDs, still validated against server at generation |
| `toolPolicy` | `text-only` | Explicitly omit current DSH tool schemas; warn once. `reject` refuses requests carrying tools |
| `timeoutMs` | `600000` | Prompt wall-clock deadline |
| `requestTimeoutMs` | `30000` | Handshake/session/config deadline |
| `authTimeoutMs` | `600000` | Official browser authentication deadline |
| `cancelGraceMs` | `1500` | Bound for writing ACP cancel |
| `disposeGraceMs` | `3000` | EOF grace before managed process termination |
| `maxSessionsPerProcess` | `100` | Recycle between turns to bound retained ACP sessions |

## Why this does NOT use Antigravity private APIs

The plugin communicates only with a **local official subprocess** through ACP
stdio. Its only Google HTTP request downloads the official server archive.
It has no model-API client, OAuth implementation, token reader, or
credential persistence. All model/backend networking is performed by Google's
unmodified executable. This statement concerns **this plugin's source**; it does
not claim that Google's own binary uses only public HTTP endpoints internally.

`npm run check` scans `src/` and `dist/` for `v1internal`, `cloudcode`,
`refresh_token`, and `client_secret`, and rejects insecure TLS overrides.
Those names occur only in this explanation and the check script's denylist.
No credential values are included. The package allowlist excludes tests,
local runtime downloads and proprietary binaries.

## Known limitations

- **ACP Agent ≠ raw LLM provider.** No native DSH tool calls, tool-choice
  controls, or tool-call deltas. Existing tool results in DSH history are sent
  as text/JSON context, not executed again. Native ACP tool updates cause an
  explicit `ACP_NATIVE_TOOLS_UNSUPPORTED` error and reset the process.
- ACP permission modes are approval modes, not a tools-off switch. Every
  permission request is denied; filesystem/terminal capabilities are false;
  no MCP servers are supplied. Sessions use an empty temporary directory rather
  than the DSH workspace. This reduces ambient context but **is not an OS sandbox**
  and cannot guarantee that an agent does nothing before announcing activity.
- DSH system messages are serialized into the ACP user prompt. ACP has no
  separate raw-model system slot; the official agent's own instructions remain.
- Every generation creates a fresh ACP session and sends the full DSH history.
  No server history is replayed into DSH, so compaction and provider switching
  stay under DSH control. This trades server session reuse/caching for consistency.
- One prompt at a time per adapter connection. Calls queue; queued aborts do
  not cancel another session. Separate DSH processes do not share a cross-process
  account lock. Multiple accounts are outside v0.2.
- Reasoning text streams if the server sends `agent_thought_chunk`. ACP
  `usage_update` is context occupancy, **not billable per-request usage**; no
  fabricated usage is emitted. Token billing and unknown context capacity remain
  unreported. No image/audio input, persistent session resume, or settings UI.
- `temperature`, `maxTokens`, `stop`, and explicit `reasoningEffort` are rejected
  with `UNSUPPORTED_OPTION`; choose an exact server model variant instead.
- Cancellation sends the ACP **notification** `session/cancel`, then closes
  the connection and performs managed cleanup. The next turn reconnects; v0.2
  does not depend on undocumented cancellation acknowledgments.
- A cold model list can wait for the first automatic download and session/handshake deadlines. On failure,
  the selector offers `server-default` so the route remains discoverable, with
  a readable diagnostic. The first message starts browser authorization if needed.

## Troubleshooting

| Code / symptom | Action |
|---|---|
| `ACP_INSTALL_FAILED` | Check connectivity/free disk space and retry in DSH; installation retries automatically |
| `ACP_PLATFORM_UNSUPPORTED` | Automatic binaries are available for Windows/macOS/Linux x64 and arm64 |
| `ACP_BINARY_MISSING` | Remove a broken explicit override or re-enable `autoInstall` |
| `ACP_AUTH_REQUIRED` | Send a message and complete the browser authorization opened by the official server |
| `ACP_AUTH_UNSUPPORTED` | Verify this is the official server and it advertises `oauth-personal` |
| `ACP_VERSION_MISMATCH` | Use an official server supporting ACP v1 |
| `ACP_INVALID_MODEL` | Run `doctor`; use an exact announced ID |
| `ACP_INVALID_PARAMS` | Remove unsupported settings; check server compatibility |
| `ACP_TIMEOUT` / `ACP_DISCONNECTED` | Retry to reconnect; check connectivity and official server installation |
| `ACP_NATIVE_TOOLS_UNSUPPORTED` | Ask for conversational text; use another DSH provider for coding tools |
| `ACP_TEARDOWN_FAILED` | Restart the DSH profile; the process provider could not prove cleanup |
| `UNSUPPORTED_OPTION` | Remove sampling/reasoning controls unsupported by ACP |
| Windows Job runner exits before responding | Verify Node.js >=22.19; older Node lacks the DSH runner entry semantics |

Raw subprocess stderr and remote error data are drained without being logged
or retained, because they can contain authentication/account information.
The CLI prints only whitelisted protocol/account-status facts; it does not
display raw authentication frames.

## Development and verification

```sh
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
node scripts/smoke-real.mjs
```

The opt-in real smoke consumes account quota. It mounts the actual Cordis plugin,
lists the primary route through `ctx.llm`, checks streaming and DSH-owned multi-turn
history, interrupts generation and verifies reconnection. It never runs on CI.
CI uses a fake ACP subprocess for protocol and lifecycle regression tests.

MIT. See [third-party notices](THIRD_PARTY_NOTICES.md).
