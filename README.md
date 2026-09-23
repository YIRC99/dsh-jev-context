# dsh-jev-context

JEV-scored context selection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Every turn pays for the whole conversation. This plugin keeps the model-visible
history to the earlier segments a turn actually needs: on each turn's first step
it cuts the session surface where each unit of work began, asks the JEV decision
service (TypeSafe System One, about one second and $0.04 per million input
tokens) for one relevance probability per candidate segment, replaces the
irrelevant ones with a one-line omission marker, and recalls a shelved segment
when its topic returns.

The log is never edited. A shelved segment stays readable in the session log, so
recall re-materializes it, and every decision is recorded as a durable
`context-jev/turn` event that a session projection folds into the sidebar
console.

## Install

Inside the harness, from the plugin market (Settings → Plugins → Market), or:

```sh
dsh plugin --profile web add @yirc99/dsh-jev-context
```

Then restart `dsh web` and open the JEV row at the foot of the sidebar.
Installing the package is enough: it declares both its configuration layer
(`cordis.patch.yml`) and its browser half, so no second row or manual
`cordis.yml` edit is needed.

## Configure

The only required input is an API key. Without one the plugin records a `no-key`
ledger entry per turn and leaves the surface alone.

The key resolves in this order: the `apiKey` setting, the credential reference
named by `apiKeyEnv` (default `TYPESAFE_API_KEY`), then the launching
environment. The settings namespace is `jev-context`; `apiKey` is a
`role('secret')` field, so a remote settings read reports only whether one is
stored.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Run selection at all. |
| `threshold` | `0.5` | Probability at or above which a segment counts as relevant. |
| `keepRecentSegments` | `1` | Trailing segments never judged. |
| `minSegmentTokens` | `400` | Smallest segment worth rewriting; below it the marker costs about what the segment does. |
| `maxSegmentsPerDecision` | `40` | Largest question set sent in one call. |
| `retainedTurns` | `12` | Ledger records the browser view retains; read at mount. |
| `model`, `baseURL`, `timeoutMs`, `digestChars` | `jev-1.13.0`, the System One base, 20s, 320 | Decision service identity and bounds. |

## What it does to your session log

One thing is worth stating plainly, because it is the only thing this plugin
writes that other tools read back.

The ledger event type `context-jev/turn` is declared by this package, so a
harness that does not install the plugin has it outside its generated known-type
vocabulary — and such a harness refuses to load a session log containing an
unrecognized event it has no reason to trust. The record is therefore appended
with the harness's `ignorable` marker, which states that skipping it cannot
change how the rest of the log is read.

That marker is only written by a harness that supports it. On an older harness
the plugin detects the gap at mount, logs one warning, and **leaves the ledger
off** rather than storing records your own harness would then refuse to load.
Context selection itself is unaffected.

Everything else the plugin does is a normal surface rewrite: a `compaction/prune`
event immediately followed by its replacement, with no yield between them, which
is the protocol the harness's own compaction uses. The original bytes stay in the
log.

## How it works

A **segment** is a maximal run of surface nodes beginning where the harness
recorded a new unit of work — a human prompt, a goal round, or a teammate
message. Segmentation reads the current surface, so it survives this plugin's own
rewrites: an omission marker and a recall marker are themselves segment starts,
and each marker cites the original nodes it shadowed. Filtering marker sequences
out of those citations recovers a segment's identity and digest after any number
of prune/recall cycles.

Both rewrites ride the shared shadow-price protocol, so the context-pressure
projection subtracts the shadowed range's price exactly and the reported saving
is the number the meter itself uses. A rewrite is one `user/message`
replacement; `assistant/message` cannot cite source events, so a recalled
segment returns as a role-labelled transcript rather than as its original nodes.

The engine runs on `agent/pre-step`, before the request is built. Only a turn's
first step selects: later steps of one turn share a request prefix, and
re-scoring them would churn the surface between two requests that differ only in
their tail. Every failure is contained — an unreachable service, a malformed
answer set, or a rejected append leaves the surface unchanged, records why, and
lets the turn proceed.

## Known limitations

- **It speaks both session-format generations.** The marker messages it injects
  follow the running harness: `kind: 'plugin'` with the package name on format 3
  and earlier, and this package's own `kind: 'jev-context'` on format 4, which
  refuses the shared kind. `SESSION_FORMAT_VERSION` decides, so a session stays
  loadable whichever build wrote it. Both generations validate a source against
  a closed set, which is why the shape cannot be a compile-time constant.
- **Features that need a newer build degrade, and say so.** The settings panel
  needs `SettingsForms.installSection`, and the ledger needs the `ignorable`
  write path described above. Where a harness lacks one, the plugin reports it
  once at mount and runs without that piece; context selection needs neither.
- **A rewrite invalidates prompt-cache reuse** from the oldest changed segment,
  so alternating between two topics can cost more in cache misses than the
  shelved tokens save. Selection is per turn; nothing changes within a turn.
- **The decision service is a network dependency on the turn's critical path**,
  bounded by `timeoutMs`. A failed call costs the turn one round trip and
  nothing else.
- **Relevance comes from segment digests**, not full content, so relevance that
  lives only in a code block or a tool body is invisible to the decision.
  `digestChars` widens the window without changing the principle.

## Local development

```sh
pnpm install
pnpm build          # lib/index.js (Node half) + lib/client.js (browser half)
pnpm typecheck      # against the harness version in devDependencies
```

Installing a *local checkout* into a profile copies it: `dsh plugin add
file:...` does not follow later rebuilds, and re-running `add` reports "already
up to date" while the profile keeps the old copy. Remove and add again after a
rebuild:

```sh
dsh plugin --profile <name> remove @yirc99/dsh-jev-context
dsh plugin --profile <name> add file:/absolute/path/to/dsh-jev-context
```

`exports` must list `./cordis.patch.yml`. A package whose `exports` map omits it
is installed, listed in the profile's bundle stack, and then **silently skipped**
when the profile composes: the row never appears in `--dump-config` and nothing
reports why.

The published package ships JavaScript only. Type declarations would need the
harness APIs this plugin is written against to be present in the versions
`devDependencies` pins, and `pnpm typecheck` reports exactly which of them a
given version lacks; until that resolves, `types` stays out of the manifest
rather than pointing at a file the tarball does not contain.

## License

MIT
