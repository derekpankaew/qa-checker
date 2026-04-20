---
modified: 2026-04-20T15:36:24-07:00
---
# QA Check — Implementation Plan

Serverless Paper Anniversary QA tool. Vercel Blob for storage, Vercel functions for orchestration, Anthropic API for analysis. No AWS, no database, no queue.

## Architecture

```
Browser (React, current app)
   │
   ├─ 1. POST /api/upload-token    ──▶ Vercel fn ──▶ returns client upload token
   ├─ 2. Upload images/CSVs        ──▶ blob.vercel-storage.com (direct from browser)
   ├─ 3. POST /api/run-qa          ──▶ Vercel fn ──▶ Anthropic (parallel, streamed)
   ├─ 4. Render results as they stream in
   └─ 5. Share via /run/:jobId URL ──▶ fetches jobs/{jobId}/results.json from Blob
```

One vendor. One pay-as-you-go bill. No databases.

## End-to-End Flow

### 1. Prompt management (persisted in Blob)

The QA prompt is a **shared team resource** — all users see and edit the same prompt. Persisted in Vercel Blob, not localStorage.

**Storage:**
- `prompts/current.md` — the live prompt everyone reads and edits.
- `prompts/history/{ISO-timestamp}-{shortHash}.md` — full history, one file per save. Enables "view/revert to previous version" later.

**Endpoints:**
- `GET /api/prompt` → Vercel fn reads `prompts/current.md` from Blob, returns `{ content, updatedAt, etag }`.
- `PUT /api/prompt` → accepts `{ content, ifMatch? }`, writes the new version to `prompts/current.md` and archives to `prompts/history/...`. Returns the new etag.

**On app load**: client calls `GET /api/prompt` and populates the editor. Falls back to the bundled SOP default if the blob doesn't exist yet (first run).

**On save**: client calls `PUT /api/prompt` with the new content. Editor shows a "saved" indicator.

**Concurrency**: last-write-wins for MVP (small team). Endpoint accepts an optional `ifMatch: etag` header — if the stored etag has changed since the client loaded, return 409 so the UI can show a conflict warning. Can be added in a follow-up if collisions actually happen.

**"Ask AI to change prompt" chat** posts to a future `/api/ai-edit-prompt` endpoint that returns a proposed new version. User reviews the diff and confirms → triggers a normal `PUT /api/prompt`. Same persistence path.

**Snapshot per run**: the prompt content is still copied into `jobs/{jobId}/results.json` at run time (see step 6). That way, shared `/run/:jobId` links always display the prompt exactly as it was when the run executed — even if someone edits the team prompt afterward.

### 2. File upload (client-side, direct to Blob)

Client generates a `jobId = crypto.randomUUID()` once per run. For every file:

- Call `@vercel/blob/client`'s `upload()` helper with `handleUploadUrl: '/api/upload-token'`.
- `/api/upload-token` returns a short-TTL token scoped to `jobs/{jobId}/images/{uuid}-{filename}` (or `csvs/…`).
- Browser `PUT`s straight to Vercel Blob. **The Vercel function never touches the bytes** → no 4.5 MB body limit, no bandwidth billed through the function.
- Run ~6 uploads in parallel via `p-limit`.

### 3. Begin QA

Client POSTs to `/api/run-qa`:

```json
{
  "jobId": "...",
  "prompt": "...markdown contents...",
  "imageUrls": ["https://blob.vercel-storage.com/jobs/.../image1.jpg", ...],
  "csvUrls":   ["https://blob.vercel-storage.com/jobs/.../orders.csv",  ...]
}
```

`imageUrls` / `csvUrls` are the public URLs returned by `upload()` in step 2.

### 4. Fan-out + stream (two-pass analysis)

The SOP has **per-image checks** (sections 4.1–4.16) and **batch-level checks** (sections 4.17, 4.19, 4.21, and the opening status check) that require the whole spreadsheet at once. We run them as two parallel passes, then a deterministic reconciliation step.

#### Shared cached prefix

Every Anthropic call (per-image and batch) uses the same cached prefix, built once at the start of `/api/run-qa`:

1. **System message**: the full QA prompt (from `prompts/current.md`).
2. **Full raw CSV text** — *every column, every row*, unmodified. The SOP explicitly requires `Full Customization, Sort Column, Size, World/USA, Material, Pin Type (short), Type of pins (long), Names, Dates, Customer Comments, Internal Notes, Pins Wording, Shipping`, etc. We do not pre-filter columns because Full Customization is the authoritative source and the model needs to see all columns to detect populating errors (section 4.21). If multiple CSVs were uploaded, concatenate them with a header divider.
3. Marked with `cache_control: { type: 'ephemeral' }` so Anthropic caches it for 5 minutes. First call pays full input cost; subsequent calls pay 10% cache-read.

#### Pass A — Per-image (sections 4.1–4.16)

In parallel, capped at 10 concurrent via `p-limit`:

- Each call gets the cached prefix + the image + an instruction: *"Analyze this design. Find the matching row in the CSV (match by customer name on the artboard label). Run sections 4.1 through 4.16. Return JSON: `{ findings: [...], extractedLabel: { customerName, size, material, mapType, pinType, dueDate, ... } }`."*
- `extractedLabel` is captured for the reconciliation step below.
- As each call resolves, write one NDJSON line to the response stream with `{ kind: "image", imageUrl, findings, extractedLabel }`.

#### Pass B — Batch overview (sections 4.17, 4.19 partial, 4.21, status check)

Runs **in parallel with Pass A**. No images attached — just the cached prefix + an instruction:

> *"You are running batch-level QA checks. You have the full CSV above. Run: (a) the opening status check (image count vs. CSV row count — the function will supply the image count), (b) section 4.17 (flag similar customer names across the batch), (c) section 4.21 (populating errors — every detail in Full Customization must match the populated columns). Do NOT analyze individual designs — that's handled separately. Return JSON: `{ findings: [{ scope, customerName, issue, severity }] }`."*

One call, one response. Cheap because no image tokens. Streams as `{ kind: "batch", findings }`.

#### Reconciliation — section 4.19 "Missing Designs"

Done in code after Pass A completes, not via LLM — it's deterministic:

- Parse CSV → list of expected `{ customerName, rowIndex }`.
- From Pass A, collect `extractedLabel.customerName` for every processed image.
- Fuzzy-match expected names against extracted names (normalize case/whitespace, tolerate "&" vs "and").
- Emit `{ kind: "missing", customerName, rowIndex, issue: "Order in spreadsheet but no matching design found" }` for each unmatched row.

One line of NDJSON per missing order.

#### Merge + persist

After all streams close, the function collapses the three sources into the final `results.json`:

```ts
{
  jobId, prompt, csvUrls, imageUrls, createdAt,
  statusCheck: { imagesReceived, csvRowCount, ... },
  perImageResults: [...],      // Pass A
  batchFindings: [...],        // Pass B
  missingDesigns: [...],       // reconciliation
}
```

The UI groups results into "Per-image findings", "Batch-level findings", and "Missing designs" sections.

### 5. Browser consumes the stream

`fetch()` → `response.body.getReader()` → decode NDJSON line-by-line → push each result onto the results list. Progressive UX, no polling.

### 6. Persist final results (Tier 1 sharing)

At the end of `/api/run-qa`, before returning:

```ts
await put(`jobs/${jobId}/results.json`, JSON.stringify({
  jobId, prompt, imageUrls, csvUrls, results, createdAt
}), { access: 'public' });
```

Also write `jobs/{jobId}/manifest.json` with the input metadata (prompt, file list, timestamp) so the share page can show the inputs alongside the results.

Client adds a route: `/run/:jobId` that fetches `jobs/{jobId}/results.json` and renders the same results UI. **Sharing = copy the URL.**

## Key Technical Decisions

| Decision | Why |
|---|---|
| **`@vercel/blob/client.upload()`** | ~10 lines total. Handles token minting + direct upload. No AWS account, no IAM, no CORS config. |
| **`access: 'public'` blobs** | Anthropic needs `GET` access to the image URL. Blob URLs include an unguessable random suffix — practical security is fine for short-lived design files. Upgrade to private blobs in Tier 3. |
| **URL-source image blocks to Anthropic** | `{ type: 'image', source: { type: 'url' } }` avoids base64 round-trip through Vercel. Saves memory, latency, egress. |
| **NDJSON streaming response** | Progressive UI. No DB. No polling endpoint. Total timeout bounded by the slowest single call, not the sum. |
| **Fluid Compute function for `/api/run-qa`** | `maxDuration: 300` in `vercel.json`. Default 10 s is far too short for image QA batches. |
| **Client-generated `jobId`** | The Blob path *is* the record. No DB lookup needed. |
| **Full raw CSV inlined (every column, every row)** | SOP section 4.21 (populating) requires comparing Full Customization against every populated column. Pre-filtering columns would break that check. Loaded once into the cached prefix, reused across every call. |
| **Prompt caching on the shared prefix** | Big QA prompt + full CSV would be expensive per call at full price. With `cache_control: ephemeral`, first call pays full input cost; all subsequent calls (per-image + batch) pay 10% cache-read. |
| **Two-pass analysis (per-image + batch-overview)** | Per-image calls give clean scoping and accuracy for sections 4.1–4.16. A single no-image batch call handles sections 4.17 and 4.21 which require the whole spreadsheet at once. |
| **Deterministic reconciliation for "missing designs"** | Section 4.19 is a set-difference between CSV rows and processed image labels. Code is more reliable than an LLM for this, and adds no API cost. |
| **`p-limit(10)` concurrency cap on Pass A** | Stays under Anthropic's per-minute token rate limit on larger batches. The single batch-overview call (Pass B) runs independently. |
| **`results.json` in Blob as system of record** | Enables shareable links (Tier 1) with zero additional infrastructure. |
| **Prompt persisted in Blob, not localStorage** | Prompt is a shared team artifact, not per-browser state. `prompts/current.md` + `prompts/history/...` gives us durability, shared editing, and rollback without a DB. |
| **Snapshot prompt into `results.json`** | Shared run links must render the prompt as it was *at execution time* — otherwise old shared runs get misleading context once the team prompt evolves. |
| **Nightly Vercel Cron for 30-day blob expiration** | Vercel Blob has no native TTL (confirmed April 2026). Cron scans `prefix: 'jobs/'` only, deletes by `uploadedAt` age. `prompts/` is never listed, never deleted. |

## Repo Layout

```
qa-check/
├── src/
│   ├── App.jsx                  # existing — extend with /run/:jobId route
│   ├── lib/
│   │   ├── upload.ts            # @vercel/blob/client wrapper
│   │   └── runQa.ts             # POST + NDJSON stream reader
│   └── pages/
│       └── Run.jsx              # /run/:jobId share-view page
├── api/
│   ├── upload-token.ts          # handleUpload() from @vercel/blob/client
│   ├── prompt.ts                # GET/PUT prompts/current.md (+ history archive on PUT)
│   ├── run-qa.ts                # Anthropic fan-out, streams NDJSON, writes results.json
│   └── cleanup-blobs.ts         # nightly cron: deletes jobs/ blobs older than 30 days
├── vercel.json                  # maxDuration + crons config
└── .env
```

**Env vars:**
- `BLOB_READ_WRITE_TOKEN` — auto-provisioned when you create the Blob store.
- `ANTHROPIC_API_KEY` — your Anthropic key.
- `CRON_SECRET` — any long random string; used to authenticate the nightly cleanup cron.

## Setup Checklist

### Vercel dashboard
1. Create a Blob store on the project → auto-provisions `BLOB_READ_WRITE_TOKEN`.
2. Enable **Fluid Compute** on the project (for longer function timeouts).
3. Add `ANTHROPIC_API_KEY` env var.
4. Add `CRON_SECRET` env var (any long random string — used by the cleanup cron).

### Code
1. `npm install @vercel/blob @anthropic-ai/sdk p-limit react-router-dom`.
2. Implement `api/upload-token.ts` — a ~20-line `handleUpload()` wrapper.
3. Implement `api/run-qa.ts` — streaming response, `p-limit(10)` fan-out, writes `results.json` on completion.
4. Replace the current `imageFiles` client state with `blobUrls` after upload completes.
5. Add `vercel.json`:
   ```json
   { "functions": { "api/run-qa.ts": { "maxDuration": 300 } } }
   ```
6. Add `/run/:jobId` route that fetches `jobs/{jobId}/results.json` and reuses the existing results UI.

### Cleanup — 30-day expiration via Vercel Cron

**Vercel Blob has no native TTL (confirmed April 2026).** Uploaded blobs persist forever by default; the `put()` / `upload()` options include `cacheControlMaxAge` but no `expiresAt` or similar. `cacheControlMaxAge` controls CDN caching, not object lifetime. The sanctioned pattern is a Vercel Cron job that lists and deletes old blobs.

**Config** (`vercel.json`):
```json
{
  "crons": [
    { "path": "/api/cleanup-blobs", "schedule": "0 3 * * *" }
  ],
  "functions": {
    "api/cleanup-blobs.ts": { "maxDuration": 300 },
    "api/run-qa.ts":        { "maxDuration": 300 }
  }
}
```
- Hobby tier allows **daily** crons only (sub-daily schedules fail deploy). Pro allows any frequency. Daily is fine for us.
- Cron endpoint is secured by a `CRON_SECRET` env var (Vercel auto-injects `Authorization: Bearer <CRON_SECRET>` on scheduled invocations).

**Function** (`api/cleanup-blobs.ts`):
```ts
import { list, del } from '@vercel/blob';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
  let cursor: string | undefined;
  const toDelete: string[] = [];

  do {
    const page = await list({ prefix: 'jobs/', cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (new Date(blob.uploadedAt).getTime() < cutoff) {
        toDelete.push(blob.url);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  // del() accepts arrays; batch at 100 to stay within request limits.
  for (let i = 0; i < toDelete.length; i += 100) {
    await del(toDelete.slice(i, i + 100));
  }

  return Response.json({ deleted: toDelete.length });
}
```

**Scoping rules:**
- `list({ prefix: 'jobs/' })` — only scans job blobs. `prompts/` is never listed, never deleted. Safety by design.
- Date comparison on `blob.uploadedAt` (a `Date` returned by the SDK).
- Pagination via `cursor` + `hasMore` to handle >1000 blobs per store.
- `del()` accepts a string or an array and never throws on missing blobs (safe to retry).

**Known minor gotchas:**
- Hobby-tier cron jobs fire "any time within the scheduled hour" — 3am is a good choice so it reliably runs overnight.
- After `del()`, the CDN can serve a cached copy for up to 1 minute. Not a concern for expired job blobs.
- If we want cheaper scanning later, embed date in the pathname (`jobs/2026-04/jobId/...`) and only list the prefixes older than 30 days. Not necessary at MVP volume.

**Add env var**: `CRON_SECRET` — any long random string.

**Never expire `prompts/`** — that's the source of truth for the team prompt and its full history. The `prefix: 'jobs/'` filter enforces this.

## Known Limits

| Limit | Mitigation |
|---|---|
| **>~100 images per run** — Anthropic rate-limit territory. | Chunk runs, or upgrade to a real queue (Inngest/SQS). |
| **Images >5 MB** — Anthropic image-size cap. | Client-side resize with `browser-image-compression` before upload. |
| **User closes tab mid-run** — stream dies. | Acceptable for MVP. If needed, switch to "kick off + poll results.json" pattern. |
| **Truly sensitive images** — blob URLs are public (unguessable but unauthenticated). | Tier 3 adds private blobs + auth proxy. |

## Development Methodology — TDD

**Every feature is built test-first.** No exceptions. Each MVP step follows this inner loop:

1. **Write comprehensive unit tests for the feature.** Cover the happy path, every error branch, every edge case. Assert the exact shape of inputs and outputs.
2. **Run the tests. Watch them fail.** If a test passes before the code exists, the test is wrong — fix it until it fails for the right reason.
3. **Write the minimum code to make the tests pass.** Don't add anything the tests don't demand.
4. **Refactor** once green. Tests stay green.
5. **Commit** only when the full suite is green.

### Testing rules

- **No network calls. Ever.** All tests are pure units. Mock every boundary: `@vercel/blob` / `@vercel/blob/client`, `@anthropic-ai/sdk`, `fetch`, `File`/`FileSystemEntry` traversal, `crypto.randomUUID`.
- **No shared state between tests.** Each test sets up its own mocks; `beforeEach` resets them.
- **No integration tests in this tier.** End-to-end validation is manual ("upload a real batch, eyeball results") until we outgrow it. Keeps the feedback loop tight.
- **Tests live next to the code** — `upload.ts` ↔ `upload.test.ts`, `run-qa.ts` ↔ `run-qa.test.ts`.

### Tooling

- **Vitest** (fits Vite, near-zero config) — `npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom`.
- **`vi.mock`** for module-level mocks. Prefer over MSW because we never want real network, and `vi.mock` keeps tests faster and more explicit.
- **`vi.fn()`** for spies. Assert call counts, argument shape, call order when it matters.
- **`package.json`** adds `"test": "vitest run"`, `"test:watch": "vitest"`.

### What to mock at each boundary

| Boundary | Mock strategy |
|---|---|
| `@vercel/blob/client` `upload()` | `vi.mock` → returns `{ url: 'https://blob.vercel-storage.com/fake-…' }`. Assert it was called with the expected path and access level. |
| `@vercel/blob` `put` / `list` / `head` / `del` | `vi.mock` → in-memory object acting as a fake blob store (map keyed by pathname). Lets PUT/GET round-trip within a test. |
| `@anthropic-ai/sdk` `Anthropic` | `vi.mock` → constructor returns `{ messages: { create: vi.fn() } }`. Return canned JSON responses per test. Assert prompt shape, cache_control placement, image block type, concurrency. |
| `fetch` (for CSV downloads) | `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('customer,size,...\n')))`. Verify URL, return canned CSV body. |
| `crypto.randomUUID` | `vi.spyOn(crypto, 'randomUUID').mockReturnValue('fixed-id')` when determinism matters. |
| `FileSystemEntry` (folder drag) | Hand-build fake entries: `{ isFile, isDirectory, file(cb), createReader() → { readEntries(cb) } }`. Cover nested directories, empty directories, non-image files. |
| NDJSON stream reader | Feed a mock `ReadableStream` chunked at arbitrary byte boundaries — especially mid-line — to prove the parser handles partial lines. |

### Comprehensive test inventory (write these first)

Grouped by module. Each bullet is one test case.

**`src/lib/isImageFile.test.ts`** (pure predicate)
- Returns true for `image/jpeg` MIME.
- Returns true for `.JPG`, `.png`, `.heic`, `.svg`, `.webp` by extension even with empty MIME.
- Returns false for `.pdf`, `.txt`, `.csv`.
- Returns false for `null`/`undefined` input.

**`src/lib/folderTraversal.test.ts`** (recursive entry walker)
- Flat directory with 3 images → returns 3 files with relative paths prefixed by folder name.
- Nested directories (2 levels) → returns all images, correct relative paths.
- Mixed files → non-images preserved with their metadata (filtering happens downstream).
- Empty directory → returns `[]`.
- `readEntries` called in batches until it returns empty array (DataTransfer pagination contract).
- Rejects propagate: if `entry.file(_, errCb)` errors, traversal rejects.

**`src/lib/upload.test.ts`** (`@vercel/blob/client` wrapper)
- Calls `upload()` once per file with pathname `jobs/{jobId}/images/{uuid}-{sanitizedName}`.
- Sanitizes filename: strips `../`, replaces whitespace with `-`.
- Runs with concurrency cap (spy: at most 6 in-flight at once given 20 input files).
- Returns array of `{ name, url, size }` in the same order as inputs.
- If `upload()` rejects for one file, other uploads still complete; the error is surfaced as `{ name, error }`.
- `handleUploadUrl` is `'/api/upload-token'`.
- Access level is `'public'`.

**`src/lib/runQa.test.ts`** (client fetch + NDJSON reader)
- POSTs to `/api/run-qa` with `{ jobId, prompt, imageUrls, csvUrls }`.
- Reads response body as NDJSON; emits one callback per line.
- Handles chunks split mid-line (parser buffers until `\n`).
- Ignores empty lines.
- Surfaces malformed JSON lines as `onError` without aborting the stream.
- Aborts cleanly when caller signals abort: fetch aborted, no further callbacks.

**`src/lib/reconcile.test.ts`** (name-matching helper — also used server-side)
- Normalizes case: `'Sarah Johnson'` matches `'sarah johnson'`.
- Normalizes whitespace: `'Sarah  Johnson '` matches `'Sarah Johnson'`.
- Tolerates `'&'` vs `' and '`: `'Sarah & Tom'` matches `'Sarah and Tom'`.
- Exact-name mismatch → unmatched, emits missing-design finding.
- One-letter difference is NOT fuzzy-matched → returns unmatched (we want to flag section 4.17 cases, not hide them).
- Empty `extractedLabel.customerName` → row skipped (can't match), emits `{ issue: 'label unreadable' }`.
- Duplicate customer names → each CSV row matches at most once.

**`api/prompt.test.ts`**
- `GET` when no blob exists → returns bundled SOP default content + etag `"default"`.
- `GET` when blob exists → returns `{ content, updatedAt, etag }`; etag is stable across calls.
- `PUT` with new content → writes `prompts/current.md`, archives to `prompts/history/{iso}-{hash}.md`.
- `PUT` with stale `ifMatch` → returns 409, no writes.
- `PUT` with matching `ifMatch` → writes, returns new etag.
- `PUT` with empty content → returns 400; no writes.

**`api/upload-token.test.ts`**
- Returns a token scoped to `jobs/{jobId}/**`.
- Rejects requests without `jobId`.
- Rejects pathnames that escape the jobId prefix.
- Max file size enforced (e.g. 20 MB per file).
- Allowed content types: images + `text/csv`.

**`api/run-qa.test.ts`** (the big one — covers two-pass, caching, streaming, reconciliation)

Shared prefix construction:
- Builds system message from provided `prompt` string.
- Includes full raw CSV text verbatim (every column, every row).
- Concatenates multiple CSVs with a header divider.
- Marks the prefix block with `cache_control: { type: 'ephemeral' }`.
- Downloads CSV exactly once (mock `fetch`, assert call count = CSV count).

Pass A (per-image):
- One `messages.create` call per image URL.
- Each call includes the cached prefix + `{ type: 'image', source: { type: 'url', url } }` + instruction text for sections 4.1–4.16.
- Concurrency respects `p-limit(10)` — given 25 images, max 10 in-flight at any instant.
- Returns `{ findings, extractedLabel }` per image, parsed from model JSON output.
- If one image call throws → other images complete; failing image surfaces as `{ kind: 'image', imageUrl, error }`.
- If model returns malformed JSON → emits `{ error: 'parse_failed', raw }` for that image.

Pass B (batch overview):
- Exactly one `messages.create` call with no image blocks.
- Instruction references sections 4.17, 4.21, and status check.
- Receives imageCount as part of the instruction.
- Runs in parallel with Pass A (both are awaited via `Promise.all`).

Reconciliation:
- Uses `reconcile()` helper on `extractedLabel.customerName` vs. CSV rows.
- Emits one `{ kind: 'missing', customerName, rowIndex }` per unmatched row.
- Skips rows where both CSV name and extracted name are blank.

Streaming:
- Emits NDJSON lines as Pass A results arrive (not batched at end).
- Final line is the batch-overview result.
- `statusCheck` is first line, before any per-image results.
- Stream closes cleanly on success and on error.

Persistence:
- After all streams close, calls `put('jobs/{jobId}/results.json', …, { access: 'public' })`.
- Snapshot includes the prompt used at run time.
- Also writes `jobs/{jobId}/manifest.json`.
- If persistence fails → error surfaced, but in-flight results already streamed to client.

**`src/components/PromptEditor.test.tsx`** (React component via Testing Library)
- On mount, calls `GET /api/prompt` (mocked), populates editor.
- On Save, calls `PUT /api/prompt` with current content + etag.
- Shows "saved" indicator after successful PUT.
- On 409, shows conflict warning and does not overwrite local draft.
- Falls back to bundled SOP default if GET fails.

**`src/components/ResultsView.test.tsx`**
- Renders three sections: per-image / batch / missing.
- Per-image rows show thumbnail + findings list.
- Empty findings array for an image → renders "No issues found ✓".
- Severity badge renders correct color per severity.

### TDD flow per build step

Every MVP step below follows the same pattern:

1. **Write all tests for the step.** Reference the inventory above.
2. **Run `npm test`.** All new tests fail.
3. **Implement.** Get tests to green.
4. **Refactor.** Tests stay green.
5. **Manual smoke check** once per step (e.g. upload a real batch to staging).
6. **Commit.**

Do not move to the next step until the current step's test suite is fully green and committed.

## MVP Build Order

Each step is independently testable and follows the TDD flow above.

0. **Scaffolding** — install Vitest + Testing Library + jsdom. Wire `npm test` / `npm run test:watch`. Add one dummy passing test to confirm the runner works.
1. **Uploads end-to-end**
   - *Tests first*: `isImageFile.test.ts`, `folderTraversal.test.ts`, `upload.test.ts`, `api/upload-token.test.ts`. Run → all fail for the right reasons.
   - *Code*: implement helpers, `/api/upload-token`, swap client uploader to `@vercel/blob/client`.
   - *Smoke*: upload a real batch, confirm files appear in the Vercel Blob browser.
2. **Prompt persistence**
   - *Tests first*: `api/prompt.test.ts`, `PromptEditor.test.tsx`. Run → fail.
   - *Code*: implement `GET/PUT /api/prompt`, wire editor load/save. Remove localStorage usage.
   - *Smoke*: edit, save, hard-reload, confirm persistence.
3. **Single per-image call, synchronous**
   - *Tests first*: `run-qa.test.ts` cases for shared-prefix construction, CSV fetch, single `messages.create` with cache_control + image URL block, JSON parse.
   - *Code*: implement `/api/run-qa` for one image with a mocked Anthropic client.
   - *Smoke*: one image + one CSV through the real API.
4. **Pass A parallel fan-out**
   - *Tests first*: concurrency cap, order-agnostic results, per-image failure isolation, malformed-JSON branch.
   - *Code*: `p-limit(10)` fan-out.
5. **Pass B batch-overview call**
   - *Tests first*: single no-image call, instruction text references sections 4.17/4.21/status, runs in parallel with Pass A.
   - *Code*: add Pass B; `await Promise.all([passA, passB])`.
6. **Reconciliation**
   - *Tests first*: `reconcile.test.ts` covers every normalization rule + set-difference + blank-name cases. `run-qa.test.ts` asserts `missingDesigns` in the merged output.
   - *Code*: pure `reconcile()` helper + wire into run-qa.
7. **Convert to NDJSON streaming**
   - *Tests first*: streaming cases in `run-qa.test.ts` (statusCheck first, per-image as they arrive, batch last, clean close on error). Client-side `runQa.test.ts` chunk-splitting + malformed-line cases.
   - *Code*: swap JSON return for `ReadableStream`; client uses `response.body.getReader()`.
8. **Persist `results.json` (with prompt snapshot) + `/run/:jobId` share page**
   - *Tests first*: persistence assertion in `run-qa.test.ts`; `Run.test.tsx` fetches `results.json` and renders same results UI.
   - *Code*: `put()` call at end of run-qa; add route + page.
9. **Vercel Cron cleanup** (`api/cleanup-blobs.ts`, 30-day expiration)
   - *Tests first* (`api/cleanup-blobs.test.ts`):
     - Rejects requests missing `Authorization: Bearer ${CRON_SECRET}` → 401, no `del()` calls.
     - Accepts valid bearer → proceeds.
     - `list()` is always called with `prefix: 'jobs/'` — never an empty prefix, never `prompts/`.
     - Paginates: given a mocked `list()` that returns `hasMore: true` twice then false, it calls `list()` three times with the correct `cursor` threaded through.
     - Only blobs with `uploadedAt` older than 30 days go onto the delete list; fresher blobs are ignored.
     - Boundary: a blob uploaded exactly 30 days ago is **not** deleted (use strict `<`).
     - `del()` is called in batches of ≤100 URLs; for 250 stale blobs, expect 3 calls with sizes 100, 100, 50.
     - Empty delete list → zero `del()` calls; returns `{ deleted: 0 }`.
     - Returns JSON `{ deleted: n }` on success.
     - If one `del()` batch throws, the error propagates (cron retries next day); earlier batches already ran.
     - Sanity test: seeded mock with a `prompts/current.md` blob → never appears in the delete list (because `list()` was scoped to `jobs/`).
   - *Code*: implement the handler per the snippet in the Cleanup section.
   - *Smoke*: deploy, manually trigger the cron from the Vercel dashboard, verify old `jobs/` blobs disappear and `prompts/` blobs remain.

Estimated total: ~400 lines of new code across two serverless functions and a handful of client files.

---

# Future Tiers (noted for later, not building now)

Tier 1 gives every run a shareable URL. That solves 80% of "show my coworker this batch." Come back to these when the team actually asks for more.

## Tier 2 — Team history view

Trigger: someone asks "where are my old runs?"

**What changes:**
- Add **Vercel KV** (one click from the Vercel dashboard, ~5 lines to use).
- At the end of `/api/run-qa`:
  ```ts
  await kv.lpush('runs', JSON.stringify({
    jobId, promptSnippet, createdAt, imageCount
  }));
  ```
- New `/history` page: `kv.lrange('runs', 0, 50)` → render list linking to each `/run/:jobId`.
- Blob stays the system of record for actual result contents; KV is just an index.

No schema, no migrations. Real results still live in Blob.

**Estimated effort:** ~1 hour.

## Tier 3 — Per-user accounts & private workspaces

Trigger: privacy need ("I don't want other teams seeing my designs") or per-user attribution.

**What changes:**
- **Auth**: drop-in Clerk or Vercel Auth. Free tier covers small teams.
- **KV keys scoped by user**: `runs:{userId}` lists, plus `run:{jobId}` → `{ ownerId, sharedWith: [...] }`.
- **Private blobs**: switch from `access: 'public'` to private. Image reads go through a Vercel fn that checks auth and returns a short-TTL signed URL (redirect or proxy).
- Anthropic still gets a URL, but it's a signed, short-lived one minted per-run rather than a persistent public URL.

**Trade-off:** more moving parts, real egress cost (Vercel fn proxies the image to Anthropic if we don't use signed redirects carefully), but full privacy and per-user history.

**Estimated effort:** ~1 day, most of it auth plumbing and the private-blob access layer.

---

## Decision log

- **S3 vs. Vercel Blob** — chose Blob to avoid AWS setup. Same architecture; fewer vendors.
- **Base64 inline vs. URL images** — URL. Avoids 4.5 MB Vercel body limit and keeps function memory/time minimal.
- **Polling vs. streaming vs. webhook** — NDJSON stream. Simplest progressive UX, no DB, single function call.
- **DB vs. Blob-as-record** — Blob. One `results.json` per run = zero persistence infrastructure, and it's the same file the share page loads.
- **Tier 1 sharing included in MVP** — the marginal cost is one `put()` call and a new route; the value is everyone can share runs immediately.
- **Prompt stored in Blob, not KV / DB / localStorage** — it's a document, not a record. Blob is the natural home, and we already have it. Includes history via timestamped copies with no extra infra.
