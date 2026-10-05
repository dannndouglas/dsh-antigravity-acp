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
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": { "readTextFile": false, "writeTextFile": false },
      "terminal": false
    },
    "clientInfo": { "name": "dsh-antigravity-acp-probe", "version": "0.1.0" }
  }
}
```

Server → client (selected fields from response):

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "antigravity-acp", "title": "Google Antigravity", "version": "1.3.0" },
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "image": true, "audio": true, "embeddedContext": true },
    "mcpCapabilities": { "http": true, "sse": true },
    "sessionCapabilities": { "list": {}, "resume": {} },
    "auth": { "logout": {} }
  },
  "authMethods": [
    { "id": "oauth-personal", "name": "Log in with Google" },
    { "id": "oauth-business", "name": "Log in with Gemini Enterprise" },
    { "id": "gemini-api-key", "name": "Gemini API key" },
    { "id": "agent-platform", "name": "Gemini Enterprise Agent Platform" }
  ]
}
```

Client → server:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "authenticate", "params": { "methodId": "oauth-personal" } }
```

The request succeeded. Authentication was performed by the Google process;
the probe did not read credential files, capture tokens or construct OAuth URLs.

Client → server:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/new",
  "params": { "cwd": "<absolute probe directory>", "mcpServers": [] }
}
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
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "<redacted>",
    "prompt": [{ "type": "text", "text": "Reply exactly with ACP_OK. Do not use tools." }]
  }
}
```

Observed notification sequence:

```text
session/update: available_commands_update
session/update: agent_message_chunk, content.type=text, content.text="ACP_OK"
session/update: usage_update (context occupancy; values not recorded by initial probe)
```

Observed final response:

```json
{ "jsonrpc": "2.0", "id": 4, "result": { "stopReason": "end_turn" } }
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

## Version 0.2: zero-configuration verification

On 2026-10-05 the real smoke was repeated with **no `AGY_ACP_BIN` or configured
command** and a fresh installer cache. The plugin fetched Google's Windows x64
1.3.0 ZIP directly, extracted both official executables, published its ready
receipt and produced all six successful smoke lines shown above. The files were
81,437,336 and 145,548,952 bytes; neither is included in the plugin package.

The v0.2.0 tarball was then installed through DSH's normal plugin manager into
an isolated `headless` profile. Its user `cordis.patch.yml` remained exactly `[]`.
No provider, model, binary path or API key was configured. The ordinary command
`dsh --profile headless "Reply exactly with ACP_OK. Do not use tools."` returned:

```text
ACP_OK
```

Exit status was zero. This exercised the actual installed DSH application,
the package's default-model bundle patch, cached automatic server provisioning
and a real Google response. The browser account was already authorized by the
earlier official login; this record does **not** claim a fresh browser-consent
test. The zero-config fake-server integration separately verifies that first
generation invokes `oauth-personal` and continues after authentication, without
a CLI login command. No manual visual interaction with the DSH UI is claimed.

## Version 0.3: MCP tool execution

On 2026-10-05 an additional raw probe used the official ACP and MCP SDKs with
Google's unmodified Windows x64 1.3.0 server. initialize advertised HTTP MCP.
session/new received a loopback dsh-bridge descriptor and ephemeral bearer token.
The official permission and tool events contained:

```json
{
  "_meta": {
    "mcp": { "tool": "dsh_probe_token", "server": "dsh-bridge" },
    "is_mcp_tool_call": true
  }
}
```

Selecting allow_once reached the real MCP endpoint exactly once; its returned
marker appeared in the assistant answer. Completed tool updates could omit the
metadata, so the provider tracks known ACP IDs. Native updates are not emitted
as DSH execution requests. This probe establishes a client-owned execution route
through MCP; the earlier text-only conclusion is superseded by this evidence.

The new opt-in scripts/smoke-tools-real.mjs mounted the actual Cordis plugin and
LlmRuntime, received normal DSH tool-call blocks, returned one success and one
isError permission-denial result, and continued the pending ACP prompt:

```text
DSH_TOOL_CALL probe_marker RETURNED
DSH_TOOL_CALL denied_action DENIED
ANSWER Marker: REAL_TOOL_MARKER_5c72d8; second tool denied
REAL_DSH_LLM_TOOL_SMOKE_OK
```

This test supplies the harness result directly through LlmRuntime; it does not
claim an interactive permission-dialog test.

The v0.3 tarball was installed by DSH's ordinary plugin manager in the isolated
headless profile. The user patch remained [] and no command, provider, model,
MCP or API key was configured. With the automatically provisioned cached server,
the actual DSH application created and read back a validation file:

```text
DSH_TOOL_EXECUTION_OK
```

Its durable session records contain DSH write and read tool-call blocks with
acp\_ correlation IDs and matching successful tool/result messages. The file bytes
were independently checked. This verifies the real installed DSH agent loop,
its own tools and persistence, not only a simulated tool handler.

The command check reached the actual DSH pwsh tool. This machine's default
workspace-write sandbox returned SetNamedSecurityInfoW failed (Win32 5) while
preparing the workspace ACL, before shell execution. That is a host DSH sandbox
failure, and was preserved as an error tool result. A later native Antigravity
tool attempt was cancelled by the provider. Explicit MCP name mappings were
added to the prompt to improve routing; they do not guarantee model compliance.
No ACL repair, user profile permission change or automatic escalation was added.

Fake-server tests were written and run failing before the bridge implementation.
They exercise real MCP SDK transports, JSON-schema rejection, bearer/Origin
checks, permission routing, exact result correlation, concurrent conversations,
parallel and sequential rounds, cancellation while parked, consumer early return,
context/catalog changes, missing results, capacity limits and paused deadlines.
Google model nondeterminism and the official agent's own instructions remain
outside the plugin's control. No visual UI or fresh Google-consent test is claimed.

### Command execution isolated from the host ACL failure

The same installed DSH profile was launched once with its built-in
DSH_PERMISSION_MODE=danger-full-access **for that validation process only**, in
line with this task's permitted execution mode. No profile patch or ACL was
changed. The prompt requested exactly one harmless DSH pwsh call, echoing a
marker, and forbade repair, other tools and native Antigravity actions. It returned:

```text
DSH_COMMAND_EXECUTION_OK
```

Exit status was zero. This verifies actual command execution through the DSH
agent loop and bridge. The default workspace-write test above separately verifies
that a host sandbox error is preserved. The plugin neither fixes nor bypasses
DSH's sandbox; a normal installation keeps the user's chosen permissions.

## DSH 0.2.0-rc.2 installation regression — v0.3.1

The v0.3.0 package incorrectly pinned its DSH peers to 0.2.1-alpha.1. The
installed official Windows Desktop CLI reported DSH 0.2.0-rc.2 and reproduced
the reported installation rejection, including rollback of the isolated profile.

Version 0.3.1 declares both tested hosts, 0.2.0-rc.2 and 0.2.1-alpha.1, and
builds against 0.2.0-rc.2's published libraries. The LLM adapter and subprocess
declarations used by this plugin are unchanged between those releases. A
regression test uses DSH's own evaluatePluginCompatibility function: it failed
with the old manifest and passes with the corrected manifest. Untested older
and future DSH releases remain refused by that check.

All 62 tests, type checking, compilation, formatting, package checks and the
production dependency audit passed with the 0.2.0-rc.2 libraries. CI now checks
both supported DSH versions on Windows, Linux and macOS.

The installed Desktop 0.2.0-rc.2 CLI accepted the v0.3.1 tarball through its
ordinary plugin manager. An isolated headless profile retained an empty user
patch; no version exemption, provider/model override or plugin configuration
was supplied. With Google's official server 1.3.0, the normal DSH agent loop
returned:

```text
DSH_RC2_OK
```

A second real turn read a JSON fixture using DSH's own read tool. Its tool-call
ID began with acp_, the matching tool result completed successfully, and the
final reply matched the fixture's proof value, which was not included in the
prompt. Both processes exited with status zero. This validates model streaming
and tool/result continuation in the actual installed 0.2.0-rc.2 host. The existing
official Google authorization was reused; a fresh browser-consent flow was not
tested in this regression check. No user profile, global DSH installation,
permission policy or ACL was changed.
