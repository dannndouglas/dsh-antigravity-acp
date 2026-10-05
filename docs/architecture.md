# Architecture and ownership

## Primary provider

`src/index.ts` exports named Cordis metadata (`name`, `inject`, `Config`, `apply`).
It registers `AntigravityAcpAdapter` using `ctx.llm.registerAdapter` and disposes
it through `ctx.effect`. This is a primary LLM route, not a `subagents` provider.
`providerInfo`, `listModels` and `resolveModel` implement DSH's current picker seams.

The bundle also sets the ordinary `agent-default-model` row to
`antigravity-acp/server-default`. Existing explicit profile/session selections
retain their normal precedence. A message can therefore use the provider without
opening the model picker or configuring a server path.

## Automatic provisioning

Executable lookup preserves explicit overrides and existing installations.
Otherwise `installer.ts` selects a pinned Google 1.3.0 ZIP for the current
OS/CPU and streams it into a private staging directory in the DSH cache.
It validates ZIP paths/types/sizes, preserves all sibling runtime files and
sets executable permission on POSIX. The full payload and completion manifest
are published by directory rename under a short cross-process publication lock.
Aborts/failures remove staging data; corrupt caches are replaced automatically.
Ready manifests check each cached file's type and length before reuse.
Manifests are completeness receipts, not vendor signatures or cryptographic
integrity guarantees against a local attacker controlling the same account.
Network downloads use normal TLS and reject redirects to other origins.

No package lifecycle script downloads or executes a server, and no Google
binary is redistributed. Provisioning runs on first model lookup/message.
When a first message encounters `auth_required`, ACP `authenticate` invokes
the official server's browser flow and session creation continues automatically.
Background catalog discovery never requests interactive authentication.

```mermaid
sequenceDiagram
  participant DSH as DSH context and UI
  participant Adapter as Primary LlmAdapter
  participant ACP as Official ACP server
  DSH->>Adapter: GenerateOptions (complete messages, signal)
  Adapter->>ACP: initialize (ACP v1; no fs/terminal capabilities)
  Adapter->>ACP: session/new (empty scratch cwd; no MCP)
  opt Server requires authentication
    Adapter->>ACP: authenticate (advertised oauth-personal)
    Adapter->>ACP: session/new
  end
  Adapter->>ACP: session/set_config_option (announced model id)
  Adapter->>ACP: session/prompt (serialized DSH context)
  loop Live output
    ACP-->>Adapter: session/update (text or thought delta)
    Adapter-->>DSH: StreamChunk (stable block index)
  end
  ACP-->>Adapter: prompt result (stopReason)
  Adapter-->>DSH: block-end; finish
```

## Protocol and process reuse

The current DSH `subagent-acp` implementation uses `@agentclientprotocol/sdk`
1.4.0 and `ctx.subprocess`. Its `startAcpRun` owns one fresh child per delegated
run and folds only final text. It does **not** expose a reusable persistent
provider client as a public API. Importing that run would change ownership and
lose live text/reasoning. Instead this plugin imports the same official SDK and
managed subprocess seam, reusing the actual NDJSON framing, request correlation,
server-request validation and process-range teardown. No duplicate JSON-RPC
correlation parser is implemented.

One `AcpClient` holds one official process per adapter/account. A FIFO gate
serializes discovery and generations. Same-process concurrent ACP prompts are
not assumed safe. Reconnection occurs on the next call, with no automatic prompt
retry after partial text. ACP sessions accumulate because universal session
deletion is not guaranteed; the process is recycled between turns after the
configured session limit. Credential persistence remains entirely server-owned.

## History authority

The strategy is **fresh ACP session + full DSH context for every generation**:

```text
DSH session X, request 1 → ACP session A (full DSH history)
DSH session X, request 2 → ACP session B (new full DSH history)
DSH session Y, request 1 → ACP session C (full Y history)
```

There is deliberately no persistent DSH-session → ACP-session cursor or
`session/load`. `GenerateOptions.sessionId` is not needed to infer any history.
Request 2 includes request 1's DSH-visible result exactly once, in serialized
role-tagged content. Server-native history never becomes an additional source
of truth. Compaction, switching providers and auxiliary calls use the same
projection. There is no plugin credential/history/session database.

ACP's user prompt is not a system-message channel. `options.system` and all
system/developer messages are preserved in JSON alongside user/assistant/tool
history. Historical tool calls and matching results are context only. Images and
unprojected files are rejected; the DSH service normally projects durable file
references and text-route image placeholders before reaching an adapter.

## Tools and permissions

ACP `tool_call` describes something the **remote agent** does, not a raw model
request for DSH to execute. Mapping it to `tool-call-delta` would let DSH execute
the same action again and would misrepresent ownership. This plugin rejects
native activity with `ACP_NATIVE_TOOLS_UNSUPPORTED`, sends cancel and reaps the
process. Every `session/request_permission` receives the actual schema's
`{ outcome: { outcome: "cancelled" } }` response. It does not pick an allow option.

No client filesystem or terminal handlers are exposed; the SDK returns method
unsupported for those requests. Sessions receive no MCP endpoints or DSH
workspace directory. Default permission mode is left as announced; no `yolo`
or `auto_edit` setting is applied. The inspected server's live config exposes
only model/mode; it exposes no raw-tool definition or tools-off config option.
Prompt instructions and an empty cwd are guardrails, not an OS sandbox or a
guarantee that the official agent cannot act before sending a tool update.

`toolPolicy: text-only` explicitly chooses to omit DSH's current tool schemas
and warns once when a request carries them. This is what lets normal DSH
conversational sessions, which assemble tools in their request, use this backend.
`toolPolicy: reject` instead enforces an unsupported-options error at that
boundary. Neither setting claims tools work. Rich tool calling is deferred until
a verifiable client-owned execution mechanism can be implemented.

## Stream and errors

`agent_message_chunk` → text block/delta; `agent_thought_chunk` → reasoning
block/delta. Indexes are allocated in first-seen order and reused on all deltas.
The prompt RPC runs concurrently with an event queue so output is yielded before
its final result. Unrelated session updates are ignored. Blocks are closed before
the single terminal finish; nothing is emitted after it.

`usage_update.used/size` is session context occupancy. It cannot supply DSH's
disjoint input/output/cache billing vocabulary. It is ignored rather than
converted to invented usage. The optional SDK `PromptResponse.usage` extension
is unstable and also not consumed in v0.2. Actual reasoning text is supported,
but selectable effort is encoded only in exact server model IDs.

Transport/protocol failures throw sanitized `LlmError` codes. In-band stop
reasons map `end_turn`→stop, `max_tokens`→max-tokens, `cancelled`→aborted,
`refusal`→error, `max_turn_requests`→error. DSH's runtime normalizes thrown errors
to terminal finishes. An empty successful assistant answer throws `EMPTY_RESPONSE`.
Unsupported sampling controls fail before any child is spawned.

## Cancellation and disposal

AbortSignal covers queueing, executable lookup, initialization, authentication,
session setup and prompting. On a prompted request, cleanup writes ACP's
`session/cancel` **notification**, closes the SDK connection (rejecting pending
requests), closes stdin, gives the managed child its EOF grace, then calls
`terminate` and awaits the same managed range's exit. Cleanup is idempotent.
Generator early return performs the same cleanup. Provider disposal aborts its
lifetime signal and disposes its owned process/temp directory; queued callers
cannot start new children afterward.

The next call starts a new official process. It does not use `session/load`;
full DSH history reconstructs context. The DSH subprocess provider owns platform
process-group/Job handling, environment scrubbing and host-exit termination.
The plugin does not patch those facilities. POSIX containment may use the
provider's documented fallback on machines without a user systemd manager.
