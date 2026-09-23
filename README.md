---
description: "JEV-scored conversation segmentation for the DeepSeek Harness: decide per turn which earlier segments a request needs, shelve the rest behind a one-line marker, and recall them when the topic returns."
kind: "package-reference"
---

# @deepseek-ai/dsh-jev-context

English | [中文](README.zh.md)

## Summary

This package keeps the model-visible conversation to the earlier segments a turn actually needs. On each turn's first step it cuts the session surface where each unit of work began, asks the JEV decision service (TypeSafe System One, ~1s and ~$0.04 per million input tokens) for one relevance probability per candidate segment, replaces the irrelevant ones with a one-line omission marker, and recalls a shelved segment when its topic returns. The log is never edited: a shelved segment stays readable, so recall re-materializes it. Every decision is a durable `context-jev/turn` event, folded by the `jevContext` projection for the browser ledger.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row and configure an API key. The key is the only required input; without one the plugin logs a `no-key` ledger entry per turn and leaves the surface alone.

```yaml
- id: jev-context
  name: '@deepseek-ai/dsh-jev-context'
```

The key resolves in this order: the `apiKey` setting, the credential reference named by `apiKeyEnv` (default `TYPESAFE_API_KEY`), then the launching environment. The settings namespace is `jev-context`; `apiKey` is a `role('secret')` field, so a remote settings read reports only whether one is stored.

### Policy knobs

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Run selection at all. |
| `threshold` | `0.5` | Probability at or above which a segment counts as relevant. |
| `keepRecentSegments` | `1` | Trailing segments never judged. |
| `minSegmentTokens` | `400` | Smallest segment worth rewriting; below it the marker costs about what the segment does. |
| `maxSegmentsPerDecision` | `40` | Largest question set sent in one call. |
| `retainedTurns` | `12` | Ledger records the browser view retains; read at mount. |
| `model`, `baseURL`, `timeoutMs`, `digestChars` | `jev-1.13.0`, the System One base, 20s, 320 | Decision service identity and bounds. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A **segment** is a maximal run of surface nodes beginning where the harness recorded a new unit of work — a human prompt, a goal round, or a teammate message. Segmentation reads the current surface, so it survives this plugin's own rewrites: an omission marker and a recall marker are themselves segment starts, and each marker cites the original nodes it shadowed in `sourceEventSeqs`. Filtering marker seqs out of those citations recovers a segment's identity and digest after any number of prune/recall cycles.

Both rewrites ride the shared shadow-price protocol — a `compaction/prune` event immediately followed by its replacement, with no yield between them — so the context-pressure projection subtracts the shadowed range's price exactly and the reported saving is the number the meter itself uses. A rewrite is one `user/message` replacement; `assistant/message` cannot cite source events, so a faithful node-by-node restore is not expressible and a recalled segment returns as a role-labelled transcript instead.

The engine runs on `agent/pre-step`, which the loop dispatches before `step/start` and before `buildRequest()` derives history — the same timing `dsh-compaction-basic` uses. Only a turn's first step selects; later steps of one turn share a request prefix and re-scoring them would churn the surface between two requests. Every failure is contained: an unreachable service, a malformed answer set, or a rejected append leaves the surface unchanged, records why, and lets the turn proceed.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Pruned and recalled conversation segments

#### What the model sees

Once a turn's first step begins, the request carries the session's earlier segments except those the decision service scored below `threshold`, each replaced in place by one omission marker naming its topic and stating that the segment can be recalled. A segment that was shelved and is now relevant returns as a recall marker carrying a role-labelled transcript of its original content. An omitted segment reads as `[更早的对话已省略 · 主题：…]` plus one sentence saying the content still exists and asking the model to say so if it needs the segment; a recalled one reads as `[更早的对话已重新载入 · 主题：…]` followed by the original text, unedited, labelled `【用户】`/`【助手】`/`【工具】`, with a failed tool result prefixed `[工具报错]`. The most recent `keepRecentSegments` segments are never rewritten.

#### Token effect

A shelved segment costs its marker (roughly 50 tokens) instead of its content, so the saving is bounded below by `minSegmentTokens`. Each decision costs one JEV call whose input is the digest set; the pricing is recorded on the turn's ledger event alongside the heuristic totals before and after. A recall spends tokens to bring content back; a turn whose recalls outweigh its prunes reports a negative `tokensSaved`.

#### KV Cache effect

Rewriting a segment invalidates reuse from the first changed token, so a topic switch costs a prefix miss from the oldest changed segment onward. Unchanged segments before that point stay eligible, and a turn that changes nothing leaves the prefix byte-identical.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the current selector is a poor fit. They are package constraints, not a comparison against other context strategies.

- **Relevance is judged from digests, not from the content itself** — the decision service sees the opening request text, a bounded reply excerpt, and tool names. A segment whose relevance lives only in a code block, a file path, or a tool result body can be scored irrelevant and shelved. Raising `digestChars` widens the window without changing the principle.
- **A recalled segment is not restored as its original nodes** — the surface admits only a `user/message` as a multi-node replacement, and `assistant/message` cannot cite source events, so recall returns a transcript in one user-role node. Roles survive inside the text, not as provider roles.
- **A cached request prefix is expensive to rewrite, and this is now measured** — a rewrite invalidates reuse from the oldest changed segment. Across 16 local session logs the provider served 99.5% of billed input from cache; a cache read costs $0.003 per million against $0.15 uncached, so re-billing one token costs 50 times what shelving it saves. Eleven rewrites added $0.42 of extra billing, the largest re-billing 722,713 tokens in a single request for $0.106. A prune repays its own invalidation only after `49 x (tokens after the break) / (tokens removed)` further requests: removing 150,000 tokens from a 300,000-token prompt needs 98 more, and removing 20,000 needs 735. Breaking the prefix late in the context costs far less than breaking it early — the opposite of where relevance-based selection naturally cuts.
- **Recall is not a model-initiated act** — the model can state that it needs a shelved segment, but only the next turn's decision can actually bring it back. The marker says so rather than implying an available tool.
- **The decision service is a network dependency** — a call blocks that turn's first step for its latency (about one second in the design's measurements). A timeout of `timeoutMs` abandons the decision and leaves the surface unchanged.
- **A single-topic session prunes nothing, and that is the design** — measured over a real 3,500-event session, every segment scored 0.62–0.82 against the newest request, so all of them stayed loaded. Relevance separates *topics*, not "this turn needs this part of one topic"; within one long subject there is nothing to cut that the turn can afford to lose. The saving appears when a session genuinely changes subject, and then it is large — the same session held single segments costing 57,000 and 382,000 heuristic tokens.
- **Consecutive goal rounds can carry the same label** — the caption is the segment's opening request text, and every goal round opens by repeating the objective. The per-row action, relevance, and token count still distinguish them; the caption does not.
- **Only the newest candidates are judged when the cap binds** — `maxSegmentsPerDecision` (40 by default) limits one call, and the cap keeps the newest candidates. In a session with more eligible segments than that, an older shelved segment stops being asked about and therefore cannot be recalled. Raising the cap costs decision-service input tokens.
- **`retainedTurns` and `digestChars` are read from the composition layer at mount** — the projection's fold state is persisted and versioned, so changing the ledger bound takes effect on reload rather than live.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The relevance question is derived from the JEV demo at `D:\code_file\jev_demo`, which established that one `noul` question per candidate separates a relevant segment from unrelated chit-chat in about one second. Measured against the live service through this package's own client, over a three-topic session: a request continuing one topic scored it 0.96 and the other two 0.02 and 0.08; a request asking for the whole conversation scored all three 0.96–0.98. Every relevant segment lands above 0.84 and every irrelevant one below 0.08, so the default `threshold` of 0.5 sits in an empty band rather than near a boundary. One call costs about 1,085 input tokens (roughly $0.000046) and 450–1,100 ms.

</details>

**Runtime invariant:** No invariant companion is published because every relationship this package owns is already checked at its append site: the session surface fold rejects a replacement whose citations miss a shadowed node or whose range left the surface, and the shadow-price protocol is enforced by the token-meter fold. An independent observation would restate those checks rather than catch a divergence between them.
