# Performance: profiling, benchmarks, and known hot paths

This document explains how to measure MarkText's performance, how to run the
perf tests, and what is known about the editor's hot paths. It follows the
Electron maintainers' core doctrine: **measure, measure, measure** — profile the
running code, find the hungriest piece, optimize it, repeat. Do not optimize on
a hunch; prove it with a profile or a benchmark first.

## TL;DR — is it dev mode or a real bottleneck?

Typing can feel laggy under `pnpm dev` because the renderer runs an
**unbundled, unminified** build through the Vite dev server (source maps, HMR,
Vue dev build). This overhead is real and is **not** representative of shipped
performance. Before investigating a "slow typing" report:

1. Build a production bundle and reproduce there:
   ```bash
   pnpm build:unpack   # unpacked production build in packages/desktop/dist
   ```
   If the lag disappears, it was dev-mode overhead. If it persists, profile it.
2. Note the document that triggers it (small vs. large; lots of inline
   syntax/math/code vs. plain text). The hot path cost scales with paragraph
   length, so a 2000-character paragraph behaves very differently from a short
   one.

## Profiling the renderer (the CPU profile)

The renderer is where typing latency lives. To capture a CPU profile of a
**production** build (so you measure real cost, not dev overhead):

```bash
pnpm perf:inspect        # electron-vite preview with --inspect=5858, PERF_TESTING=true
# or, to break before the first line:
pnpm perf:inspect-brk
```

Then:

1. Open Chrome and go to `chrome://inspect`.
2. Under "Remote Target" click **inspect** on the MarkText target (port 5858).
3. Open the **Performance** tab, click record.
4. Type into a realistic document (ideally the one that feels slow) for a few
   seconds.
5. Stop the recording and look at the flame chart. Sort the Bottom-Up view by
   Self Time. On the input path you are looking for time spent in:
   - `tokenizer` / `tokenizerFac` (inline markdown lexer)
   - `getTextContent` (walks the DOM of the content block)
   - `patch` / snabbdom render
   - Vue reactivity (`reactiveEffect`, `trigger`) if the lag is in the shell.

For cross-process analysis (main + renderer + GPU at once), use
[Chrome Tracing](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool).

Reference: [Electron — Performance](https://www.electronjs.org/docs/latest/tutorial/performance).

## The perf tests

There are two complementary perf tests. Both are tagged `@perf` so CI can run
them on a schedule rather than on every PR.

### 1. Per-keystroke redundant-work guard (unit, fast, deterministic)

`packages/muya/src/__tests__/typingPerf.spec.ts`

This does **not** measure wall-clock (flaky in CI/happy-dom). It measures
something deterministic: **how many times the inline `tokenizer` runs for one
keystroke**, and how many of those parses are redundant. Run it:

```bash
pnpm --filter @muyajs/core exec vitest run src/__tests__/typingPerf.spec.ts
```

It logs lines like:

```
[perf] tokenizer calls for one keystroke: 6
[perf] hasBeginRules:false calls (cursor checks) = 1
```

Use these numbers as a baseline. If you optimize the hot path, tighten the
assertions so the win is pinned; if a refactor reintroduces extra parses, the
upper-bound assertions catch the regression.

### 2. Bulk-render smoke (e2e, generous budget)

`packages/muya/e2e/tests/stability/perf.spec.ts`

Loads 10 000 paragraphs via `setContent` and asserts it finishes within a wide
budget. This is a **regression guard against a quadratic blow-up on the render
path**, not a micro-benchmark. It runs against the Vite dev server so the
absolute numbers are slow by design; only large regressions trip it. Run it:

```bash
pnpm --filter @muyajs/core exec playwright test tests/stability/perf.spec.ts
```

## Known hot path: `Format.inputHandler` (per keystroke)

`packages/muya/src/block/base/format.ts` → `inputHandler` runs on every
`input` event in a paragraph/heading/etc. The expensive operation on this path
is the inline markdown **`tokenizer`** (`packages/muya/src/inlineRenderer/lexer.ts`),
a character-by-character scanner that is `O(text length × rule handlers)` per
call.

### The redundant-parse finding

The `tokenizer` was measured running **8 times per keystroke**, with the same
post-edit string parsed **6 times**. The calls break down as:

| Caller                                   | `hasBeginRules`  | Notes                        |
| ---------------------------------------- | ---------------- | ---------------------------- |
| `_checkCursorInTokenType` (inline_math)  | `false`          | cursor-in-token check        |
| `_checkCursorInTokenType` (inline_code)  | `false`          | cursor-in-token check        |
| `_checkCursorInTokenType` (emoji)        | `false`          | cursor-in-token check        |
| `_checkNotSameToken` (oldText)           | `true`           | diff vs. previous text       |
| `_checkNotSameToken` (text)              | `true`           | diff vs. previous text       |
| `checkNeedRender`                        | `true` (+labels) | decides whether to re-render |
| `_convertIfNeeded` / `checkInlineUpdate` | `true`           | block-type promotion         |

### The optimization (implemented)

The three cursor-type checks (math, code, emoji) all tokenize the **same**
string with the **same** options (`hasBeginRules: false`, no labels). They now
share a single tokenization: `inputHandler` parses the text once and threads the
result into `_checkCursorInTokenType` via an optional `precomputedTokens`
argument. This collapsed those 3 parses into 1 (**8 → 6** total calls per
keystroke; the `hasBeginRules: false` count went from 3 to 1).

**Why not a global tokenizer cache?** `tokenizer` returns _mutable_ token
arrays, and other paths mutate them in place (the render path pushes
`token.highlights`; `backspaceHandler` trims `token.raw`). A shared module-level
cache would risk aliasing bugs where one caller corrupts another's cached
tokens. The call-site reuse above is scoped to a single input cycle and only
feeds read-only checks, so it has no such risk.

### Why the remaining parses were left alone

The other four calls are **not** interchangeable:

- `_checkNotSameToken` parses `oldText` (a different string) and `text`.
- `checkNeedRender` uses `hasBeginRules: true` **and** passes `labels`, so its
  token output differs from the cursor checks.
- `_convertIfNeeded` re-derives the block type.

Merging these would require reconciling different begin-rules and labels, which
is higher risk for a smaller gain. Profile first before attempting it.

## Antipatterns to avoid on the input path

Distilled from the Electron performance checklist and web-editor experience:

- **Do not re-tokenize the same string.** Reuse a single parse within one input
  cycle. This is the single most common source of typing lag in a
  markdown-WYSIWYG editor.
- **Do not block the main (renderer) thread** with long synchronous work. For
  anything heavy and non-urgent, use `requestIdleCallback`; for genuinely
  CPU-bound work, use a Web Worker.
- **Prefer `beforeinput` semantics.** Editors like ProseMirror report that
  `beforeinput` makes contenteditable materially faster than reacting after
  `input`; keep that in mind if the event pipeline is ever reworked.
- **Avoid synchronous IPC** (`ipcRenderer.sendSync`) on hot paths — it blocks
  the UI thread. Use `invoke`/`handle` (async).
- **Do not walk the whole DOM more than necessary.** `getTextContent` walks the
  content block's subtree per keystroke; keep the block subtrees small and avoid
  adding extra full-subtree traversals on the input path.
- **Bundle and lazy-load.** Ship a bundled production build; defer expensive
  module loads until first use rather than at startup.

## Checklist when investigating a "slow" report

1. Reproduce in a **production build** (`build:unpack`), not `pnpm dev`.
2. Capture a CPU profile with `perf:inspect` while reproducing.
3. Identify the top Self-Time function on the input/render path.
4. Write or extend a `@perf` test that pins the current cost.
5. Optimize the one hungriest thing. Re-measure. Repeat.
6. Run the full suite (`pnpm --filter @muyajs/core test`) to confirm no
   behavioral regression.
