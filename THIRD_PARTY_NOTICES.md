# Third-party notices

This plugin is independently implemented. It imports the official ACP SDK
and DeepSeek Harness packages; their licenses remain with their distributions.
No Google executable, credential file, or third-party implementation is copied
into this repository or package.

ZIP extraction uses [yauzl](https://github.com/thejoshwolfe/yauzl) (MIT), imported
as a package dependency. Official Google archives are downloaded directly to a
local cache at runtime; they are not redistributed by this repository.

Architectural references:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), MIT:
  LlmAdapter registration, StreamChunk conventions, SDK-based ACP client,
  and managed subprocess lifecycle.
- [dsh-llm-antigravity](https://github.com/zhangzhangco/dsh-llm-antigravity), MIT:
  bundle patch packaging and the explicit text-provider limitation.
- [pi-antigravity-bridge](https://github.com/EstebanForge/pi-extensions/tree/main/packages/pi-antigravity-bridge), MIT:
  ACP connection and parked MCP-to-harness tool round trips. Source inspected
  from npm release 1.7.8 and its current monorepo. No source copied.
- [pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider), MIT:
  npm release 0.1.12 and repository inspected for MCP forwarding, continuation
  identity and native-agent ownership boundaries. No source copied.
- [paseo-agy-acp](https://github.com/tiezbro/paseo-agy-acp), Apache-2.0:
  official kernel lifecycle, permission modes and Linux Registry launch flags.
  No source copied and no compatibility injection adopted.
- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)
  and its [Registry](https://github.com/agentclientprotocol/registry):
  protocol specification, schema and official download metadata.
- [antigravity-acp-harness](https://github.com/rhgo1749/antigravity-acp-harness):
  indexed README inspected; implementation was unavailable (HTTP 404).
  No source copied or claims made about uninspected Hermes tool semantics.

Google Antigravity and its official ACP server are Google products and are
governed by Google's licenses and terms. This is an independent community plugin.
