# Testing Plan — FuzzyCache Library

This plan focuses on **unit tests**, **integration tests**, and a bit of **property-style testing** for the fuzzy caching system:

- `EmbeddingsService`
- `FuzzyCacheStoreService`
- `FuzzyCacheService` (`withCaching`, `withCachingMeta`)
- Matching/scoring helpers

Use Effect 3’s testing + TestClock patterns (i.e., `DateTime` driven by the `Clock` service, not `Date.now()`).

---

## 1. Test Strategy Overview

We’ll structure tests at three levels:

1. **Unit tests (pure-ish helpers & services)**  
   - `EmbeddingsService` memoization
   - `FuzzyCacheStoreService` behaviour
   - `scoreEntry` & `matchBestEntry` logic (CosineSimilarity, ExactURL, MoreIsBetter, exact matching)

2. **Integration tests (end-to-end wrapping)**  
   - `FuzzyCacheService.withCaching`
   - `FuzzyCacheService.withCachingMeta`
   - TTL behaviour using `TestClock`

3. **Behavioural/properties** (lightweight, not full QuickCheck)  
   - “More is better” monotonicity
   - CosineSimilarity threshold behaviour

Each test module should stub external dependencies (e.g. `rawEmbed`) and avoid real network calls.

---

## 2. Unit Tests

### 2.1 EmbeddingsService

**Purpose:** Ensure `(text, model)` memoization works and doesn’t break concurrency.

**Setup:**

- Override `rawEmbed` with a fake that:
  - Returns deterministic vectors.
  - Counts how many times it’s been called (e.g. via `Ref<number>` or a simple in-memory counter closed over in the test).

**Tests:**

1. **Same key → single provider call**

   - Call `embed("hello", "m1")` twice.
   - Assert:
     - Both calls return the same vector.
     - `rawEmbed` call count is `1`.

2. **Different model → separate cache entries**

   - Call `embed("hello", "m1")`, then `embed("hello", "m2")`.
   - Assert:
     - Both succeed.
     - `rawEmbed` call count is `2`.

3. **Concurrency**

   - Fire multiple fibers in parallel all calling `embed("same-text", "m1")`.
   - Await all.
   - Assert:
     - All vectors are equal.
     - `rawEmbed` call count is `1` or very small (depending on how strict you want to be about race behaviour; at minimum ensure it's much less than number of fibers).
   - **Note:** v1 allows duplicate in-flight calls; we only assert call count is much less than number of fibers, not exactly 1.

4. **Embedding failures do not crash**

   - Set up a fake `rawEmbed` that fails on certain texts (e.g., `"bad-text"` throws).
   - Call `embed("bad-text", "m1")`.
   - Assert: the error is propagated (not swallowed at embeddings level).
   - This error will be caught at `scoreEntry` when evaluating candidates.

---

### 2.2 FuzzyCacheStoreService

**Purpose:** Verify store semantics (per-cache isolation & append behaviour).

**Tests:**

1. **Single cacheName, multiple entries**

   - Put entries `e1`, `e2` under `"cacheA"`.
   - `getAll("cacheA")` returns `[e1, e2]` in insertion order.

2. **Multiple cacheNames are isolated**

   - Put `e1` under `"cacheA"`, `e2` under `"cacheB"`.
   - `getAll("cacheA")` returns `[e1]`, `getAll("cacheB")` returns `[e2]`.

3. **Empty default**

   - `getAll("unknown")` on a never-used name returns an empty iterable.

---

### 2.3 Matching & Scoring Helpers (`scoreEntry`, `matchBestEntry`)

Use a fake `embed` implementation that lets you control cosine similarity:

- For simplicity: map text strings directly to short vectors, e.g.  
  `"same"` → `[1, 0]`, `"similar"` → `[0.9, 0.1]`, `"different"` → `[0, 1]`.

#### 2.3.1 Non-fuzzy exact matching

**Scenario:**

- `fuzzyParams` is `undefined` or `{}`.
- `requested` and `cached` are objects with primitive fields.

**Tests:**

1. **Exact match passes**

   - `requested = { a: 1, b: "x" }`
   - `cached = { a: 1, b: "x" }`
   - `scoreEntry` → `ok: true`, `exact: true`, `score > 0`.

2. **Mismatched field fails**

   - `requested = { a: 1, b: "x" }`
   - `cached = { a: 2, b: "x" }`
   - `scoreEntry` → `ok: false`.

---

#### 2.3.2 ExactURL

**Setup:**

- `fuzzyParams = { url: { type: "ExactURL", excludeHash: true } }`.

**Tests:**

1. **Hash ignored when excludeHash: true**

   - `requested.url = "https://foo.com/page#section1"`
   - `cached.url = "https://foo.com/page#section2"`
   - `scoreEntry` → `ok: true`, `exact: true`.

2. **Hash considered when excludeHash: false**

   - Same URLs as above but `excludeHash: false`.
   - `scoreEntry` → `ok: false`.

3. **Invalid URLs fall back to raw**

   - `requested.url = "not-a-url"`, `cached.url = "not-a-url"`.
   - `scoreEntry` → `ok: true`.
   - `requested.url = "not-a-url"`, `cached.url = "different"`.
   - `scoreEntry` → `ok: false`.

4. **URL platform normalization (v1 baseline)**

   - `requested.url = "https://foo.com/"`, `cached.url = "https://foo.com"`:
     - Behavior depends on platform's URL normalization (may or may not be equal).
     - v1 does not aggressively normalize beyond `URL.toString()`.
   - `requested.url = "HTTPS://FOO.COM"`, `cached.url = "https://foo.com"`:
     - Platform typically lowercases scheme/domain; treat as equal.

---

#### 2.3.3 MoreIsBetter (e.g. ReasoningLevel)

Assume `ReasoningLevel` enum values map to numbers.

**Tests:**

1. **Higher cached satisfies lower requested**

   - `requested.reasoningLevel = medium`
   - `cached.reasoningLevel = high`
   - `scoreEntry` → `ok: true`, `exact: false`.

2. **Equal is exact**

   - Both `medium`.
   - `scoreEntry` → `ok: true`, `exact: true`.

3. **Lower cached does **not** satisfy higher requested**

   - `requested = high`, `cached = low`.
   - `scoreEntry` → `ok: false`.

---

#### 2.3.4 CosineSimilarity

Use a fake `embed`:

- `"same"` → `[1, 0]`  
- `"similar"` → `[0.9, 0.1]`  
- `"different"` → `[0, 1]`

With `threshold = 0.5`.

**Tests:**

1. **Above threshold passes, below fails**

   - `requested.prompt = "same"`, `cached.prompt = "similar"`:
     - `cosineSimilarity` should be high (close to 1).
     - `scoreEntry` → `ok: true`, `exact: false`.
   - `requested.prompt = "same"`, `cached.prompt = "different"`:
     - `scoreEntry` → `ok: false`.

2. **Identical vectors yield exact=true**

   - Same text both sides.
   - `sim = 1`, `exact` remains true.

#### 2.3.5 Embedding Failures During Scoring

**Setup:**

- Fake `embed` that fails (e.g., throws) for certain inputs.

**Tests:**

1. **Failed embedding causes candidate to be skipped**

   - `requested.prompt = "normal"`, `cached.prompt = "bad-text"` (embed fails for "bad-text").
   - `scoreEntry` → `ok: false` (because embedded failed, we skip the candidate).
   - The error is caught and not propagated.

2. **Successful embeddings coexist with failures**

   - Multiple candidates, one has a failing prompt.
   - `scoreEntry` on the failing candidate → `ok: false`.
   - `scoreEntry` on a normal candidate → `ok: true` (with proper score).
   - This ensures that `matchBestEntry` correctly skips failed candidates.

---

#### 2.3.6 Score Semantics and Accumulation

**Tests:**

1. **Score accumulation for multiple fields**

   - A request with 3 fields, all exact matches: `score = 3`.
   - A request with 1 exact + 1 cosine (sim=0.8): `score = 1 + 0.8 = 1.8`.
   - Assert that scores are cumulative and used correctly to rank candidates.

2. **MoreIsBetter scoring**

   - `requested.level = low`, `cached.level = high` → `ok: true`, `score += 1`.
   - Verifies that MoreIsBetter contributes +1 to score just like exact matches.

---

#### 2.3.7 matchBestEntry with Embedding Failures

**Tests:**

1. **All candidates fail to score**

   - Embed service fails for all entries.
   - `matchBestEntry` → returns `null` (treated as cache miss).
   - Caller falls back to running the original function.

2. **Some candidates score, others fail**

   - Entries `[e1, e2, e3]`, where `e1` fails to score, `e2` scores 2.5, `e3` scores 1.0.
   - `matchBestEntry` → returns `e2` (highest score).
   - `e1` is skipped; `e3` is considered but `e2` wins.

---

#### 2.3.8 matchBestEntry

**Tests:**

1. **No entries**

   - `entries = []` → `matchBestEntry` returns `null`.

2. **All entries expired by TTL**

   - `now = 1000`
   - `entry.createdAt = 0`, `ttl = 10`
   - Filtered out → `null`.

3. **Multiple valid candidates: highest score wins**

   - `entries = [eLowScore, eHighScore]`
   - Make `scoreEntry` return higher `score` for `eHighScore`.
   - `matchBestEntry` returns `eHighScore` and proper `hitMeta`.

4. **Exact vs fuzzy kind**

   - If `scoreEntry` returns `exact = true` for best candidate → `kind: "exact"`.
   - If `exact = false` → `kind: "fuzzy"`.

---

## 3. Integration Tests — FuzzyCacheService

### 3.1 Exact Caching (no fuzzy params)

**Setup:**

- Function:  
  `fn({ x }: { x: number }) => Effect.succeed(x * 2)`
- Use `withCaching(fn, { cacheName: "test" })` (no `fuzzyParams`).

**Tests:**

1. **Same params → single underlying call**

   - Call wrapped function twice with `{ x: 1 }`.
   - Spy or counter around `fn`.
   - Assert `fn` called once.

2. **Different params → separate cache**

   - Calls with `{ x: 1 }` and `{ x: 2 }` both invoke `fn` once.

---

### 3.2 Configuration Validation

**Purpose:** Verify that invalid configurations fail at wrapper time, not at runtime.

**Tests:**

1. **Invalid TTL (zero)**

   - Call `FuzzyCacheService.withCaching(fn, { cacheName: "test", ttlMillis: 0 })`.
   - Assert: the returned wrapped function, when called, dies with "ttlMillis must be positive".

2. **Invalid TTL (negative)**

   - Call `FuzzyCacheService.withCaching(fn, { cacheName: "test", ttlMillis: -100 })`.
   - Assert: dies with "ttlMillis must be positive".

3. **Valid positive TTL**

   - Call with `ttlMillis: 1000`.
   - Assert: no error on wrapper creation; function works normally.

---

### 3.3 TTL Behaviour with TestClock

Use Effect’s `TestClock` patterns: advance logical time, ensure TTL expiry behaves correctly.

**Scenario:**

- TTL set short (e.g. 1 minute) via `ttlMillis`.
- Use `DateTime.now` (through Clock) in tests with `TestClock` control.

**Tests:**

1. **Within TTL**

   - First call populates cache.
   - Advance clock by 30 seconds.
   - Second call with same params hits cache; `fn` not called again.

2. **Beyond TTL**

   - Advance clock beyond TTL (e.g. another 31 seconds).
   - Third call re-runs `fn` and stores a new entry.

---

### 3.4 withCachingMeta Metadata

**Setup:**

- Wrap a simple `fn` with `withCachingMeta`.

**Tests:**

1. **First call (miss)**

   - Expect `cache.kind === "miss"` and `score === 0`.
   - Value is from underlying `fn`.

2. **Second call (exact hit)**

   - Same params.
   - `cache.kind === "exact"`, `score > 0`.

3. **Fuzzy hit**

   - Use CosineSimilarity so first call populates.
   - Second call uses a paraphrased prompt.
   - Expect `cache.kind === "fuzzy"` with `score` between 0 and the “all exact” score.

---

### 3.5 Failure Caching

**Setup:**

```ts
const fn = (params: { id: string }) =>
  params.id === "bad"
    ? Effect.fail("boom" as const)
    : Effect.succeed("ok" as const)

Tests:
 1. Failure cached
 • Call with { id: "bad" } → get failure.
 • Call again with { id: "bad" }.
 • Assert:
 • fn only called once.
 • Second call fails the same way (reused Exit.fail).
 2. Success independent of failure
 • After failure, call with { id: "good" }:
 • Assert success not affected by previous failure.

⸻

3.6 Realistic End-to-End — summarizeWebsite

Setup:

enum ReasoningLevel {
  minimal = 0,
  low = 1,
  medium = 2,
  high = 3
}

const summarizeWebsite = (...) => Effect.succeed("...")

const summarizeWebsiteCached =
  FuzzyCacheService.withCaching(summarizeWebsite, {
    cacheName: "summarizeWebsiteCache",
    fuzzyParams: {
      url: { type: "ExactURL", excludeHash: true },
      prompt: {
        type: "CosineSimilarity",
        threshold: 0.1,
        model: "text-embedding-3-small"
      },
      reasoningLevel: { type: "MoreIsBetter" }
    }
  })

Tests:
     1. Same page, different hash
 • Call with URL ...#section1, then ...#section2, same prompt and reasoning.
 • Assert:
 • Underlying summarizeWebsite only invoked once.
 2. Paraphrased prompt
 • First call with prompt = "Explain X in simple terms".
 • Second call with prompt = "Describe X simply".
 • Use fake embed to ensure cosine similarity above threshold.
 • Assert second call hits cache.
 3. Lower reasoning level reuses higher
 • First call with reasoningLevel = high.
 • Second call with reasoningLevel = medium.
 • Assert second call reuses cached result (via MoreIsBetter).

⸻

4. Behavioural / Property-Style Checks

4.1 MoreIsBetter Monotonicity

For numeric-like fields:
 • If cached >= requested and all other fields are equal (or valid per their fuzzy rules), then a cached entry should never be rejected by the MoreIsBetter logic.

You can encode this as:
 • Generate small enum values (e.g. 0–3).
 • Assert: for any c ≥ r, scoreEntry with cached = c, requested = r doesn’t reject due to MoreIsBetter.

4.2 CosineSimilarity Threshold
 • For a given threshold t, build simple test vectors where:
 • sim(v1, v2) > t → must accept.
 • sim(v1, v3) < t → must reject.

This helps guard against regressions if you tweak cosine logic.

⸻

5. Test Infrastructure Notes
     • No real network calls in unit/integration tests:
     • Always override rawEmbed with an in-memory or deterministic fake.
     • Time control:
     • Use Effect’s Clock / DateTime and TestClock to simulate TTL behaviour instead of Date.now().
     • Isolation:
     • Each test should start with fresh instances of:
     • EmbeddingsService
     • FuzzyCacheStoreService
     • FuzzyCacheService
     • Avoid cross-test contamination (especially because we’re using process-local state like Ref / Map).

⸻

6. Minimal “Done” Criteria

You can call this Test Plan “satisfied” when:
     1. All unit tests:
       • Embeddings memoization.
       • Store behaviour.
       • Matching (ExactURL, CosineSimilarity, MoreIsBetter, exact match).
     2. All integration tests:
       • Basic caching.
       • TTL with TestClock.
       • Metadata via withCachingMeta.
       • Failure caching.
       • Realistic summarizeWebsite scenario.
     3. Property-style checks for:
       • MoreIsBetter monotonicity.
       • CosineSimilarity thresholds.

At that point, you’ll have high confidence that the fuzzy cache behaves correctly and remains robust to changes.

