# Official agy ACP probe

**Successful real probe on 2026-10-05**, Windows x64, official server 1.3.0.
This is a sanitized record of executed protocol traffic, not fake-server output.
IDs, session IDs, paths and account/auth data are redacted. Catalog excerpts
are abbreviated. No tokens or personal data were recorded in this document.

## Distribution

Downloaded directly from the URL in the current
[official ACP Registry entry](https://github.com/agentclientprotocol/registry/blob/8ed458f223534a602cc6b74d186c3898a8428b2d/antigravity-acp/agent.json):

`https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.3.0-windows-x86_64.zip`

The complete extracted distribution has `agy_acp_server.exe` and sibling
`localharness_external.exe`. Both remain **outside the plugin repository/package**.
No file was modified or repackaged. Startup used stdio pipes and no PTY.

## Mandatory initial spike

Client → server:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false},"clientInfo":{"name":"dsh-antigravity-acp-probe","version":"0.1.0"}}}
```

Server → client (selected fields from response):

```json
{
  "protocolVersion": 1,
  "agentInfo": {"name":"antigravity-acp","title":"Google Antigravity","version":"1.3.0"},
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": {"image":true,"audio":true,"embeddedContext":true},
    "mcpCapabilities": {"http":true,"sse":true},
    "sessionCapabilities": {"list":{},"resume":{}},
    "auth": {"logout":{}}
  },
  "authMethods": [
    {"id":"oauth-personal","name":"Log in with Google"},
    {"id":"oauth-business","name":"Log in with Gemini Enterprise"},
    {"id":"gemini-api-key","name":"Gemini API key"},
    {"id":"agent-platform","name":"Gemini Enterprise Agent Platform"}
  ]
}
```

Client → server:

```json
{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"oauth-personal"}}
```

The request succeeded. Authentication was performed by the Google process;
the probe did not read credential files, capture tokens or construct OAuth URLs.

Client → server:

```json
{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"<absolute probe directory>","mcpServers":[]}}
```

The response included a session ID, `configOptions` and modes. Model option:
`id=model`, `category=model`, `type=select`, current value
`gemini-3.8-flash-high`. Announced IDs included `gemini-3.8-flash-high`,
`gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, variants of 3.7/3.6,
`gemini-pro-agent`, and `gemini-3.1-pro-low`. Permission modes were
`default`, `auto_edit`, `yolo`; no tools-off/raw-LLM setting was announced.
These are observed examples, **not a hardcoded shipped model catalog**.

Client → server:

```json
{"jsonrpc":"2.0","id":4,"method":"session/prompt","params":{"sessionId":"<redacted>","prompt":[{"type":"text","text":"Reply exactly with ACP_OK. Do not use tools."}]}}
```

Observed notification sequence:

```text
session/update: available_commands_update
session/update: agent_message_chunk, content.type=text, content.text="ACP_OK"
session/update: usage_update (context occupancy; values not recorded by initial probe)
```

Observed final response:

```json
{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}
```

The initial probe closed stdin and terminated the process after its bounded
grace. The initial probe preceded the substantive transport implementation.

## Plugin/core integration smoke

After implementation, `node dist/cli.js probe` ran against the official server
from an empty plugin-owned scratch directory and printed:

```text
ACP_OK
ACP probe passed (real streaming).
```

The separate `scripts/smoke-real.mjs` mounted the **actual plugin in Cordis with
DSH's published LlmRuntime and managed LocalSubprocessRuntime**. All calls went
through `ctx.llm.stream`, using a discovered exact low-tier model. Selecting a
different announced model exercised `session/set_config_option`.

```text
PRIMARY_PROVIDER_OK [ 'antigravity-acp' ]
TURN "ACP_OK" DELTAS 1
TURN "violet" DELTAS 1
CANCEL_OK
TURN "RECONNECT_OK" DELTAS 1
REAL_DSH_SMOKE_OK
```

The second turn recovered the word from the full DSH-owned transcript in a
fresh ACP session. Interrupting a long answer produced DSH's aborted finish,
managed cleanup, then a successful reconnect. No tool action was requested.
These short replies each arrived in one server text chunk; fake-server tests
separately prove that deltas are delivered before the final RPC result and that
split NDJSON/UTF-8 is decoded correctly. Server chunk granularity is server-owned.

The second process did not need another interactive OAuth login. Credentials
remained in the official server's existing authenticated state. The smoke tests
validate the provider/core path; a manual visual click in an installed DSH UI
is not claimed by this record.

## Normal DSH installation

The packed tarball was installed with DSH 0.2.1-alpha.1's normal
`dsh plugin --profile web add <tarball>` command in an isolated `DSH_HOME`.
It succeeded without adding native build scripts, core patches, or modifying
the machine's global DSH installation. The composed profile (`--dump-config`)
contained the `llm-antigravity-acp` row and its package was automatically added
to `dsh.profile.bundles`. A broken pre-existing pnpm shim on the machine was
bypassed with a local pnpm executable used only for this verification.
