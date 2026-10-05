# Source inspection record

Inspected on 2026-10-05. Local reference checkouts/downloads are outside this
repository and are not shipped. Moving default branches are pinned here for
reproducibility; dependency peer versions target the matching published alpha.

| Source | Revision / availability | Relevant evidence |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc) | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` | Cookbook, `llm/src/types.ts`, `index.ts`, `message.ts`, retry policy, subagent ACP `index.ts`/`run.ts`, subprocess seam/local provider, plugin bundle composition |
| [dsh-llm-antigravity](https://github.com/zhangzhangco/dsh-llm-antigravity/tree/dbac23637d81b88f17f71e41a8f28bc81794671f) | `dbac23637d81b88f17f71e41a8f28bc81794671f` | Real primary adapter shape, model discovery methods, `dsh.bundle.patch`, id-targeted profile config, explicit text-only limitations; CLI transport not adopted |
| [ACP protocol](https://github.com/agentclientprotocol/agent-client-protocol/tree/e04f25ba61e730fb7bf4dcd1fc3d1b40ff330d1e) | `e04f25ba61e730fb7bf4dcd1fc3d1b40ff330d1e` | `docs/protocol/v1/overview.mdx`, authentication and config docs, `schema/v1/schema.json`; cancel is a notification, usage_update is occupancy |
| [ACP Registry](https://github.com/agentclientprotocol/registry/tree/8ed458f223534a602cc6b74d186c3898a8428b2d) | `8ed458f223534a602cc6b74d186c3898a8428b2d` | Google entry `antigravity-acp/agent.json`, version 1.3.0, platform archives and Linux `--uid=` |
| [pi-antigravity-bridge](https://github.com/EstebanForge/pi-antigravity-bridge) | Git clone/raw access returned 404; source recovered from author's npm `@estebanforge/pi-antigravity-bridge@1.7.8` | README, license, `src/acp/jsonrpc.ts`, `connection.ts`, `events.ts`, `driver.ts`; indexed AGENTS.md also inspected. Release archive SHA-1 `688e248be164802d95a6ff5b58d115cc1d24f349` |
| [paseo-agy-acp](https://github.com/tiezbro/paseo-agy-acp/tree/ca9921fa9ad5aa01841df22a2b3fbe41befc0d84) | `ca9921fa9ad5aa01841df22a2b3fbe41befc0d84` | README, official-kernel spawn/login/proxy, admission scheduling, mode mapping, smoke; no compatibility patch, global state injection or account fence adopted |
| [antigravity-acp-harness](https://github.com/rhgo1749/antigravity-acp-harness) | Git clone, GitHub API and direct source requests returned 404 | Search-indexed primary README describes installer/probe and Hermes provider ownership. Installer/probe/Hermes implementation could not be inspected; no implementation behavior is assumed |

## Conclusions checked against the running server

- Official 1.3.0 negotiates ACP v1 and advertises `oauth-personal`.
- It returns select config options for model and permission mode; model IDs are
  complete strings including tiers. No client-tools/raw-model configuration was
  announced in the observed session. This is evidence about the observed
  interface, not proof about all future versions or undocumented flags.
- It streams assistant text and emits context-occupancy usage updates. It did
  not supply billable input/output counters in the probe.
- `session/new` can be used repeatedly on a persistent connection. The tested
  plugin still serializes account use; it does not assume simultaneous prompts.
- Personal authentication succeeded entirely in the official process; a later
  process created sessions without another interactive login.
- DSH has no `tool_choice` field in the inspected `GenerateOptions`. Native tool
  schemas and tool deltas exist on its side, but ACP remote tool activity has
  different semantics. v0.1 makes this limit explicit instead of inventing support.
- The existing CLI adapter provisions a custom tools-free agent using CLI
  selection. The official ACP session observed here does not advertise that
  selection, so no CLI-only flag or agent file is secretly introduced.

## TDD and validation

The fake-server tests were written before `src/adapter.ts`; the initial run
failed on the missing module. Implemented the SDK transport/client/adapter until
those tests passed, then added Cordis and transport boundary tests. Real Google
smokes followed the mandatory initial raw probe.

Node 22.17 on this machine initially made DSH's published Windows subprocess
runner exit before handling a request. Its entry uses `import.meta.main`; using
Node 22.22 resolved that without editing DSH. The package requires Node >=22.19,
also satisfying the published DSH networking dependency's engine range.
