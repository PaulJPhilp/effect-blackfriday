# 1. Product Requirements Document (PRD) — Fuzzy Caching for Effect Services

## 1.1 Problem Statement

Many Effect-based services are:

- Expensive to compute (LLM calls, embeddings, web summaries).
- Deterministic with respect to their inputs.
- “Fuzzy reusable”: you can often re-use a previous result when inputs are *similar enough* (prompt paraphrases, URL variants, higher reasoning levels).

Today, we only have **exact** memoization primitives (e.g. `Effect.cachedFunction`, `cachedWithTTL`), which treat inputs as equal or not equal. 

We need a composition-friendly way to add **fuzzy, param-aware caching** to arbitrary `Effect` functions.

## 1.2 Goal

Provide a small library feature that lets developers wrap an `Effect`-returning function with:

- **Per-field fuzzy matching rules** (cosine similarity, URL normalization, “more is better”).
- **Process-local caching** with TTL.
- **Optional hit metadata** (exact/fuzzy/miss, score) so callers can decide whether to trust a fuzzy hit.

The API must:

- Respect Effect 3 conventions (services, no Tags) and dependency injection.   
- Integrate cleanly into existing projects without forcing storage or embedding engine choices.

## 1.3 Non-Goals

- No multi-process / distributed cache.
- No cache invalidation API other than TTL.
- No persistence beyond process lifetime.
- No UI or HTTP API; this is a library module.
- No support for mixing or “blending” results; only **reuse a single past `Exit`**.

## 1.4 Target Users

- Effect-based service authors who call external APIs or LLMs.
- Internal libraries like:
  - `summarizeWebsite(params) => Effect<string>`
  - `predictUserInterests(params) => Effect<string>`

## 1.5 Functional Requirements

1. **Decorator API**
   - Provide `FuzzyCache.withCaching` and `FuzzyCache.withCachingMeta`.
   - Input: `(fn, config)` where `fn: (params) => Effect<A, E, R>` and `config` has:
     - `cacheName: string`
     - `fuzzyParams?: FuzzyParamsSpec<Params>`
     - `ttlMillis?: number` (default 24h).

2. **Fuzzy Param Matching**
   - For each param field, allow:
     - `CosineSimilarity` (string only).
     - `ExactURL` (string only).
     - `MoreIsBetter` (numeric / enum-like only).
   - Unspecified fields must match **exactly** (value-equality).

3. **Cosine Similarity**
   - Compare string fields by embeddings similarity:
     - Use an `Embeddings` service (Effect.Service) to compute embeddings.
     - Respect per-field `threshold` and `model`.
   - Embeddings must be **memoized** per `(text, model)`.

4. **ExactURL**
   - Normalize URLs and compare for equality.
   - Support at least: `excludeHash: boolean` to ignore URL fragment identifiers.

5. **MoreIsBetter**
   - For numeric / enum-like fields (e.g. `ReasoningLevel`):
     - A cached value satisfies a request if `cached >= requested`.
     - Higher values can substitute for lower; lower cannot substitute for higher.
     - **v1 supports numeric-only fields** (not string enums; use numeric enums or custom wrapper fields).

6. **TTL**
   - Default TTL is 24 hours.
   - Entries older than TTL are ignored.
   - **Configuration constraint:** `ttlMillis` must be positive if specified; `ttlMillis <= 0` is invalid and causes configuration-time failure.

7. **Result Caching**
   - Cache both **successes** and **failures**, as `Exit<E, A>`.
   - Reuse cached failures for similar requests, preventing pointless recomputation.
   - Cached failures are reused identically: same error type and value.

8. **Hit Metadata (optional)**
   - `withCachingMeta` must return `{ value, cache }` where:
     - `cache.kind ∈ { "miss", "exact", "fuzzy" }`
     - `cache.score: number` (cumulative match strength; only meaningful for ranking, not as an absolute quality metric).
       - For exact and MoreIsBetter matches: `+1` per field.
       - For CosineSimilarity matches: `+ similarity_score` where similarity ∈ [0, 1].
       - For a cache miss: `score = 0`.
   - `withCaching` returns just `A`, hiding metadata.

## 1.6 Non-Functional Requirements

- **Performance**
  - Fuzzy lookup must be "good enough" for typical cache sizes (hundreds–low thousands).
  - Embeddings calls must be memoized to avoid repeated external calls.

- **Testability**
  - All time logic via `DateTime`/Clock, not `Date.now`.   
  - Services built with `Effect.Service` so they can be overridden in tests (e.g. fake `Embeddings` and `FuzzyCacheStore`).

- **Reliability**
  - Failures in embeddings or cache operations should degrade gracefully:
    - **Embedding failures during lookup:** If an embedding call fails while scoring a candidate entry, that entry is skipped and we continue evaluating other candidates. If all candidates fail to score, we treat it as a cache miss and run `fn`.
    - **Store errors:** Failures in storing cache entries (e.g., due to process resource constraints) propagate as errors; we do not silently ignore storage failures.
    - **Overall:** Cache lookups are "best-effort" and never crash the wrapped function; at worst, we fall back to running `fn` as if it were a cache miss.

## 1.7 Success Criteria

- `summarizeWebsite` and `predictUserInterests` can be wrapped with `FuzzyCache.withCaching` using only a small config object.
- Approximate re-use:
  - Paraphrased prompts hit the same cached summary with cosine similarity ≥ threshold.
  - Same page URLs with different fragments (`#section1` vs `#section2`) are treated as equal when `excludeHash: true`.
  - Requests with `reasoningLevel: low` reuse results computed with `reasoningLevel: high`.
- Unit and integration tests cover all matching modes and TTL behaviour.