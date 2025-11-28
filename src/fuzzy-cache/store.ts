import { Effect, Ref } from "effect"
import type { CacheEntry } from "./types.js"

// ============================================================================
// Types
// ============================================================================

/**
 * FuzzyCacheStore service interface.
 * Provides process-local storage of cache entries keyed by cacheName.
 */
export type FuzzyCacheStore = {
    /**
     * Get all entries for a cache name.
     * Returns empty iterable if cache doesn't exist.
     */
    readonly getAll: <P, E, A>(
        cacheName: string
    ) => Effect.Effect<Iterable<CacheEntry<P, E, A>>>

    /**
     * Append an entry to a cache.
     * Entries are stored in insertion order.
     * No deduplication - same params may be cached multiple times.
     */
    readonly put: <P, E, A>(
        cacheName: string,
        entry: CacheEntry<P, E, A>
    ) => Effect.Effect<void>
}

// ============================================================================
// FuzzyCacheStoreService
// ============================================================================

/**
 * Creates a FuzzyCacheStoreService backed by Ref<Map>.
 *
 * v1 constraints:
 * - Unbounded storage (no eviction)
 * - No deduplication
 * - Entries stored in insertion order (approximate for concurrent puts)
 */
export const makeFuzzyCacheStoreService = (): Effect.Effect<FuzzyCacheStore> =>
    Effect.gen(function* () {
        const mapRef = yield* Ref.make(
            new Map<string, Array<CacheEntry<unknown, unknown, unknown>>>()
        )

        const getAll = <P, E, A>(
            cacheName: string
        ): Effect.Effect<Iterable<CacheEntry<P, E, A>>> =>
            Ref.get(mapRef).pipe(
                Effect.map((map) => (map.get(cacheName) ?? []) as CacheEntry<P, E, A>[])
            )

        const put = <P, E, A>(
            cacheName: string,
            entry: CacheEntry<P, E, A>
        ): Effect.Effect<void> =>
            Ref.update(mapRef, (map) => {
                const existing = map.get(cacheName) ?? []
                const newMap = new Map(map)
                newMap.set(cacheName, [
                    ...existing,
                    entry as CacheEntry<unknown, unknown, unknown>
                ])
                return newMap
            })

        return { getAll, put } as const
    })

/**
 * FuzzyCacheStoreService as an Effect.Service class.
 */
export class FuzzyCacheStoreService extends Effect.Service<FuzzyCacheStore>()(
    "FuzzyCacheStore",
    {
        effect: makeFuzzyCacheStoreService(),
        accessors: true
    }
) { }
