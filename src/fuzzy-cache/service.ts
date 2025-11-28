import { DateTime, Effect, Exit, Layer } from "effect"
import type { Embeddings } from "./embeddings.js"
import { EmbeddingsService } from "./embeddings.js"
import { matchBestEntry } from "./match.js"
import type { FuzzyCacheStore } from "./store.js"
import { FuzzyCacheStoreService } from "./store.js"
import type {
    CacheEntry,
    CacheHitMeta,
    WithCachingConfig
} from "./types.js"
import { DEFAULT_TTL_MILLIS } from "./types.js"

// ============================================================================
// Helper: Current Epoch Millis
// ============================================================================

/**
 * Get current time as epoch milliseconds using Effect's DateTime.
 */
const currentEpochMillis: Effect.Effect<number> = DateTime.now.pipe(
    Effect.map(DateTime.toEpochMillis)
)

// ============================================================================
// Helper: Exit to Effect
// ============================================================================

/**
 * Convert an Exit to an Effect.
 * If success, returns the value. If failure, fails with the cause.
 */
const exitToEffect = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> =>
    Exit.match(exit, {
        onFailure: (cause) => Effect.failCause(cause),
        onSuccess: (a) => Effect.succeed(a)
    })// ============================================================================
// FuzzyCache Service Interface
// ============================================================================

/**
 * FuzzyCache service interface.
 * Provides withCaching and withCachingMeta for wrapping Effect functions.
 */
export type FuzzyCache = {
    /**
     * Wrap a function with fuzzy caching.
     * Returns the cached value (or computes and caches if miss).
     */
    readonly withCaching: <Params, A, E = never, R = never>(
        fn: (params: Params) => Effect.Effect<A, E, R>,
        config: WithCachingConfig<Params>
    ) => (params: Params) => Effect.Effect<A, E, R | FuzzyCacheStore | Embeddings>

    /**
     * Wrap a function with fuzzy caching, returning metadata.
     * Returns { value, cache } with cache hit information.
     */
    readonly withCachingMeta: <Params, A, E = never, R = never>(
        fn: (params: Params) => Effect.Effect<A, E, R>,
        config: WithCachingConfig<Params>
    ) => (
        params: Params
    ) => Effect.Effect<
        { value: A; cache: CacheHitMeta },
        E,
        R | FuzzyCacheStore | Embeddings
    >
}

// ============================================================================
// FuzzyCacheService Implementation
// ============================================================================

/**
 * FuzzyCacheService as an Effect.Service class.
 *
 * Dependencies:
 * - FuzzyCacheStoreService for storage
 * - EmbeddingsService for cosine similarity
 * - DateTime/Clock for time (via DateTime.now)
 */
export class FuzzyCacheService extends Effect.Service<FuzzyCache>()(
    "FuzzyCache",
    {
        effect: Effect.gen(function* () {
            const store = yield* FuzzyCacheStoreService
            const embeddingsService = yield* EmbeddingsService
            const { embed } = embeddingsService

            const withCaching = <Params, A, E, R>(
                fn: (params: Params) => Effect.Effect<A, E, R>,
                config: WithCachingConfig<Params>
            ): ((params: Params) => Effect.Effect<A, E, R>) => {
                // Validate config at wrap time
                if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
                    return () =>
                        Effect.dieMessage(
                            "WithCachingConfig.ttlMillis must be positive"
                        ) as Effect.Effect<A, E, R>
                }

                return (params: Params) =>
                    Effect.gen(function* () {
                        const now = yield* currentEpochMillis
                        const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

                        const entries = yield* store.getAll<Params, E, A>(config.cacheName)

                        const matchResult = yield* matchBestEntry({
                            now,
                            ttl,
                            params,
                            entries,
                            fuzzyParams: config.fuzzyParams,
                            embed
                        })

                        if (matchResult) {
                            return yield* exitToEffect(matchResult.entry.outcome)
                        }

                        const exit = yield* Effect.exit(fn(params))

                        const entry: CacheEntry<Params, E, A> = {
                            params,
                            outcome: exit,
                            createdAt: now
                        }

                        yield* store.put(config.cacheName, entry)

                        return yield* exitToEffect(exit)
                    }) as Effect.Effect<A, E, R>
            }

            const withCachingMeta = <Params, A, E, R>(
                fn: (params: Params) => Effect.Effect<A, E, R>,
                config: WithCachingConfig<Params>
            ): ((
                params: Params
            ) => Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>) => {
                // Validate config at wrap time
                if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
                    return () =>
                        Effect.dieMessage(
                            "WithCachingConfig.ttlMillis must be positive"
                        ) as Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>
                }

                return (params: Params) =>
                    Effect.gen(function* () {
                        const now = yield* currentEpochMillis
                        const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

                        const entries = yield* store.getAll<Params, E, A>(config.cacheName)

                        const matchResult = yield* matchBestEntry({
                            now,
                            ttl,
                            params,
                            entries,
                            fuzzyParams: config.fuzzyParams,
                            embed
                        })

                        if (matchResult) {
                            const value = yield* exitToEffect(matchResult.entry.outcome)
                            return { value, cache: matchResult.hitMeta }
                        }

                        const exit = yield* Effect.exit(fn(params))

                        const entry: CacheEntry<Params, E, A> = {
                            params,
                            outcome: exit,
                            createdAt: now
                        }

                        yield* store.put(config.cacheName, entry)

                        const value = yield* exitToEffect(exit)
                        return {
                            value,
                            cache: { kind: "miss" as const, score: 0 }
                        }
                    }) as Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>
            }

            return {
                withCaching: withCaching as FuzzyCache["withCaching"],
                withCachingMeta: withCachingMeta as FuzzyCache["withCachingMeta"]
            }
        }),
        dependencies: [FuzzyCacheStoreService.Default, EmbeddingsService.Default],
        accessors: true
    }
) { }

// ============================================================================
// Layer without baked-in dependencies (for testing with custom embeddings)
// ============================================================================

/**
 * A layer for FuzzyCacheService that requires FuzzyCacheStoreService and
 * EmbeddingsService to be provided separately. Use this when you need to
 * provide custom implementations (e.g., for testing).
 */
export const makeFuzzyCacheLayer = Layer.effect(
    FuzzyCacheService,
    Effect.gen(function* () {
        const store = yield* FuzzyCacheStoreService
        const embeddingsService = yield* EmbeddingsService
        const { embed } = embeddingsService

        const withCaching = <Params, A, E, R>(
            fn: (params: Params) => Effect.Effect<A, E, R>,
            config: WithCachingConfig<Params>
        ): ((params: Params) => Effect.Effect<A, E, R>) => {
            // Validate config at wrap time
            if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
                return () =>
                    Effect.dieMessage(
                        "WithCachingConfig.ttlMillis must be positive"
                    ) as Effect.Effect<A, E, R>
            }

            return (params: Params) =>
                Effect.gen(function* () {
                    const now = yield* currentEpochMillis
                    const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

                    const entries = yield* store.getAll<Params, E, A>(config.cacheName)

                    const matchResult = yield* matchBestEntry({
                        now,
                        ttl,
                        params,
                        entries,
                        fuzzyParams: config.fuzzyParams,
                        embed
                    })

                    if (matchResult) {
                        return yield* exitToEffect(matchResult.entry.outcome)
                    }

                    const exit = yield* Effect.exit(fn(params))

                    const entry: CacheEntry<Params, E, A> = {
                        params,
                        outcome: exit,
                        createdAt: now
                    }

                    yield* store.put(config.cacheName, entry)

                    return yield* exitToEffect(exit)
                }) as Effect.Effect<A, E, R>
        }

        const withCachingMeta = <Params, A, E, R>(
            fn: (params: Params) => Effect.Effect<A, E, R>,
            config: WithCachingConfig<Params>
        ): ((
            params: Params
        ) => Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>) => {
            // Validate config at wrap time
            if (config.ttlMillis !== undefined && config.ttlMillis <= 0) {
                return () =>
                    Effect.dieMessage(
                        "WithCachingConfig.ttlMillis must be positive"
                    ) as Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>
            }

            return (params: Params) =>
                Effect.gen(function* () {
                    const now = yield* currentEpochMillis
                    const ttl = config.ttlMillis ?? DEFAULT_TTL_MILLIS

                    const entries = yield* store.getAll<Params, E, A>(config.cacheName)

                    const matchResult = yield* matchBestEntry({
                        now,
                        ttl,
                        params,
                        entries,
                        fuzzyParams: config.fuzzyParams,
                        embed
                    })

                    if (matchResult) {
                        const value = yield* exitToEffect(matchResult.entry.outcome)
                        return { value, cache: matchResult.hitMeta }
                    }

                    const exit = yield* Effect.exit(fn(params))

                    const entry: CacheEntry<Params, E, A> = {
                        params,
                        outcome: exit,
                        createdAt: now
                    }

                    yield* store.put(config.cacheName, entry)

                    const value = yield* exitToEffect(exit)
                    return {
                        value,
                        cache: { kind: "miss" as const, score: 0 }
                    }
                }) as Effect.Effect<{ value: A; cache: CacheHitMeta }, E, R>
        }

        return {
            withCaching: withCaching as FuzzyCache["withCaching"],
            withCachingMeta: withCachingMeta as FuzzyCache["withCachingMeta"]
        }
    })
)
