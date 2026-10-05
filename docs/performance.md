# Response latency — v0.3.2

On October 5, 2026, the reported delay was reproduced using Gemini 3.8 Flash Low,
Google's official ACP server 1.3.0, Node 22.22, the published DSH 0.2.0-rc.2
libraries and the plugin's real MCP bridge on Windows x64. Google authorization
was already present. The measurement used short Portuguese prompts, a small
conversation and one unused tool schema. No private Google API was inspected.

Version 0.3.1 started a new official server for every independent tool-capable
turn. The first two requests took 21.381 and 20.921 seconds to first assistant
text. Server initialization alone cost 8.558 and 8.055 seconds. Fresh ACP-session
creation cost 5.304 and 4.351 seconds; model selection cost 2.868 and 2.753 seconds.
The completed generation took 4.723 and 6.827 seconds. Shutdown added about three
seconds after generation. These boundaries were measured separately, without
capturing credentials or real user conversations.

Version 0.3.2 retains at most two healthy idle processes for five minutes and
transfers the ready model-discovery process to this pool. Each independent turn
continues to open a new ACP session and reconstruct its prompt from current DSH
history. It receives a fresh MCP endpoint and tool catalog. Completed sessions
are not resumed; conversations, active subagents and tool results remain isolated.

After normal model discovery, three sequential requests measured:

| Prompt | Time to first text | Complete stream | Server starts after discovery |
| --- | ---: | ---: | ---: |
| Diga oi. | 10.715 s | 10.741 s | 0 |
| Quem é você? | 10.130 s | 10.206 s | 0 |
| Diga oi. | 11.151 s | 11.179 s | 0 |

That run used one server process across discovery and all three generations,
with no new OAuth flow. A separate real-server check completed two tool turns
with different tool names and matching results, using the same process with
fresh sessions/endpoints. No stale tool catalog was observed.

Regression tests reproduce the repeated process creation, then verify process
reuse, discovery handoff, idle expiry, process death, cancellation, session-count
recycling, pool capacity, concurrent turn limits and provider disposal. Existing
tests continue to cover tool/result correlation, permissions and context changes.

These are small local samples, not a service-level latency guarantee or a live
Desktop UI benchmark. Cold startup still pays the official initialization cost;
expired idle processes, account/network conditions, larger DSH contexts and
different models can increase latency. Even with a ready process, the official
server still spends time on session creation, model selection and generation.
The earlier model-discovery probe also hit its setup timeout once. The plugin
does not bypass Google's runtime or promise API-style response times.

For installation through DSH's plugin manager, use the repository root URL:
https://github.com/dannndouglas/dsh-antigravity-acp. URL-tarball installation can
encounter the reported [pnpm missing-integrity failure](https://github.com/deepseek-ai/deepseek-harness/discussions/8294).
