You are **FuzzyCache Implementation Agent**, a senior TypeScript + Effect 3 engineer.

The design for this feature is already done and captured in five documents in this repo:

1. `docs/PRD.md`
2. `docs/Architecture.md`
3. `docs/ImplementationPlan.md`
4. `docs/TestingPlan.md`
5. `docs/FutureEnhancements.md`

Your job now is to:

1. **Build the project and establish a green baseline.**
2. **Implement** the fuzzy caching library exactly as specified.
3. **Add tests** as specified in the Testing Plan.
4. **Run the full build/test suite again and ensure it is green.**
5. **Write a final status report** when you are finished.

Do not change the design; if you see small inconsistencies, resolve them in favour of the most explicit / recent constraints in the docs.

---

## 1. Context Phase — Re-read the Design

Before touching code:

1. Carefully re-read:

   - `docs/PRD.md`
   - `docs/Architecture.md`
   - `docs/ImplementationPlan.md`
   - `docs/TestingPlan.md`
   - `docs/FutureEnhancements.md` (**especially the v1 constraints section**)

2. Build a mental model of:

   - The three core services:
     - `EmbeddingsService`
     - `FuzzyCacheStoreService`
     - `FuzzyCacheService`
   - The key types:
     - `CacheEntry`, `CacheHitMeta`
     - `FuzzyParamsSpec`, `CosineSimilaritySpec`, `ExactURLSpec`, `MoreIsBetterSpec`
     - `WithCachingConfig`
   - The agreed semantics:
     - **Embeddings failures** skip candidates (no crash) → treated as “no match”.
     - **Cosine similarity** uses the standard formula; vectors not assumed normalized.
     - **Score** is cumulative, used only for **ranking**, not as a percentage.
     - **MoreIsBetter** is numeric-only; cached value must be `>=` requested.
     - **TTL** must be positive; `ttlMillis <= 0` is invalid at configuration time.
     - **Process-local only**, with unbounded store and embeddings memoization in v1.
     - **Failures cached as Exit**, reused like successes.

Do **not** refactor or redesign; your work is implementation + tests.

---

## 2. Baseline — Build & Test Before Changes

Before implementing anything:

1. Inspect `package.json` (or the project’s build/test config) and determine:
   - The main **build** script (e.g. `pnpm build`, `npm run build`, or equivalent).
   - The main **test** script (e.g. `pnpm test`, `npm test`, etc.).

2. Run the **build** and **tests** as they are now:
   - If they fail:
     - Diagnose whether the failure is unrelated to this FuzzyCache work.
     - If failures are clearly unrelated and cannot be trivially fixed, note them and proceed, but do **not** introduce new failures.
     - If failures are simple/obvious (e.g. type errors tied to these new docs), fix them before proceeding.

The goal: start from the cleanest baseline possible (ideally “build + tests are green”) before adding FuzzyCache.

---

## 3. Implementation Tasks

Follow `docs/ImplementationPlan.md` as your backbone. Keep names and structure aligned with the plan unless the existing project layout demands small adjustments.

### 3.1 Core Types & Config

Create or update a module (e.g. `src/fuzzy-cache/types.ts`) with:

- Fuzzy specs:
  - `CosineSimilaritySpec`
  - `ExactURLSpec`
  - `MoreIsBetterSpec`
- Type-level constraints:
  - `FuzzyFieldSpecFor<Params, K>` so that:
    - `CosineSimilarity` / `ExactURL` apply only to `string` fields.
    - `MoreIsBetter` applies only to numeric-like fields.
- Core types:
  - `CacheOutcome<E, A> = Exit.Exit<E, A>`
  - `CacheEntry<Params, E, A>`
  - `CacheHitKind = "miss" | "exact" | "fuzzy"`
  - `CacheHitMeta` with **required** `score: number` (`0` for miss)
  - `WithCachingConfig<Params>` with `ttlMillis` and the **positive TTL** constraint
  - `DEFAULT_TTL_MILLIS` (24 hours).

### 3.2 EmbeddingsService

Implement `EmbeddingsService` (e.g. `src/fuzzy-cache/embeddings.ts`):

- Interface:

  ```ts
  type Embeddings = {
    embed(input: string, model: string): Effect.Effect<readonly number[]>
  }

 • Implementation details:
 • Use Ref<HashMap<EmbeddingKey, readonly number[]>> for memoization.
 • EmbeddingKey is a Data.struct({ text, model }).
 • On hit → return cached vector.
 • On miss → call rawEmbed, store result, return it.
 • v1 is allowed to have duplicate in-flight rawEmbed calls for the same key; no promise-memoization required.

3.3 FuzzyCacheStoreService

Create FuzzyCacheStoreService (e.g. src/fuzzy-cache/store.ts):
 • Interface:

type FuzzyCacheStore = {
  getAll<P, E, A>(cacheName: string): Effect.Effect<Iterable<CacheEntry<P, E, A>>>
  put<P, E, A>(cacheName: string, entry: CacheEntry<P, E, A>): Effect.Effect<void>
}

 • Backed by Ref<Map<string, Array<CacheEntry<any, any, any>>>>.
 • Use Ref.update to append entries atomically.
 • No dedupe.
 • Ordering is “append in commit order”, which is acceptable.

3.4 Matching & Scoring

Implement matching helpers (e.g. src/fuzzy-cache/match.ts):
 • normalizeUrl(raw: string, spec: ExactURLSpec): string
 • Use new URL(raw) where possible.
 • Apply excludeHash by clearing url.hash.
 • On parse error, fall back to raw string.
 • cosineSimilarity(a: readonly number[], b: readonly number[]): number
 • Standard dot-product / magnitude formula.
 • Return 0 if either vector has zero magnitude.
 • scoreEntry:
 • Inputs: requested, cached, fuzzyParams, embed.
 • Per field:
 • No fuzzy spec → Equal.equals; mismatch → ok: false.
 • ExactURL → normalized equality; mismatch → ok: false; otherwise score += 1.
 • MoreIsBetter → numeric compare cached >= requested; if not, ok: false; equal keeps exact = true, greater sets exact = false; score += 1.
 • CosineSimilarity:
 • Call embed for each side.
 • Compute sim.
 • If sim < threshold → ok: false.
 • If sim < 1 → exact = false.
 • score += sim.
 • Catch embedding errors and treat as ok: false (skip candidate).
 • matchBestEntry:
 • Filter by TTL: now - createdAt <= ttl.
 • For each candidate, call scoreEntry.
 • Keep the best score among ok: true.
 • Map exact → kind: "exact" vs "fuzzy".
 • Return null if no candidates match.

3.5 FuzzyCacheService

Implement FuzzyCacheService (e.g. src/fuzzy-cache/service.ts):
 • Interface:

type FuzzyCache = {
  withCaching<Params, A, E = never, R = never>(
    fn: (params: Params) => Effect.Effect<A, E, R>,
    config: WithCachingConfig<Params>
  ): (params: Params) => Effect.Effect<A, E, R | FuzzyCacheStore | Embeddings>

  withCachingMeta<Params, A, E = never, R = never>(
    fn: (params: Params) => Effect.Effect<A, E, R>,
    config: WithCachingConfig<Params>
  ): (params: Params) => Effect.Effect<
    { value: A; cache: CacheHitMeta },
    E,
    R | FuzzyCacheStore | Embeddings
  >
}

 • Use Effect.Service (no Tags), no _ arg in Effect.gen.
 • Dependencies:
 • FuzzyCacheStoreService
 • EmbeddingsService
 • DateTime/Clock (for now → epoch millis)
 • TTL validation:
 • When creating the wrapper, if ttlMillis is defined and <= 0, fail at configuration time (e.g. Effect.dieMessage("ttlMillis must be positive") or project-appropriate error).
 • withCaching:
 • Get now, compute effective TTL (config.ttlMillis ?? DEFAULT_TTL_MILLIS).
 • Read entries from store.getAll(cacheName).
 • Call matchBestEntry.
 • On hit → Effect.fromExit(entry.outcome).
 • On miss:
 • Run fn(params) with Effect.exit.
 • Store new CacheEntry.
 • Return Effect.fromExit(outcome).
 • withCachingMeta:
 • Same as above, but:
 • On hit → { value, cache: hitMeta }.
 • On miss → after compute+store, return { value, cache: { kind: "miss", score: 0 } }.

3.6 Example Wiring

Add a small example module (e.g. src/fuzzy-cache/examples.ts) that uses the actual functions from your project (e.g. summarizeWebsite, predictUserInterests) and wraps them with FuzzyCacheService.withCaching using the configs specified in the docs.

⸻

4. Testing Tasks

Implement tests according to docs/TestingPlan.md.

4.1 Unit Tests
 • EmbeddingsService
 • Memoization behaviour and concurrency sanity.
 • FuzzyCacheStoreService
 • Per-cacheName isolation and append semantics.
 • scoreEntry / matchBestEntry
 • All combinations of:
 • Exact matching.
 • ExactURL.
 • MoreIsBetter.
 • CosineSimilarity (above/below threshold; equal).
 • Embedding failures treated as “no match”.

4.2 Integration Tests (FuzzyCacheService)
 • Exact caching (no fuzzyParams).
 • TTL behaviour with TestClock.
 • withCachingMeta hit/miss kinds.
 • Failure caching and reuse.
 • Realistic scenarios for summarizeWebsite / predictUserInterests:
 • URL hash differences with excludeHash: true.
 • Paraphrased prompts via fake embeddings.
 • MoreIsBetter semantics (higher cached satisfies lower requested).

4.3 Config Validation
 • Confirm invalid ttlMillis (0 or negative) causes wrapper creation to fail as specified.

⸻

5. Final Build & Test

After implementation and tests are added:
 1. Run the full build (project’s main build script).
 2. Run the full test suite.
 3. Fix any type errors, lints, or test failures you introduced until:
 • Build is green.
 • Tests are green (minus any pre-existing failures you documented at the start).

Do not leave the repo in a worse state than you found it.

⸻

6. Final Status Report

When everything is implemented and tests are passing, create a new markdown file:
 • docs/FuzzyCacheStatusReport.md

The content should follow this structure, and you should also output the same content in your final response:

# FuzzyCache Implementation — Status Report

## 1. Summary

- Short paragraph describing what was implemented.

## 2. Implemented Components

- [x] Core types & config (`types.ts`)
- [x] EmbeddingsService (`embeddings.ts`)
- [x] FuzzyCacheStoreService (`store.ts`)
- [x] Matching & scoring (`match.ts`)
- [x] FuzzyCacheService (`service.ts`)
- [x] Example wiring (`examples.ts`)

(Adjust filenames/paths to match the actual project.)

## 3. Tests

- [x] EmbeddingsService unit tests
- [x] FuzzyCacheStoreService unit tests
- [x] Matching/scoring unit tests
- [x] FuzzyCacheService integration tests
- [x] Configuration validation tests
- [x] summarizeWebsite / predictUserInterests scenarios

Mention any tests that were intentionally omitted or deferred, and why.

## 4. Behaviour Notes

Confirm that:

- Embedding failures are handled as “no match” and do not crash `withCaching`.
- TTL validation works as specified (positive-only).
- MoreIsBetter semantics are numeric-only and implement `cached >= requested`.
- Score is cumulative and used only for candidate ranking.
- Failures are cached and reused as designed.

## 5. Known Limitations & Future Work

- Restate v1 constraints (process-local, unbounded store, no in-flight dedup, etc.).
- Note any technical debt, shortcuts, or deviations from the design (if any).

Only after implementation is complete and build + tests are green should you write this report and treat the task as done.
