# Future Enhancements — FuzzyCache Library

This document captures *intentional* future work that's out of scope for v1 but fits the current architecture (Effect.Services, in-process cache, memoized embeddings) and can be layered on without breaking the core `withCaching` API.

---

## 0. v1 Constraints & Known Limitations

Before reading future enhancements, understand what v1 deliberately does **not** support:

### Embeddings Memoization

- **v1:** Unbounded, process-lifetime memoization per `(text, model)`.
- **Future:** Per-embedding TTL, size caps, or explicit cache clearing.
- **Known issue:** Concurrent calls to `embed(text, model)` may result in duplicate `rawEmbed` calls if both miss the cache simultaneously. This is acceptable for moderate call volumes; v2 can add promise-style in-flight deduplication.

### Store / Cache Growth

- **v1:** Unbounded in-memory storage per `cacheName`; entries are appended indefinitely.
- **Future:** LRU eviction, max-entries-per-cacheName, or pluggable storage backends (Redis, SQLite).
- **Consequence:** Long-running processes must monitor memory or restart periodically in v1.

### MoreIsBetter Field Types

- **v1:** Numeric-only (e.g. `number`, `enum` with numeric values).
- **Future:** Custom comparators to support string enums or other orderable types.
- **Current workaround:** Use numeric fields and keep string labels as exact-match fields.

### String Enum MoreIsBetter

- **v1:** Not supported. String enums like `"low" | "medium" | "high"` cannot use `MoreIsBetter`.
- **Future:** Add custom comparator support.
- **Workaround:** Use numeric enums or numeric wrapper fields.

### URL Normalization

- **v1:** Minimal; relies on platform's `URL` class and `excludeHash` boolean.
- **Future:** Aggressive normalization rules (query param ordering, trailing slash handling, etc.).
- **Consequence:** `https://foo.com/` and `https://foo.com` may not be treated as identical; users can pre-normalize URLs in their code.

### Store Concurrency

- **v1:** Ref-based, atomic updates per put, no global ordering guarantee.
- **Future:** Explicit ordering semantics or distributed coordination if needed.
- **Consequence:** Entry insertion order is "as observed" in a concurrent environment, not globally strict.

### Embedding Failures During Lookup

- **v1:** Embedding errors cause a candidate to be skipped; lookup continues with other candidates.
- **Future:** Configurable failure strategies (retry, fail fast, custom handler).
- **Consequence:** A completely failed embedding service causes a cache miss, not an error propagation to the caller.

---

## 2. Storage & Topology

### 2.1 Swappable Storage Backends

**Current:** In-memory `Ref<Map<string, CacheEntry[]>>`, process-local only.

**Enhancements:**

- Define a more explicit `FuzzyCacheStore` “SPI” and provide additional implementations:
  - LRU-backed in-memory store (cap entries per `cacheName`).
  - Asynchronous backing stores (e.g. Redis, SQLite, KV), while keeping the same `getAll`/`put` interface.
- Add a `Layer` helper factory for wiring alternate stores into `FuzzyCacheService`.

### 2.2 Multi-Process / Multi-Node Awareness

**Ideas:**

- Add a `cacheVersion` or `generationId` to `WithCachingConfig`:
  - Bump this to effectively “invalidate” a cache across restarts or deploys.
- Support optional “distributed mode”:
  - `FuzzyCacheStore` backed by Redis or a shared KV, but **keep** fuzzy logic local to the process.

---

## 3. Matching Semantics

### 3.1 More Fuzzy Types

Extend `FuzzyFieldSpecFor` with additional options (keeping type-safety):

- **Jaccard / token-overlap** for string collections:
  - E.g. tags, keyword lists.
- **Levenshtein / edit distance** for short strings (titles, names).
- **Numeric ranges**:
  - e.g. `WithinDelta{ delta: number }` for timestamps, prices, or counts.

### 3.2 Schema-Aware Fuzziness

Integrate with your data modelling (e.g. `Schema`):

- Derive default `FuzzyParamsSpec` from a `Schema` describing `Params`.
- Attach metadata to fields in schema (e.g. `@fuzzy("cosine", threshold=0.2)`).
- Optionally validate `fuzzyParams` at runtime against the schema.

---

## 4. Policies, TTLs, and Eviction

### 4.1 Per-Entry and Per-Field TTL

**Current:** Single TTL per `WithCachingConfig`.

**Enhancements:**

- Allow per-entry TTL override:
  - E.g. results with `reasoningLevel = high` get a longer TTL.
- Support a TTL policy hook:
  - `computeTtl(params, outcome) => number` to adjust TTL based on input or result.

### 4.2 Eviction Strategies

- Add configurable eviction policies on top of the store:
  - Max entries per `cacheName`.
  - Evict least recently used or lowest-score entries first.
- Expose basic metrics (hit/miss counts) to drive manual tuning.

---

## 5. Developer UX & API Ergonomics

### 5.1 Fluent Config Builder

Instead of hand-crafting raw config objects, offer a fluent API:

```ts
const summarizeWebsiteCached = FuzzyCacheBuilder
  .for<Params>("summarizeWebsiteCache")
  .url("url").exactUrl({ excludeHash: true })
  .string("prompt").cosine({ threshold: 0.1, model: "text-embedding-3-small" })
  .moreIsBetter("reasoningLevel")
  .build(summarizeWebsite)

 • Internally generates WithCachingConfig<Params>.

4.2 Presets for Common Patterns

Provide small helpers for typical LLM-y functions:
 • FuzzyCache.presets.llmWithPromptAndReasoning(fn, cacheName):
 • Preconfigures:
 • prompt → CosineSimilarity.
 • reasoningLevel → MoreIsBetter.

⸻

## 6. Telemetry, Metrics & Debuggability

### 6.1 Hooks / Events

Add optional hooks on cache events:
 • onHit({ cacheName, kind, score, params })
 • onMiss({ cacheName, params })
 • onStore({ cacheName, params })

These can be wired to:
 • Logging (for debugging fuzzy behaviour).
 • Metrics backends (Prometheus, OpenTelemetry, etc.).

### 6.2 Introspection Helpers
 • A debug function:
 • FuzzyCache.inspect(cacheName) → returns current entries (or summaries) for inspection in dev tools.
 • Optional trace mode:
 • When enabled, log per-field similarity scores and which candidate won.

⸻

## 7. Safety, Controls & Guardrails

### 7.1 Score Threshold Controls for Callers

Current: Caller gets { kind, score } from withCachingMeta and must make its own decision.

Enhancements:
 • Helper combinators:
 • withScoreThreshold(fn, config, minScore) that:
 • Uses fuzzy cache.
 • If kind === "fuzzy" and score < minScore, automatically bypasses the cache and recomputes.

### 7.2 Result Validation Hooks

For safety-critical paths:
 • Allow a validation function:
 • validate(params, value) => boolean | Effect<boolean>
 • If validation fails, treat as a miss and recompute (or propagate an error).

⸻

## 8. Testing & Tooling Enhancements

### 8.1 Test Utilities

Provide small helpers for tests:
 • Fake EmbeddingsService layer for deterministic cosine similarity.
 • Helper to build synthetic CacheEntry sets for matchBestEntry tests.

### 8.2 Benchmarks

Add micro-benchmarks for:
 • matchBestEntry with varying numbers of entries (e.g. 10, 100, 1k).
 • Embedding memoization hit ratio under different workloads.

⸻

## 9. Documentation & Examples

### 9.1 Cookbook Recipes

Future docs could include:
 • “How to cache LLM summarization calls”
 • “How to do prompt-level fuzziness safely”
 • “How to tune thresholds and TTLs for your domain”

### 9.2 Visual Diagrams

Add one or two architecture diagrams showing:
 • Call path for withCaching (miss vs exact vs fuzzy hit).
 • How services (EmbeddingsService, FuzzyCacheStoreService, FuzzyCacheService) relate.

⸻

These enhancements are intentionally non-disruptive: the core abstraction (withCaching / withCachingMeta + WithCachingConfig<Params>) remains stable, while you grow capabilities around storage, matching semantics, policies, and developer ergonomics as needed.

