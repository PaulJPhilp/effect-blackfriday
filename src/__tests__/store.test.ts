import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
    FuzzyCacheStoreService,
    makeFuzzyCacheStoreService
} from "../fuzzy-cache/store.js"
import type { CacheEntry } from "../fuzzy-cache/types.js"

describe("FuzzyCacheStoreService", () => {
    const makeEntry = <P, E, A>(
        params: P,
        outcome: Exit.Exit<A, E>,
        createdAt: number
    ): CacheEntry<P, E, A> => ({
        params,
        outcome,
        createdAt
    })

    describe("basic operations", () => {
        it("should store and retrieve entries", async () => {
            const program = Effect.gen(function* () {
                const store = yield* makeFuzzyCacheStoreService()

                const entry1 = makeEntry({ x: 1 }, Exit.succeed("result1"), 1000)
                const entry2 = makeEntry({ x: 2 }, Exit.succeed("result2"), 2000)

                yield* store.put("cacheA", entry1)
                yield* store.put("cacheA", entry2)

                const entries = yield* store.getAll<{ x: number }, never, string>(
                    "cacheA"
                )
                return Array.from(entries)
            })

            const result = await Effect.runPromise(program)

            expect(result).toHaveLength(2)
            expect(result[0]?.params).toEqual({ x: 1 })
            expect(result[1]?.params).toEqual({ x: 2 })
        })

        it("should return empty iterable for unknown cache name", async () => {
            const program = Effect.gen(function* () {
                const store = yield* makeFuzzyCacheStoreService()
                const entries = yield* store.getAll<unknown, unknown, unknown>(
                    "unknown"
                )
                return Array.from(entries)
            })

            const result = await Effect.runPromise(program)
            expect(result).toEqual([])
        })
    })

    describe("cache isolation", () => {
        it("should isolate entries by cache name", async () => {
            const program = Effect.gen(function* () {
                const store = yield* makeFuzzyCacheStoreService()

                const entryA = makeEntry({ id: "a" }, Exit.succeed("A"), 1000)
                const entryB = makeEntry({ id: "b" }, Exit.succeed("B"), 2000)

                yield* store.put("cacheA", entryA)
                yield* store.put("cacheB", entryB)

                const entriesA = yield* store.getAll<{ id: string }, never, string>(
                    "cacheA"
                )
                const entriesB = yield* store.getAll<{ id: string }, never, string>(
                    "cacheB"
                )

                return {
                    cacheA: Array.from(entriesA),
                    cacheB: Array.from(entriesB)
                }
            })

            const result = await Effect.runPromise(program)

            expect(result.cacheA).toHaveLength(1)
            expect(result.cacheA[0]?.params).toEqual({ id: "a" })

            expect(result.cacheB).toHaveLength(1)
            expect(result.cacheB[0]?.params).toEqual({ id: "b" })
        })
    })

    describe("insertion order", () => {
        it("should maintain insertion order", async () => {
            const program = Effect.gen(function* () {
                const store = yield* makeFuzzyCacheStoreService()

                for (let i = 1; i <= 5; i++) {
                    yield* store.put(
                        "cache",
                        makeEntry({ order: i }, Exit.succeed(`result${i}`), i * 1000)
                    )
                }

                const entries = yield* store.getAll<{ order: number }, never, string>(
                    "cache"
                )
                return Array.from(entries).map((e) => e.params.order)
            })

            const result = await Effect.runPromise(program)
            expect(result).toEqual([1, 2, 3, 4, 5])
        })
    })

    describe("failure caching", () => {
        it("should store and retrieve failure entries", async () => {
            const program = Effect.gen(function* () {
                const store = yield* makeFuzzyCacheStoreService()

                const failureEntry = makeEntry(
                    { id: "failed" },
                    Exit.fail("error message"),
                    1000
                )

                yield* store.put("cache", failureEntry)

                const entries = yield* store.getAll<{ id: string }, string, never>(
                    "cache"
                )
                const entry = Array.from(entries)[0]

                return entry?.outcome
            })

            const result = await Effect.runPromise(program)

            expect(Exit.isFailure(result!)).toBe(true)
        })
    })

    describe("via Effect.Service", () => {
        it("should work via the Effect.Service class", async () => {
            const program = Effect.gen(function* () {
                const store = yield* FuzzyCacheStoreService

                yield* store.put(
                    "test",
                    makeEntry({ x: 1 }, Exit.succeed("value"), 1000)
                )

                const entries = yield* store.getAll<{ x: number }, never, string>(
                    "test"
                )
                return Array.from(entries)
            }).pipe(Effect.provide(FuzzyCacheStoreService.Default))

            const result = await Effect.runPromise(program)

            expect(result).toHaveLength(1)
            expect(result[0]?.params).toEqual({ x: 1 })
        })
    })
})
