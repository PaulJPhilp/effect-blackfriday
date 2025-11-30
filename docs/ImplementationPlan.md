# Implementation Plan — FuzzyCache Library

This plan assumes:

- TypeScript + Effect 3.
- `Effect.Service` (no Tags).
- No `_` parameter in `Effect.gen`.

We’re implementing:

- `EmbeddingsService`
- `FuzzyCacheStoreService`
- `FuzzyCacheService`
- Fuzzy matching helpers
- Example wiring for:
  - `summarizeWebsite`
  - `predictUserInterests`

---

## 1. Files / Modules

Suggested structure (you can collapse later if you want fewer files):

- `fuzzy-cache/types.ts` — shared types and config.
- `fuzzy-cache/embeddings.ts` — embeddings service.
- `fuzzy-cache/store.ts` — cache store service.
- `fuzzy-cache/match.ts` — matching & scoring logic.
- `fuzzy-cache/service.ts` — `FuzzyCacheService` (public API).
- `fuzzy-cache/examples.ts` — your two concrete cached functions.

---

## 2. Step 1 — Core Types & Config (`types.ts`)

**Goal:** Define the type surface and enforce correct fuzzy config at compile time.

### 2.1 Fuzzy Specs

```ts
export type CosineSimilaritySpec = {
  readonly type: "CosineSimilarity"
  readonly threshold: number
  readonly model: string
}

export type ExactURLSpec = {
  readonly type: "ExactURL"
  readonly excludeHash?: boolean
}

export type MoreIsBetterSpec = {
  readonly type: "MoreIsBetter"
}

2.2 Field-Level Constraints

type NumericLike = number

export type FuzzyFieldSpecFor<Params, K extends keyof Params> =
  Params[K] extends string
    ? CosineSimilaritySpec | ExactURLSpec
    : Params[K] extends NumericLike
      ? MoreIsBetterSpec
      : never

export type FuzzyParamsSpec<Params> = {
  readonly [K in keyof Params]?: FuzzyFieldSpecFor<Params, K>
}

2.3 Cache Types & Config

import { Exit } from "effect"

export type CacheOutcome<E, A> = Exit.Exit<E, A>

export type CacheEntry<Params, E, A> = {
  readonly params: Params
  readonly outcome: CacheOutcome<E, A>
  readonly createdAt: number // epoch millis
}

export type CacheHitKind = "miss" | "exact" | "fuzzy"

export type CacheHitMeta = {
  readonly kind: CacheHitKind
  readonly score: number // cumulative match strength; always present
}

export type WithCachingConfig<Params> = {
  readonly cacheName: string
  readonly fuzzyParams?: FuzzyParamsSpec<Params>
  readonly ttlMillis?: number // default 24h; must be positive if specified
}

export const DEFAULT_TTL_MILLIS = 24 * 60 * 60 * 1000

Done when: invalid fuzzy configs (e.g. MoreIsBetter on a string field) fail at compile time.

⸻

3. Step 2 — EmbeddingsService with Memoization (embeddings.ts)

Goal: Implement (text, model) → Effect<readonly number[]> with process-local memoization.

3.1 Service Definition

import { Data, Effect, HashMap, Ref } from "effect"

type EmbeddingKey = {
  readonly text: string
  readonly model: string
}

export type Embeddings = {
  readonly embed: (input: string, model: string) =>
    Effect.Effect<readonly number[]>
}

// Low-level provider to plug real backend into later
const rawEmbed = (
  input: string,
  model: string
): Effect.Effect<readonly number[]> =>
  Effect.dieMessage("rawEmbed not implemented")

export class EmbeddingsService
  extends Effect.Service<Embeddings>()("Embeddings", {
  effect: Effect.gen(function* () {
    const cacheRef = yield* Ref.make(
      HashMap.empty<EmbeddingKey, readonly number[]>()
    )

    const embed = (input: string, model: string) =>
      Effect.gen(function* () {
        const key = Data.struct<EmbeddingKey>({ text: input, model })

        const cache0 = yield* Ref.get(cacheRef)
        const cached = HashMap.get(cache0, key)
        if (cached._tag === "Some") {
          return cached.value
        }

        const vector = yield* rawEmbed(input, model)

        const cache1 = HashMap.set(cache0, key, vector)
        yield* Ref.set(cacheRef, cache1)

        return vector
      })

    return { embed } as const
  }),
  accessors: true
}) {}

Done when: you can inject a fake rawEmbed in tests and verify it’s called once for repeated (text, model) pairs.

⸻

4. Step 3 — FuzzyCacheStoreService (store.ts)

Goal: Process-local store of cache entries keyed by cacheName.

import { Effect, Ref } from "effect"
import { CacheEntry } from "./types"

export type FuzzyCacheStore = {
  readonly getAll: <P, E, A>(
    cacheName: string
  ) => Effect.Effect<Iterable<CacheEntry<P, E, A>>>

  readonly put: <P, E, A>(
    cacheName: string,
    entry: CacheEntry<P, E, A>
  ) => Effect.Effect<void>
}

export class FuzzyCacheStoreService
  extends Effect.Service<FuzzyCacheStore>()("FuzzyCacheStore", {
  effect: Effect.gen(function* () {
    const mapRef = yield* Ref.make(
      new Map<string, Array<CacheEntry<any, any, any>>>()
    )

    const getAll = <P, E, A>(
      cacheName: string
    ): Effect.Effect<Iterable<CacheEntry<P, E, A>>> =>
      mapRef.pipe(
        Ref.get,
        Effect.map((map) => (map.get(cacheName) ?? []) as CacheEntry<P, E, A>[])
      )

    const put = <P, E, A>(
      cacheName: string,
      entry: CacheEntry<P, E, A>
    ): Effect.Effect<void> =>
      mapRef.pipe(
        Ref.update((map) => {
          const existing = map.get(cacheName) ?? []
          map.set(cacheName, [...existing, entry])
          return map
        }),
        Effect.asVoid
      )

    return { getAll, put } as const
  }),
  accessors: true
}) {}

Done when: inserting and then retrieving entries by cacheName behaves as expected.

⸻

5. Step 4 — Matching & Scoring (match.ts)

Goal: TTL filtering + fuzzy scoring + best-hit selection.

5.1 Helpers

import { Equal, Effect } from "effect"
import {
  CacheEntry,
  CacheHitMeta,
  ExactURLSpec,
  FuzzyParamsSpec
} from "./types"

const normalizeUrl = (raw: string, spec: ExactURLSpec): string => {
  try {
    const url = new URL(raw)
    if (spec.excludeHash) {
      url.hash = ""
    }
    return url.toString()
  } catch {
    return raw
  }
}

const cosineSimilarity = (
  a: readonly number[],
  b: readonly number[]
): number => {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < len; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    magA += ai * ai
    magB += bi * bi
  }

  if (magA === 0 || magB === 0) return 0

  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

5.2 scoreEntry

type ScoreResult = { ok: boolean; score: number; exact: boolean }

export const scoreEntry = <Params>(
  requested: Params,
  cached: Params,
  fuzzy: FuzzyParamsSpec<Params>,
  embed: (input: string, model: string) => Effect.Effect<readonly number[]>
): Effect.Effect<ScoreResult> =>
  Effect.gen(function* () {
    let score = 0
    let exact = true

    for (const key of Object.keys(requested) as Array<keyof Params>) {
      const spec = fuzzy[key]
      const req = requested[key]
      const prev = cached[key]

      if (!spec) {
        if (!Equal.equals(req as any, prev as any)) {
          return { ok: false, score: 0, exact: false }
        }
        score += 1
        continue
      }

      if (spec.type === "ExactURL") {
        const reqNorm = normalizeUrl(req as string, spec)
        const prevNorm = normalizeUrl(prev as string, spec)
        if (reqNorm !== prevNorm) {
          return { ok: false, score: 0, exact: false }
        }
        score += 1
        continue
      }

      if (spec.type === "MoreIsBetter") {
        const reqNum = req as unknown as number
        const prevNum = prev as unknown as number
        if (prevNum < reqNum) {
          return { ok: false, score: 0, exact: false }
        }
        if (prevNum !== reqNum) {
          exact = false
        }
        score += 1
        continue
      }

      if (spec.type === "CosineSimilarity") {
        const reqText = String(req)
        const prevText = String(prev)

        const embedResult = yield* Effect.all([
          embed(reqText, spec.model).pipe(Effect.catchAll(() => Effect.succeed(null))),
          embed(prevText, spec.model).pipe(Effect.catchAll(() => Effect.succeed(null)))
        ])

        // If either embedding failed, treat as no match
        if (embedResult[0] === null || embedResult[1] === null) {
          return { ok: false, score: 0, exact: false }
        }

        const sim = cosineSimilarity(embedResult[0], embedResult[1])
        if (sim < spec.threshold) {
          return { ok: false, score: 0, exact: false }
        }
        if (sim < 1) {
          exact = false
        }
        score += sim
        continue
      }
    }

    return { ok: true, score, exact }
  })

5.3 matchBestEntry

type MatchArgs<Params, E, A> = {
  readonly now: number
  readonly ttl: number
  readonly params: Params
  readonly entries: Iterable<CacheEntry<Params, E, A>>
  readonly fuzzyParams?: FuzzyParamsSpec<Params>
  readonly embed: (input: string, model: string) =>
    Effect.Effect<readonly number[]>
}

type MatchResult<Params, E, A> = {
  readonly entry: CacheEntry<Params, E, A>
  readonly hitMeta: CacheHitMeta
}

export const matchBestEntry = <Params, E, A>(
  args: MatchArgs<Params, E, A>
): Effect.Effect<MatchResult<Params, E, A> | null> =>
  Effect.gen(function* () {
    const { now, ttl, params, entries, fuzzyParams, embed } = args

    const freshEntries = Array.from(entries).filter(
      (entry) => now - entry.createdAt <= ttl
    )

    if (freshEntries.length === 0) {
      return null
    }

    let best:
      | { entry: CacheEntry<Params, E, A>; score: number; exact: boolean }
      | null = null

    for (const entry of freshEntries) {
      const scored = yield* scoreEntry(
        params,
        entry.params,
        fuzzyParams ?? {},
        embed
      )

      if (!scored.ok) continue

      if (best === null || scored.score > best.score) {
        best = {
          entry,
          score: scored.score,
          exact: scored.exact
        }
      }
    }

    if (best === null) {
      return null
    }

    const hitMeta: CacheHitMeta = {
      kind: best.exact ? "exact" : "fuzzy",
      score: best.score
    }

    return { entry: best.entry, hitMeta }
  })


⸻

6. Step 5 — FuzzyCacheService (service.ts)

Goal: Implement withCaching and withCachingMeta using the store, embeddings, and matching.

import { DateTime, Effect } from "effect"
import {
  CacheEntry,
  CacheHitMeta,
  DEFAULT_TTL_MILLIS,
  WithCachingConfig
} from "./types"
import { EmbeddingsService, Embeddings } from "./embeddings"
import { FuzzyCacheStoreService, FuzzyCacheStore } from "./store"
import { matchBestEntry } from "./match"

const currentEpochMillis: Effect.Effect<number> =
  DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))

export type FuzzyCache = {
  readonly withCaching: <
    Params,
    A,
    E = never,
    R = never
  >(
    fn: (params: Params) => Effect.Effect<A, E, R>,
    config: WithCachingConfig<Params>
  ) => (params: Params) => Effect.Effect<
    A,
    E,
    R | FuzzyCacheStore | Embeddings
  >

  readonly withCachingMeta: <
    Params,
    A,
    E = never,
    R = never
  >(
    fn: (params: Params) => Effect.Effect<A, E, R>,
    config: WithCachingConfig<Params>
  ) => (params: Params) => Effect.Effect<
    { value: A; cache: CacheHitMeta },
    E,
    R | FuzzyCacheStore | Embeddings
  >
}

export class FuzzyCacheService
  extends Effect.Service<FuzzyCache>()("FuzzyCache", {
  effect: Effect.gen(function* () {
    const store = yield* FuzzyCacheStoreService
    const embeddingsService = yield* EmbeddingsService
    const { embed } = embeddingsService

    const withCaching: FuzzyCache["withCaching"] = (fn, config) => {
      // Validate config at wrap time
      if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
        return () => Effect.dieMessage("WithCachingConfig.ttlMillis must be positive")
      }

      return (params) =>
        Effect.gen(function* () {
          const now = yield* currentEpochMillis
          const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

          const entries = yield* store.getAll<any, any, any>(config.cacheName)

          const match = yield* matchBestEntry({
            now,
            ttl,
            params,
            entries,
            fuzzyParams: config.fuzzyParams,
            embed
          })

          if (match) {
            return yield* Effect.fromExit(match.entry.outcome)
          }

          const exit = yield* Effect.exit(fn(params))

          const entry: CacheEntry<any, any, any> = {
            params,
            outcome: exit,
            createdAt: now
          }

          yield* store.put(config.cacheName, entry)

          return yield* Effect.fromExit(exit)
        })
    }

    const withCachingMeta: FuzzyCache["withCachingMeta"] = (fn, config) => {
      // Validate config at wrap time
      if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
        return () => Effect.dieMessage("WithCachingConfig.ttlMillis must be positive")
      }

      return (params) =>
        Effect.gen(function* () {
          const now = yield* currentEpochMillis
          const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

          const entries = yield* store.getAll<any, any, any>(config.cacheName)

          const match = yield* matchBestEntry({
            now,
            ttl,
            params,
            entries,
            fuzzyParams: config.fuzzyParams,
            embed
          })

          if (match) {
            const value = yield* Effect.fromExit(match.entry.outcome)
            return { value, cache: match.hitMeta }
          }

          const exit = yield* Effect.exit(fn(params))

          const entry: CacheEntry<any, any, any> = {
            params,
            outcome: exit,
            createdAt: now
          }

          yield* store.put(config.cacheName, entry)

          const value = yield* Effect.fromExit(exit)
          return {
            value,
            cache: { kind: "miss", score: 0 }
          }
        })
    }

    return { withCaching, withCachingMeta } as const
  }),
  dependencies: [FuzzyCacheStoreService.Default, EmbeddingsService.Default],
  accessors: true
}) {}


⸻

7. Step 6 — Example Wiring (examples.ts)

Goal: Show how summarizeWebsite / predictUserInterests are wrapped.

import { Effect } from "effect"
import { FuzzyCacheService } from "./service"

export enum ReasoningLevel {
  minimal = 0,
  low = 1,
  medium = 2,
  high = 3
}

const summarizeWebsite = (params: {
  url: string
  prompt: string
  reasoningLevel: ReasoningLevel
}): Effect.Effect<string> =>
  Effect.succeed(
    `Summarized content from ${params.url} with prompt "${params.prompt}" at reasoning level ${ReasoningLevel[params.reasoningLevel]}`
  )

const predictUserInterests = (params: {
  userProfileBio: string
  userEmailDomain: string
  listOfPotentialInterests: string[]
  reasoningLevel: ReasoningLevel
}): Effect.Effect<string> =>
  Effect.succeed(`...`)

export const summarizeWebsiteCached =
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

export const predictUserInterestsCached =
  FuzzyCacheService.withCaching(predictUserInterests, {
    cacheName: "predictUserInterestsCache",
    fuzzyParams: {
      userProfileBio: {
        type: "CosineSimilarity",
        threshold: 0.1,
        model: "text-embedding-3-small"
      },
      reasoningLevel: { type: "MoreIsBetter" }
    }
  })


⸻

8. Implementation Order Checklist
 1. Create types.ts and get the types compiling.
 2. Implement EmbeddingsService with memoization; stub rawEmbed.
 3. Implement FuzzyCacheStoreService with Ref<Map>.
 4. Implement match.ts (scoreEntry + matchBestEntry).
 5. Implement FuzzyCacheService (withCaching, withCachingMeta).
 6. Wire up examples.ts with your two functions.
 7. Add tests as per the Testing Plan (next doc).

