# 2. Architecture Document — Fuzzy Caching System

## 2.1 Overview

The fuzzy caching system consists of three primary services:

1. **EmbeddingsService**  
   - Responsibility: memoized `(text, model) → embedding` lookups.

2. **FuzzyCacheStore**  
   - Responsibility: process-local storage of cache entries per `cacheName`.

3. **FuzzyCache**  
   - Responsibility: wrapping any `Effect` function with fuzzy cache semantics.
   - Uses EmbeddingsService + FuzzyCacheStore + DateTime (Clock).   

All services are built with `Effect.Service`, no Tags.

## 2.2 Key Domain Types

```ts
// Result storage
type CacheOutcome<E, A> = Effect.Exit.Exit<E, A>

type CacheEntry<Params, E, A> = {
  readonly params: Params
  readonly outcome: CacheOutcome<E, A>
  readonly createdAt: number // epoch millis
}

// Hit metadata
type CacheHitKind = "miss" | "exact" | "fuzzy"

type CacheHitMeta = {
  readonly kind: CacheHitKind
  readonly score: number // cumulative match strength; 0 for miss
}

// Fuzzy specs
type CosineSimilaritySpec = {
  readonly type: "CosineSimilarity"
  readonly threshold: number
  readonly model: string
}

type ExactURLSpec = {
  readonly type: "ExactURL"
  readonly excludeHash?: boolean
}

type MoreIsBetterSpec = {
  readonly type: "MoreIsBetter"
}

type NumericLike = number

type FuzzyFieldSpecFor<Params, K extends keyof Params> =
  Params[K] extends string
    ? CosineSimilaritySpec | ExactURLSpec
    : Params[K] extends NumericLike
      ? MoreIsBetterSpec
      : never

type FuzzyParamsSpec<Params> = {
  readonly [K in keyof Params]?: FuzzyFieldSpecFor<Params, K>
}

type WithCachingConfig<Params> = {
  readonly cacheName: string
  readonly fuzzyParams?: FuzzyParamsSpec<Params>
  readonly ttlMillis?: number // default 24h; must be positive if specified
}
```

## 2.3 Key Semantic Contracts

### Embedding Failures
- If an embedding call fails during fuzzy matching (e.g., network error, invalid model):
  - The candidate entry is skipped (`ok: false`).
  - Lookup continues with other entries.
  - If all candidates fail to score, `matchBestEntry` returns `null` (treated as a cache miss).
  - The error does not propagate to the caller of `withCaching` / `withCachingMeta`.

### Cosine Similarity
- Vectors are not assumed to be unit-normalized.
- Cosine similarity is computed using the standard formula: `(a·b) / (|a| |b|)`.
- Result range is typically [0, 1] for text embeddings, guaranteed to be [-1, 1].
- If either vector has zero magnitude, similarity is 0.

### Score Semantics
- Score is a **cumulative, relative measure** used to rank candidates, not an absolute quality metric.
- It does not normalize by field count; clients should not interpret it as a percentage.
- Computation:
  - Exact match (ExactURL, exact field, or unspecified fuzzy field): `+1`.
  - MoreIsBetter match: `+1` (if `cached >= requested`).
  - CosineSimilarity match: `+ similarity` (where similarity ∈ [0, 1]).
  - Cache miss: `score = 0`.

### MoreIsBetter Semantics
- A cached value is acceptable if `cached >= requested`.
- This means a high-cost/high-quality result can be reused for a lower-cost request.
- Example: a cached result computed with `reasoningLevel = high` satisfies a new request for `reasoningLevel = low`.
- **v1 constraint:** Only numeric fields; string enums are not supported.

### TTL Validation
- `ttlMillis` must be positive if specified.
- `ttlMillis <= 0` causes a configuration-time failure.
- Invalid TTL is caught when the decorator is applied, not during lookup.

### Store Concurrency
- `FuzzyCacheStore` uses `Ref.update` for atomic updates.
- Concurrent calls to `store.put()` are serialized; no entries are lost.
- **v1 does not deduplicate entries:** the same params may be cached multiple times.
  - This is acceptable because fuzzy matching evaluates all candidates and picks the best by score.
- **Ordering is approximate:** if two fibers put entries concurrently, order is "as observed" but not globally strict.

### Embeddings Memoization
- Embeddings are memoized indefinitely per `(text, model)` within process lifetime.
- **v1 does not cap embedding cache size or implement TTL for embeddings.**
- Concurrent calls to `embed(text, model)` may result in duplicate `rawEmbed` calls if multiple fibers miss the cache simultaneously.
  - This is acceptable for v1; promise-style in-flight deduplication is a future enhancement.
- If an embedding model changes or needs to be cleared mid-process, the process must be restarted or the clear function must be added in a future version.

### URL Normalization (ExactURL)
- URLs are normalized using the platform's `URL` class.
- When `excludeHash: true`, we set `url.hash = ""` and use `url.toString()` as canonical.
- **v1 does not aggressively normalize** beyond URL's built-in behavior (e.g., `https://foo.com/` vs `https://foo.com` may or may not be treated as equal, depending on platform).
- Invalid URL strings are returned as-is.

### Error Propagation
- **Embedding errors during lookup:** Do not propagate; candidate is skipped.
- **Store errors:** Propagate; we do not silently ignore cache storage failures.
- **Overall:** Cache lookups are best-effort; only embedding and store errors are caught differently.
```