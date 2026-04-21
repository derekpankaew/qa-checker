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
