# dsh-antigravity-acp

Use your Google Antigravity account as the **primary model in DeepSeek Harness**,
with **DSH-owned tools**, through Google's official ACP server. No API key.

**Install in DSH and chat.** The plugin downloads the official server, discovers
models, selects Antigravity for fresh chats and connects DSH's tools automatically.
No binary installation, environment variable, configuration file, MCP setup or
terminal login is required. If needed, the official server opens Google's browser
login on your first message; approve it and the conversation continues.

Version **0.3** adds a private MCP bridge. Antigravity requests a tool; DSH applies
its normal permissions, runs the tool and returns the real result. Files,
commands and installed extension tools use this same DSH execution path.

[Português](docs/README.pt-BR.md) · [Architecture](docs/architecture.md) ·
[Real verification](docs/agy-acp-probe.md) · [Research](docs/research.md)

## Install

Requires Node.js **>=22.19**. Supports DSH **0.2.0-rc.2** and **0.2.1-alpha.1**.
The package uses the host's matching services; no version exemption is needed.
Tested with Google's
server **1.3.0** on Windows x64; fake-server CI covers Windows, Linux and macOS.
Automatic downloads support all three operating systems on x64 and arm64.

In DSH's plugin manager, install using the repository URL:

https://github.com/dannndouglas/dsh-antigravity-acp

For a terminal installation:

```sh
dsh plugin --profile web add git+https://github.com/dannndouglas/dsh-antigravity-acp.git
```

Open the profile and send a message. After installing or updating in DSH Desktop,
fully quit DSH and reopen it: an open host can retain the previous plugin module
even when the installed package already shows the new version. To update when
there is no update button, remove the plugin and install the same repository URL
again, then fully quit and reopen DSH. No configuration changes are needed.
The package bundle mounts the provider and default model. Explicit saved
profile/session selections retain DSH's normal precedence. You can choose any
announced model in the ordinary model picker.

The built dist is committed so Git installation needs no compiler. The package
uses the host's llm and subprocess services without editing DSH core or a global
installation. Development checkout:

```sh
npm ci
npm run check
npm pack
dsh plugin --profile web add /absolute/path/to/dsh-antigravity-acp-0.3.3.tgz
```

## How tools work

```text
DSH primary provider → ACP v1 / stdio → official agy_acp_server → Google
                               ↑
                private loopback MCP bridge
                               ↓
                DSH permissions and tool execution
```

Tool schemas are exported automatically to the bridge. A validated MCP request
becomes an ordinary DSH tool-call block, using its original name and arguments.
The MCP request stays pending while the DSH agent loop executes it. A subsequent
DSH generation returns the matching tool result and resumes the **same** ACP
prompt. Parallel calls, sequential tool rounds, failures and permission denials
are supported. A denied action stays denied; no bypass is attempted by the plugin.

ACP's native tool notifications are never re-executed in DSH. Bridge calls are
identified by the official server's MCP metadata. Only permission to reach this
bridge is allowed, once per request; actual tool execution still belongs to DSH.
Native Antigravity tools outside the bridge cause cancellation and an explicit
error. YOLO mode, client filesystem and client terminal capabilities stay off.
The official executable is an agent, so these protocol guardrails **are not an
OS sandbox** and cannot undo a native action performed before its notification.

DSH remains the history authority. Independent turns start from full DSH context.
Version 0.3.3 also lets requests without tools borrow a ready server process.
The first such request can claim the still-empty model-discovery session once,
avoiding redundant process startup and session creation. Later independent turns
receive fresh ACP sessions; tool turns always receive their own MCP bridge.
At most two completed processes stay ready for five minutes, then shut down.
Cancellation, errors and early stream termination discard the affected process.
This is automatic; no extra setup is required. Two real Flash Low samples per
version measured 18–21 seconds to first text in 0.3.2 versus 8.7–9.2 seconds in
the 0.3.3 candidate for the first request without tools after discovery. These
small samples are not a latency guarantee. Cold startup, fresh sessions, model
selection and Google's generation time can still take longer.
See the [timing record](docs/performance.md).

Only an unfinished tool round trip retains ACP state. Context/model/catalog
changes discard stale exchanges. Tool turns use separate managed processes,
allowing concurrent chats and provider calls from subagent tools. Cancellation
remains active while DSH is running a tool or awaiting approval.

## Automatic server and login

The complete, unmodified server archive is fetched directly from dl.google.com,
using pinned 1.3.0 URLs from the [official ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json).
All sibling runtime files are preserved. The cache is under
`$DSH_HOME/cache/antigravity-acp`, or `~/.cache/dsh-antigravity-acp` outside DSH.
Complete caches are reused; incomplete/corrupt downloads retry automatically.
Downloads require ordinary HTTPS verification, reject redirects and validate ZIP
paths/types/sizes. The Registry supplies no checksum; no vendor signature is
invented. Google binaries are not bundled or redistributed. No postinstall script.

OAuth uses only the official server's advertised oauth-personal method. The
plugin never reads, copies or stores account credentials. Model discovery does
not open a login browser in the background. Model/backend networking belongs to
the official executable; the plugin uses no private Google model endpoints.

## Optional settings

Defaults need no changes. An advanced profile patch targets the existing row:

```yaml
- id: llm-antigravity-acp
  config:
    toolPolicy: bridge
    timeoutMs: 600000
    toolTimeoutMs: 900000
```

| Option                | Default         | Meaning                                                                      |
| --------------------- | --------------- | ---------------------------------------------------------------------------- |
| provider              | antigravity-acp | DSH provider route                                                           |
| command               | empty           | Existing server discovery, then automatic download                           |
| autoInstall           | true            | Provision Google's server when missing                                       |
| installTimeoutMs      | 180000          | Download/extraction deadline                                                 |
| args                  | []              | Extra argv; never interpreted as shell text                                  |
| auth                  | oauth-personal  | Official authentication method                                               |
| defaultModel          | empty           | Exact announced ID; empty uses server default                                |
| models                | []              | Additional IDs, validated before use                                         |
| toolPolicy            | bridge          | Automatic DSH MCP bridge; text-only omits tools; reject refuses tool schemas |
| timeoutMs             | 600000          | Active model segment deadline, paused during tool execution                  |
| toolTimeoutMs         | 900000          | Deadline waiting for DSH tool results/approval                               |
| maxActiveToolSessions | 16              | Bounded concurrent unfinished tool turns                                     |
| idleProcessTimeoutMs  | 300000          | Keep up to two completed server processes ready between turns                |
| requestTimeoutMs      | 30000           | Protocol setup/config deadline                                               |
| authTimeoutMs         | 600000          | Official browser authorization deadline                                      |
| cancelGraceMs         | 1500            | Bound for sending ACP cancel                                                 |
| disposeGraceMs        | 3000            | Managed process EOF grace                                                    |
| maxSessionsPerProcess | 100             | Recycle retained processes between ACP sessions                              |

Discovery order: command, AGY_ACP_BIN, PATH, known user directories, automatic
installation. Explicit overrides are authoritative; broken paths fail clearly.
Linux uses the Registry's uid launch flag. There is no account-selection UI.

Optional diagnostics: `dsh-antigravity-acp status`, `doctor`, `probe`, `login`,
`logout`. Status/doctor never initiate interactive login. Logout affects the
server's shared account state and is never run automatically. The standalone CLI
needs DSH's optional subprocess-local peer; plugin activation uses ctx.subprocess.

## Remaining protocol limits

- Text and reasoning stream. Binary image/audio input is not implemented. DSH
  must project attachments for this text route; non-text tool-result blocks are
  sent as JSON metadata, not dereferenced file bytes.
- System instructions are serialized into ACP's user prompt. The official
  agent's own system instructions remain; ACP is not a raw model API.
- temperature, maxTokens, stop and explicit reasoningEffort fail with
  UNSUPPORTED_OPTION. Choose an announced model variant for its reasoning tier.
- usage_update measures context occupancy. Billable token counts and unknown
  context capacity are not invented.
- No durable ACP resume. Restart/provider change reconstructs from saved DSH
  history. Partially streamed requests are never automatically replayed.
- Limits: 256 active tool definitions, 128 KiB per definition, 1 MiB MCP bodies,
  64 concurrent pending calls per turn. Unsupported schemas fail explicitly.

## Troubleshooting

| Code                           | Action                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| ACP_INSTALL_FAILED             | Check connectivity/free disk space and retry                               |
| ACP_AUTH_REQUIRED              | Complete the official browser authorization on first message               |
| ACP_INVALID_MODEL              | Choose an exact ID announced by doctor/model picker                        |
| ACP_MCP_UNSUPPORTED            | Use the supported official server with HTTP MCP capability                 |
| ACP_NATIVE_TOOLS_UNSUPPORTED   | Retry using only the DSH bridge tools; native agent activity was cancelled |
| ACP_TOOL_RESULTS_MISSING       | Retry from saved DSH history; a tool result was missing/duplicated         |
| ACP_TOOL_TIMEOUT               | Finish approval/execution within the deadline, or increase toolTimeoutMs   |
| ACP_TOOL_CATALOG_INVALID       | Correct the reported tool's JSON schema/name                               |
| ACP_SESSION_LIMIT              | Finish/cancel an existing turn or raise maxActiveToolSessions              |
| ACP_TIMEOUT / ACP_DISCONNECTED | Retry to reconnect; check server connectivity                              |
| ACP_TEARDOWN_FAILED            | Restart the profile; managed cleanup could not be verified                 |
| UNSUPPORTED_OPTION             | Remove unsupported sampling settings or project binary input               |

Remote errors and stderr are drained without logging account/auth data. Local
MCP bearer tokens are ephemeral, never logged and unrelated to OAuth credentials.

## Verification

```sh
npm run check
npm run format:check
npm audit --omit=dev
npm pack --dry-run
node scripts/smoke-real.mjs
node scripts/smoke-tools-real.mjs
```

Real smokes are opt-in and consume account quota; they never run in CI. Fake
servers cover transport, installer, streaming, lifecycle and tool continuations.
The [verification record](docs/agy-acp-probe.md) distinguishes real installed DSH
checks from protocol tests. MIT; [third-party notices](THIRD_PARTY_NOTICES.md).
Independent community plugin, not affiliated with Google or DeepSeek.
