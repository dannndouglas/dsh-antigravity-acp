# Response latency

## Audit and v0.3.3 correction

The user confirmed that fully quitting and reopening DSH Desktop resolved the
reported lack of improvement after installing 0.3.2. An installed package version
does not prove that an already-running host has loaded that module. The installation
instructions now require a complete Desktop restart after plugin updates.

The audit also found a separate regression: after model discovery, a request
without tools started a second process instead of using the ready discovery
process. Version 0.3.3 fixes this and claims the still-empty discovery session
once. Completed sessions are never reused, pending tool exchanges remain isolated,
and borrowed processes are tracked through cancellation and provider disposal.

On October 5, 2026, four alternating runs compared the released 0.3.2 package
with the 0.3.3 candidate using Google's official ACP server 1.3.0, Gemini 3.8
Flash Low, Node 22.22 and DSH 0.2.0-rc.2 libraries on Windows x64. Authorization
and the downloaded server were already cached. Each run created a new provider,
performed normal model discovery, and then sent `Diga oi.` without tools.

| Version / run       | Discovery | First text after request | Discovery + first text | Processes | New sessions after discovery |
| ------------------- | --------: | -----------------------: | ---------------------: | --------: | ---------------------------: |
| 0.3.2 / 1           |  12.472 s |                 20.668 s |               33.140 s |         2 |                            1 |
| 0.3.3 candidate / 1 |  13.961 s |                  8.747 s |               22.708 s |         1 |                            0 |
| 0.3.2 / 2           |  14.326 s |                 18.091 s |               32.417 s |         2 |                            1 |
| 0.3.3 candidate / 2 |  14.682 s |                  9.171 s |               23.853 s |         1 |                            0 |

All four runs selected the requested model once. The structural result is one
process instead of two and no redundant session creation for this first request.
Two samples per version do not establish a latency guarantee or measure the live
Desktop UI. The discovery cost is shown separately rather than hidden. Later
independent turns still create fresh sessions and may select a model, preserving
DSH's authoritative history and current tool catalog. Those operations and model
generation remain variable in the official server.

The wider 0.3.2 audit used the installed DSH headless SDK with 24 tool definitions
and approximately 10,106 history characters. Three requests measured 20.634,
12.650 and 9.870 seconds to first text with one process, compared with 26.300,
45.642 and 20.746 seconds and three processes in 0.3.1. One 0.3.1 model-selection
operation alone took 24.892 seconds. Repeating the smaller 0.3.2 benchmark gave
18.461, 12.193 and 11.601 seconds. These variations are why the earlier 10–11
second samples below must not be presented as a general response-time promise.

Regression tests cover discovery reuse without tools, new sessions after completed
prompts, concurrent pending tool exchanges, early stream termination and provider
disposal of borrowed processes. They verify lifecycle behavior, not cloud latency.

## Historical v0.3.2 measurements

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

| Prompt       | Time to first text | Complete stream | Server starts after discovery |
| ------------ | -----------------: | --------------: | ----------------------------: |
| Diga oi.     |           10.715 s |        10.741 s |                             0 |
| Quem é você? |           10.130 s |        10.206 s |                             0 |
| Diga oi.     |           11.151 s |        11.179 s |                             0 |

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
