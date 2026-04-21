---
modified: 2026-04-21
---
# QA Check — Learnings & Running Log

A running record of what's been implemented, what diverged from `implementation-plan.md`, and what we learned along the way. Append to this as we keep building.

## What's shipped (as of 2026-04-21)

The plan's MVP build order had 10 steps (0–9). All 10 are implemented, tested, and deployed to production at `https://qa-checker-beta.vercel.app`. The Vercel Cron for nightly blob cleanup is live on production and will fire at 3 a.m.

Test suite: **135 tests across 16 files, all green**. Every module below was built test-first per the plan's TDD rule.

Commits since the 82516b4 frontend scaffold (in chronological order):

- `0f45c9c` Checkpoint: server-side QA pipeline + client helpers (steps 0-7)
- `8eca673` Step 8: persist results.json + manifest, add /run/:jobId share page
- `49a38ec` Step 9: api/cleanup-blobs.js — 30-day nightly cleanup via Vercel Cron
- `a3194b1` Add src/lib/runQa.js — NDJSON streaming client for /api/run-qa
- `5f57184` Add PromptEditor component — loads via /api/prompt, PUTs on Save
- `1f4aaa0` Wire App.jsx to real backend: PromptEditor, blob upload, streaming QA
- `c075ab7` Add scripts/sync-env-to-vercel.js — local .env → Vercel env sync
- `9063ada` Fix sync-env-to-vercel isMain check for paths with spaces
- `b3a90fd` Rename api/lib → api/_lib, add .vercelignore
- `c65b68f` Adapt handlers to Vercel's Node.js (req, res) signature

#### Module-by-module state

| File | Purpose | Tests |
|---|---|---|
| `api/upload-token.js` | Mint short-TTL client upload tokens scoped to `jobs/{jobId}/**` | 5 |
| `api/prompt.js` | GET/PUT prompts/current.md with etag-based optimistic concurrency + history archive | 6 |
| `api/run-qa.js` | Two-pass Anthropic orchestration, NDJSON streaming, persistence + manifest at end | 26 |
| `api/results.js` | Proxy `/api/results/:jobId` → `jobs/{jobId}/results.json` blob | 4 |
| `api/cleanup-blobs.js` | Bearer-auth cron, `prefix: 'jobs/'`, strict 30-day, batched del | 12 |
| `api/_lib/reconcile.js` | Normalize names + CSV row diff (section 4.19) | 13 |
| `api/_lib/nodeAdapter.js` | Wraps Web-style handlers for Vercel's Node runtime | 5 |
| `src/lib/isImageFile.js` | MIME + extension predicate | 6 |
| `src/lib/folderTraversal.js` | Recursive FileSystemEntry walker for folder drops | 7 |
| `src/lib/upload.js` | `@vercel/blob/client` wrapper, p-limit(6), sanitizing | 7 |
| `src/lib/promptApi.js` | Thin fetch client for /api/prompt with 409 conflict detection | 5 |
| `src/lib/runQa.js` | NDJSON stream reader — buffers mid-line chunks, abort-aware | 8 |
| `src/components/PromptEditor.jsx` | Load/save UI with saved / conflict / saving states | 6 |
| `src/pages/Run.jsx` | `/run/:jobId` share view — fetches results.json snapshot | 6 |
| `scripts/sync-env-to-vercel.js` | Local .env → Vercel env sync via CLI | 13 |

## Divergences from `implementation-plan.md`

The plan was broadly right — the architecture held, every step was buildable, and the TDD cadence worked. But several concrete details had to change in contact with reality. Grouped by severity.

#### Major: handler signature mismatch with Vercel's Node runtime

The plan's `api/cleanup-blobs.ts` example:

```ts
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) ...
}
```

This Web-standard signature (`Request` in, `Response` out) is what the Edge runtime and Next.js App Router use — but **not** what Vercel's default Node.js runtime passes. The Node runtime passes `(req, res)` where `req` is a Node `IncomingMessage` and `res` is a `ServerResponse`. `req.headers` is a plain object, not a `Headers` instance, so `req.headers.get(...)` throws `TypeError: request.headers.get is not a function` on first invocation.

We learned this the hard way — the first preview deploy returned `FUNCTION_INVOCATION_FAILED / 500` on every endpoint. Runtime logs (via `vercel logs <url> --json`) surfaced the exact error.

Fix: added `api/_lib/nodeAdapter.js` with `toNodeHandler(webHandler)` that converts `(req, res)` → Web `Request` → runs the web handler → streams the `Response.body` back to `res`. Each handler now exports:
- named `handler` (Web-style — used by tests, which invoke it directly with `new Request(...)`)
- `default` — `toNodeHandler(handler)`, used by Vercel at runtime

This preserved the entire test suite without rewriting handler logic. Tests all changed from `handler = (await import('./foo.js')).default` to `(await import('./foo.js')).handler`.

Worth remembering next deploy: the plan's code snippets assumed App-Router-style handlers. If we ever want them to *be* that style natively, we'd need either (a) Edge runtime (`export const config = { runtime: 'edge' }`) — but that disallows `fs`, `path`, most Node APIs — or (b) wait for Vercel's Fluid Compute to support web-standard handlers on Node without an adapter.

#### Major: Vercel auto-deploys every file under `api/`

The plan's repo layout showed `api/lib/reconcile.ts` as a helper module. Vercel treats *any* file under `api/` as a serverless function, including `.test.js` files and unprefixed helpers. Our first `vercel inspect` showed 10 Vercel functions, including `api/lib/reconcile`, `api/lib/reconcile.test`, and `api/results.test` — meaning anyone could hit `/api/results.test` in production and fail-execute our test file.

Fix, two parts:
1. Rename `api/lib/` → `api/_lib/`. Vercel's documented convention: directories prefixed with `_` are treated as library code, not functions.
2. Add `.vercelignore`:
   ```
   **/*.test.js
   **/*.test.jsx
   **/*.test.ts
   **/*.test.tsx
   src/test/
   scripts/
   ```

Function count dropped from 10 → 5 clean endpoints: `upload-token`, `prompt`, `run-qa`, `results`, `cleanup-blobs`.

Future rule: in Vercel projects, never put helpers directly in `api/`. Either use `_` prefix or put them outside `api/` entirely.

#### Moderate: results.json blob isn't directly fetchable by pathname

The plan said: *"Client adds a route: `/run/:jobId` that fetches `jobs/{jobId}/results.json` and renders the same results UI."*

Problem: Vercel Blob URLs include an unguessable random suffix (`https://abc123.public.blob.vercel-storage.com/jobs/J/results-xYz9.json` or similar). You can't construct the URL from the pathname — you have to look it up via the `head()` SDK call, which requires the `BLOB_READ_WRITE_TOKEN` (a server secret).

Added `api/results.js` as a thin proxy: given a `jobId` in the path, call `head('jobs/{jobId}/results.json')`, fetch the resulting URL, return the body. Client `Run.jsx` now fetches `/api/results/${jobId}`. A `vercel.json` rewrite maps `/api/results/:jobId` → `/api/results?jobId=:jobId` so the handler can accept both path-style and query-string forms (and the tests can invoke with the pathname style without the rewrite).

Also validated the jobId against `^[A-Za-z0-9_-]+$` to prevent path traversal (e.g. `../prompts/current.md`).

#### Moderate: `api/prompt.js` reads `src/defaultPrompt.md` via `fs`

The plan specified a bundled SOP default as a fallback when the `prompts/current.md` blob doesn't exist yet (first run). Implemented via:

```js
readFileSync(resolve(here, '../src/defaultPrompt.md'), 'utf8')
```

Works in tests (runs from repo root). Might break at deploy time if Vercel's function bundler doesn't ship the `src/` tree with the `api/prompt.js` function. Not tested in production yet (we haven't hit the GET path with an empty blob store on the deployed app). Flagged but not fixed — worth verifying on first production GET `/api/prompt` and, if broken, inlining the default into the handler as a string constant.

#### Minor: Results.json path contains random suffix anyway

Above proxy solves this, but it's worth flagging for any later work: even when you `put()` with a fixed pathname, Vercel Blob may return a URL with a random suffix depending on account settings. Don't assume `jobs/X/results.json` → a predictable URL.

#### Minor: Sharing link navigation

Plan said the client generates `/run/:jobId` link after the run. Implemented — App.jsx sets `shareUrl` when the `persisted` event fires. Navigation to that URL is just a regular `<a href>`, not `navigate()`. Fine for MVP.

#### Minor: `results.json` is persisted inside the stream, not after it

Plan showed persistence as a step "before returning" from the handler. In the streaming world, that's a subtly different thing — the stream can't close until the `put()` finishes, otherwise the client might disconnect mid-persistence. Implementation: `put()` happens inside `ReadableStream.start()` after all pass A/B/reconcile events emit, then emits `{kind: 'persisted', resultsUrl}` or `{kind: 'persist_error', error}`, then `{kind: 'done'}`, then `controller.close()`. Snapshot is durable before the stream closes.

## Deployment & provisioning — the long gauntlet

This is where most of the learning happened. Plan had a "Setup Checklist" and a "Cleanup" section, both mostly accurate, but the actual deploy involved a series of surprises worth recording.

#### Environment variable provisioning

Plan said:
- `BLOB_READ_WRITE_TOKEN` — auto-provisioned when you create a Blob store
- `ANTHROPIC_API_KEY` — your Anthropic key
- `CRON_SECRET` — any long random string

That's all correct, but the *process* to get them set up is:

1. `vercel link` (once per machine, from repo root). Connects your local checkout to the project so CLI operations target it.
2. `vercel blob store add <store-name>`. This CLI command exists (I wasn't sure initially — verified via `vercel blob --help`). When the store is created while linked, Vercel prompts "Would you like to link this blob store to <project>?" and asks which environments. Selecting Production/Preview/Development writes `BLOB_READ_WRITE_TOKEN` to the project's env on all three environments automatically.
3. `vercel env pull .env.vercel --environment production` to pull the token into a local file. **Caveat**: this pulls a lot of noise — `VERCEL_*`, `TURBO_*`, `NX_DAEMON`, `VERCEL_OIDC_TOKEN`, `VERCEL_GIT_*`, etc. ~22 vars in our case. Only the last one (`BLOB_READ_WRITE_TOKEN`) is ours. Filter with `grep '^BLOB_READ_WRITE_TOKEN=' .env.vercel >> .env` and delete the temp file. Never use `vercel env pull .env` directly — it **overwrites** (not merges), so you'd lose any secrets you generated locally (e.g. `CRON_SECRET`).
4. Generate `CRON_SECRET` locally: `openssl rand -hex 32`.
5. Get `ANTHROPIC_API_KEY` from https://console.anthropic.com/settings/keys — no CLI path for this one, ever.

#### The sync-env script

The plan didn't include this, but after setting up the keys we wanted a way to push them to Vercel without clicking the dashboard. Ported from `~/Dropbox/projects/music-affirmations/backend/scripts/sync_env_to_vercel.py` to Node at `scripts/sync-env-to-vercel.js`.

Behavior: read local `.env`, `vercel env pull` remote, categorize into unchanged / changed / new, print a diff (with **values masked** — just key names + byte lengths), prompt for confirmation, apply via `vercel env add KEY env` across production/preview/development (6 invocations per new/changed key). Values piped via stdin.

The `vercel env add` command treats the first newline in stdin as EOF, so values can't contain literal newlines — matches the `.env` file format's constraint.

**Gotcha**: first run did nothing — zero output. Cause: the `isMain` check used string compare between `import.meta.url` and `'file://' + process.argv[1]`. `import.meta.url` is URL-encoded (`file:///Users/.../1%20Projects/...`) but `process.argv[1]` is raw (`/Users/.../1 Projects/...`). The string compare silently fails on paths with spaces, and `main()` never runs. Fixed with `fileURLToPath(import.meta.url) === resolve(process.argv[1])`. **General lesson**: any Node script that uses the "run main if top-level" idiom needs this pattern, not naive string compare, if paths might contain spaces.

#### Deployment attempts

1. **First `vercel deploy --yes`**: built, showed 10 λ functions including test files. Addressed with `_lib` rename + `.vercelignore`.
2. **Second deploy**: clean 5 functions, but all endpoints returned 500 `FUNCTION_INVOCATION_FAILED`. Three hypotheses investigated:
   - (a) Vercel's **Deployment Protection** (SSO gate on preview deployments, free on all plans by default). Verified by `curl` returning HTML with a "Authentication Required" title and a `<script type="text/llms.txt">` block (Vercel now includes LLM-readable hints in auth pages 👀). User disabled this project setting in the dashboard.
   - (b) After disabling SSO, still got 500. `vercel curl` (CLI tool that tunnels through with CLI auth) also returned 500. So not a protection issue — an actual function error.
   - (c) `vercel logs <url> --json` revealed the real cause: `TypeError: request.headers.get is not a function at isAuthorized (file:///var/task/api/cleanup-blobs.js:7:34)`. This is where the handler signature issue was diagnosed. See "Major" divergence above.
3. **Third deploy**: handlers adapted via `toNodeHandler`. 401/401/200 cron test all correct on preview.
4. **Prod deploy**: `vercel deploy --prod --yes` promoted to `qa-checker-beta.vercel.app`. Retested — same 401/401/200 on production. Vercel Cron activates only on production deploys, so the nightly schedule is now live.

#### Vercel SSO protection on preview deployments

Unmentioned in the plan. By default, Vercel projects on new accounts have **Deployment Protection** enabled on preview and production deployments. All requests get intercepted by Vercel's SSO layer *before* reaching your functions. Effect: `curl` to any endpoint returns HTML with HTTP 401, regardless of your own auth logic. To debug functions via `curl`, either:
- Disable protection in Project Settings → Deployment Protection
- Use `vercel curl <path> --deployment <url>` which injects the CLI's auth token
- Use `--protection-bypass <secret>` with a bypass secret from the dashboard

We disabled it for this project since the blob paths are already unguessable.

## Unit testing patterns that worked well

- **`vi.mock` at the top of the file** for module-level mocks (`@vercel/blob`, `@anthropic-ai/sdk`, `@vercel/blob/client`). Keeps every test fully pure — no network, no SDK state.
- **`beforeEach` → `vi.resetModules()` → dynamic import** of the handler. This ensures each test gets a fresh module state even when using mutable module-scoped state (e.g. the bundled-default cache in `prompt.js`).
- **`vi.stubGlobal('fetch', fetchMock)`** for global fetch stubs.
- **Hand-rolled fake Blob store** as `new Map()` with a mocked `head()` / `put()` / `list()` / `del()` that reads and writes it. Lets round-trip tests verify persistence end-to-end within a single test.
- **Web API `Request` + `ReadableStream` work natively in Vitest + jsdom**, so tests can invoke Web-style handlers directly and read streaming responses with a `for await` reader. The `collectStream` helper in `run-qa.test.js` is reusable across any NDJSON-emitting endpoint.
- **React Router testing via `MemoryRouter` + `Routes`/`Route`**. `initialEntries={['/run/JOBX']}` drives the component into the right route without needing `window.history`.
- **Mock the MDEditor in PromptEditor tests**. Replacing `@uiw/react-md-editor` with a plain `<textarea data-testid>` keeps tests focused on state and API, not on the third-party editor's DOM.
- **Fake `FileSystemEntry` for folder drag tests**. Hand-build `{ isFile, isDirectory, name, file(cb), createReader() → { readEntries(cb) } }` with pagination (returns empty array after N calls).

## Known issues / outstanding work

#### Flaky wall-clock test in `run-qa.test.js`

The "Pass A + Pass B run in parallel" test (line ~589) uses real timers and asserts `elapsed < 130ms` for three 50ms parallel calls. It passed once, failed once, passed again in the same session. Should be converted to fake timers (`vi.useFakeTimers()` + `vi.advanceTimersByTime`) or a signal-based parallelism assertion. Not urgent — the test is correct in spirit.

#### Vite warning: 1.3 MB production bundle

`vite build` warns the main chunk is over 500 KB. Mostly the MD editor + its markdown preview deps. The app works, but first-load TTI on slow connections is bad. Future: code-split `PromptEditor.jsx` behind a dynamic `import()` so the MD editor only loads when the user clicks "Edit QA Prompt". Would cut initial bundle ~60%.

#### `api/prompt.js` fs path at deploy time

See Moderate divergence #4 above. Untested in production. Verify by hitting GET `/api/prompt` before any prompt has ever been saved. If it returns the right default, we're fine. If it errors, inline the default into the handler.

#### End-to-end smoke test not run

We've verified:
- ✅ Cleanup cron endpoint end-to-end on prod (401/401/200)
- ✅ Env vars synced to all three environments
- ✅ Build + deploy succeeds

We have NOT yet:
- ❌ Uploaded a real image batch through the deployed UI
- ❌ Triggered a real `/api/run-qa` against the live Anthropic API
- ❌ Confirmed `results.json` is persisted and `/run/:jobId` renders it
- ❌ Verified `PromptEditor` can load + save through the deployed `/api/prompt`
- ❌ Checked the cron actually fires at 3 a.m. (verify tomorrow morning via `vercel logs`)

This is the natural next step.

#### Future: private blobs (Tier 3)

Plan's Tier 3 mentions switching from `access: 'public'` to private blobs. Not needed for MVP. Note: Anthropic's `{ type: 'image', source: { type: 'url' } }` requires a publicly-GET-able URL, so private blobs imply signed-URL minting per run. Keep public for now; revisit only if privacy becomes a real ask.

## Quick-reference commands

```bash
# Deploy preview
vercel deploy --yes

# Promote to production
vercel deploy --prod --yes

# Tail runtime logs (5-minute window from now)
vercel logs <deployment-url-or-alias> --json

# Sync local .env to Vercel
npm run sync:env

# Pull env from Vercel (filter by name to avoid pollution)
vercel env pull .env.vercel --environment production
grep '^BLOB_READ_WRITE_TOKEN=' .env.vercel >> .env
rm .env.vercel

# Manually trigger the cleanup cron (prod)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://qa-checker-beta.vercel.app/api/cleanup-blobs

# Inspect what Vercel sees as functions
vercel inspect <deployment-url>
```

## Running log — what to add to this file going forward

Use this section going forward as new things get learned. Append as a new `##` section at the bottom with a date heading. Examples of what belongs here:

- Production bugs and their root causes (the fix is in the commit; the *why* goes here)
- New Vercel / Anthropic / Blob behaviors you discover the hard way
- Performance changes (e.g. "bundle dropped to 700 KB after code-splitting")
- Any deviation from the plan that's significant enough to re-read later
- "Turns out X doesn't work the way we thought" items

Things that don't belong here: commit messages (git log has those), TODO items (use an issue tracker), task-specific debug notes (those are ephemeral).

## 2026-04-21 — Post-MVP iteration session

Ten commits after the initial learnings write. Broadly: editor overhaul, a single-call pipeline rewrite, three silent-failure fixes stacked on top of each other, and two UX filters. Tests now **147 across 17 files, all green**.

Commits (chronological):

- `39aa708` Swap `@uiw/react-md-editor` for Milkdown Crepe (WYSIWYG)
- `414f914` Add conflict recovery UX: Overwrite anyway + focus-based etag refresh
- `2bbe0f5` Max out vertical space in the Edit Prompt modal
- `1359f3d` Single Anthropic call for the whole batch + "Show minor issues" toggle
- `ba1f77b` Fix silent failure mode on large batches: raise max_tokens + surface errors
- `f446253` Bump MAX_TOKENS to 128000 (Opus 4.7's actual sync-API ceiling)
- `7a63c28` Switch run-qa to `messages.stream()` — SDK rejects non-stream long calls
- `6de39b0` Bump run-qa `maxDuration` to 800s (Fluid Compute ceiling)
- `2c3511f` Client-side image resize to 2000px for Anthropic's many-image limit
- `72685d6` Add "Show clean images" toggle — hide passes by default

#### Milkdown Crepe replaced `@uiw/react-md-editor`

The MD editor was a split-pane (source + preview) that felt like editing Markdown source with a preview tab. User wanted a visual-first WYSIWYG — edit the rendered output directly, Notion-style.

Surveyed the landscape: TipTap (solid, but doesn't store markdown natively — converts on load/save, lossy on edge cases), Lexical (Meta's framework, heavy and not markdown-native), ProseMirror directly (too low-level), Milkdown (built on ProseMirror, markdown-first by design, Crepe preset is the drop-in Notion-alike). Picked Milkdown Crepe.

Integration in `src/components/PromptEditor.jsx`:
- `mode: 'visual' | 'source'` toolbar toggle. Visual mode mounts Crepe into a div; source mode renders a plain textarea.
- `currentMarkdown()` pulls from whichever is active (Crepe's `editor.action(getMarkdown())` or the textarea value).
- `performSave(ifMatchOverride)` factors out the PUT so both Save and Overwrite-anyway paths share it.
- Clean switch between modes without losing content: read markdown from the source you're leaving, pass as initial content to the mount you're entering.

Gotcha: Milkdown's editor instance is async to create. Tests mock the whole `@milkdown/*` ecosystem with a plain textarea stub (`data-testid="prompt-editor"`), so PromptEditor tests stay focused on state + API behavior.

Bundle impact: ~1.38 MB after Milkdown (up from ~1.3 MB before). Still under a single chunk; still flagged by Vite. Code-splitting PromptEditor would reclaim most of this on initial load. Not fixed yet.

#### Optimistic concurrency — both recovery paths

`api/prompt.js` has been etag-gated from the start (If-Match → 409 on mismatch). The missing piece was client UX. Implemented two options together:

**Option A — "Overwrite anyway" on 409.** When Save gets a conflict response, PromptEditor shows a red banner with two buttons: `Save again (keep my changes)` and `Discard my changes`. Save-again re-fetches the current etag, then PUTs with that etag + local content. Discard resets to the server's current content.

**Option B — Focus-based silent etag refresh.** `window.addEventListener('focus', ...)` fires a lightweight GET to re-check the etag. If the etag advanced while away, show a yellow info banner: "The prompt was updated elsewhere. Saving now will overwrite." No automatic reset — user decides. Avoids the "I came back to my tab and my edits got blown away" footgun.

Both hit the same `performSave(ifMatchOverride)` path. Conflicts stopped being confusing immediately.

Incidental lesson: while iterating, my own `curl` tests to `/api/prompt` advanced the server etag and caused the user's UI to 409. Not a bug — the system working. But a reminder that tooling-that-mutates-state can bite the user's session if they're actively editing.

#### Modal became nearly full-screen

User wanted the prompt editor to take up the whole screen real estate. Removed the `.modal__header` title bar entirely. Added `.modal--tall`:

```css
.modal--tall {
  max-width: 1100px;
  height: calc(100vh - 24px);
  max-height: none;
}
```

Plus a tighter toolbar (10px padding vs 16px) and `.prompt-editor__body` with `flex: 1; min-height: 0; overflow-y: auto`. The editor body now fills all remaining vertical space. Save / Edit source / Close buttons moved into the toolbar as `.prompt-editor__btn`.

#### Pipeline rewrite: single Anthropic call, not per-image

Original design (two-pass): Pass A called Anthropic once per image in parallel (`p-limit(6)`), Pass B called once more with all the CSV + per-image summaries for batch-level reconciliation. Rationale at the time: image analysis parallelizes well, batch reconciliation needs the full context.

Problem in reality: Pass A has no global view. Each image call gets *one* image and the full CSV, so when Claude sees "image labeled Alice" but can't see the rest of the images, it can't reason about things like "this design's customer name doesn't match anything in the CSV" without false-flagging cases that *do* match (because the match exists on an image it can't see).

Fix: collapse to a single call with **all images + the full CSV** in one user message. Model has global visibility. Findings became dramatically more accurate for the failure mode user was hitting (false "missing" flags).

Cost implication: single call is cheaper than N+1 calls for the same content (no per-call overhead, better cache reuse via `cache_control: ephemeral` on the CSV block). Latency worse in theory (no parallelism) but in practice the model handled 30–40 images in a single 30–90s call, comparable to the old two-pass total.

The single-call rewrite also deleted the reconciliation step's runtime role — Claude now does reconciliation itself. `api/_lib/reconcile.js` is still in the tree (still exported, still tested) but not imported by `run-qa.js`. Could be removed in a future cleanup pass if we commit to this design.

The flaky "parallel pass A" wall-clock test (previously flagged) is obsoleted by this rewrite. Gone.

#### The three-stack silent-failure fix

After the pipeline rewrite, a 36-image batch returned "0 findings" with no visible error. Three separate bugs stacked:

1. **`max_tokens: 8192` was too low.** A 36-image batch with findings for each easily blew past 8K output tokens. Claude hit the cap mid-JSON-output → SDK returned a truncated response with `stop_reason: 'max_tokens'` → our parser failed on malformed JSON → emitted `{kind: 'parse_error'}` to the stream.

2. **Client had no branch for `parse_error`.** The stream event reducer accumulated findings but ignored error events. UI just showed an empty "Per-image findings" section when the stream ended. Looked identical to "no issues found."

3. **`api/run-qa.js` didn't check `stop_reason`.** Even if parsing had succeeded, a truncated response should be surfaced as a run error, not a successful empty result.

All three fixed together:
- `MAX_TOKENS = 32000` initially, then user pointed out Opus 4.7 supports 128K sync → bumped to `128000`.
- `run-qa.js` checks `res.stop_reason === 'max_tokens'` and emits `{kind: 'error', subkind: 'truncated', message: 'Model output exceeded max_tokens ...'}`.
- Snapshot now includes `runError: { kind, subkind, message, raw }` field. Both `RunView` (App.jsx) and the share page (`Run.jsx`) render a red `.run-error` panel at the top when present, with a `<details>` block for the raw first-4KB model output so the user can diagnose.
- Stream reducer merges `error` / `parse_error` events into `run.runError` so they survive through to persistence and the share page.

**Lesson**: silent empty-result failures are the worst UX. Any pipeline that "returns findings" needs an explicit distinguishable error state at every level — API response, stream event, UI, persisted snapshot. We had the error plumbed at the API layer but not at the UI or snapshot layers.

#### Streaming API switch

After bumping to 128K tokens, Anthropic's SDK rejected the call:

```
Streaming is required for operations that may take longer than 10 minutes.
```

Switched from `anthropic.messages.create({...})` to `anthropic.messages.stream({...}).finalMessage()`. Same return type (`Message`), but the SDK internally streams the response, which uncaps the 10-minute synchronous limit.

Test update: the mock now routes both `messages.create` and `messages.stream` through a single `createMock` helper that returns an object with `.finalMessage()` resolving to the canned response. Existing tests kept working unchanged.

#### `maxDuration = 800s` and Vercel Fluid Compute

Default function `maxDuration` is 300s. To exceed it, the project must be on Vercel Fluid Compute (which our Hobby plan supports), and `vercel.json` must declare the function's `maxDuration`:

```json
"functions": {
  "api/run-qa.js": { "maxDuration": 800 }
}
```

800s is the current Fluid Compute ceiling for Hobby (higher on Pro). Picked for safety — a 40-image batch shouldn't take anywhere near this, but the streaming API plus huge output tokens means we'd rather have headroom than hit a timeout mid-generation.

#### Client-side image resize (2000px max dimension)

Anthropic rejects images > 2000px on either dimension when you send many in a single call. Fix: resize client-side before upload.

Added `src/lib/resizeImage.js`:
- `computeResizedDimensions(w, h, max=2000)` — pure math, returns `{ width, height, scaled }` with proportional scaling and integer pixel rounding. Easy to test (7 tests around edge cases: exactly-at-max, one dim over, rounding, tiny images).
- `resizeImageIfNeeded(file)` — async wrapper: load into `Image`, check dimensions, skip non-images (CSV) and SVG (vector), skip if already ≤ max. Otherwise draw to canvas, `toBlob()` as JPEG 0.92 (PNG preserves transparency → 0.92 saves ~4× over PNG). Preserves `relativePath` / `webkitRelativePath` via `Object.defineProperty` on the new File. Graceful degradation: on decode error, return the original file and let Anthropic reject if it's genuinely unsupported.

Wired into `beginQa` in App.jsx: runs before upload, progress phase `resizing`. No third-party deps — canvas API is native.

Testing pattern worth remembering: jsdom doesn't decode images or produce canvas bitmaps, so tests stub `Image` (async constructor → `onload`), stub `URL.createObjectURL`, and spy-replace `document.createElement('canvas')` with a fake that has `getContext()` + `toBlob()`. See `src/lib/resizeImage.test.js`.

#### Filter toggles: minor issues + clean images

Two checkboxes at the top of the results page, both default **off** to surface what actually needs attention:

- **Show minor issues** — filters out findings where `severity` matches `/minor/i`. When off, shows "({N} hidden)" next to the label. Applied to both per-image findings and batch-level findings.
- **Show clean images** — hides images with `findings.length === 0 && !error`. When off, shows "({N} hidden)". Applied after the minor-issues filter, so an image whose only findings were minor becomes "clean" when `showMinor` is off and gets hidden too.

Both live in `RunView` (App.jsx) and the share page (`Run.jsx`). Kept in sync by copy-paste, which is fine for now — the share page is <50 lines of different markup.

General lesson on UX: when the model flags lots of stuff, the default view should be *just the things that need action*. Every "No issues found ✓" row is visual noise the user has to scroll past. Filters with sensible defaults beat "show everything and let the user figure it out".

## Pending (next session)

#### Magnifying-glass lightbox

User wants each result image to have a magnifying-glass icon in the top-right corner. Click → full-screen lightbox with an X close button in the top-right. Apply to both `RunView` and the share page.

Design sketch:
- New `src/components/ImageLightbox.jsx` — overlay, centered img, Escape-to-close + backdrop-click-to-close + X button. Pure presentation, props `{ src, onClose }`.
- Button positioned absolute in `.results__image` / `.run-page__image`. SVG icon inlined.
- Shared state in the parent (RunView / Run.jsx): `const [lightboxSrc, setLightboxSrc] = useState(null)`.

#### Share-page image sizing bug

`src/pages/Run.jsx` uses its own CSS classes (`.run-page__image`) that don't match `RunView`'s `.results__image` sizing. On the share page, images render much larger than the live view. Fix: either rename Run.jsx's classes to reuse `.results__*`, or clone the same rules under the `.run-page__*` names. Probably reuse — there's no reason the two views should diverge.

#### `api/prompt.js` fs path still untested in prod

Flagged in the previous section. GET `/api/prompt` on a fresh deploy (before any prompt has been saved to blob) would exercise the `readFileSync('../src/defaultPrompt.md')` fallback. Still unverified on deployed Vercel.

#### Reconciliation code is dead

`api/_lib/reconcile.js` + its 13 tests aren't wired into anything since the single-call rewrite. Either delete (if we're committed to letting Claude reconcile) or re-integrate (if we want deterministic cross-check on top of Claude's output). Leaning delete — adds confusion otherwise.

#### Bundle size

Still ~1.38 MB. Code-split PromptEditor to trim ~800 KB off the initial load. Low-priority until someone complains about TTI.
