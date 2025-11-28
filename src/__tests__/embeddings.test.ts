import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
    EmbeddingsService,
    makeEmbeddingsLayer,
    makeEmbeddingsService,
    type RawEmbedFn
} from "../fuzzy-cache/embeddings.js"

describe("EmbeddingsService", () => {
    describe("memoization", () => {
        it("should call rawEmbed only once for repeated (text, model) pairs", async () => {
            const callCount = { value: 0 }

            const fakeRawEmbed: RawEmbedFn = (text, model) => {
                callCount.value++
                return Effect.succeed([text.length, model.length])
            }

            const program = Effect.gen(function* () {
                const service = yield* makeEmbeddingsService(fakeRawEmbed)

                // Call twice with same key
                const v1 = yield* service.embed("hello", "m1")
                const v2 = yield* service.embed("hello", "m1")

                return { v1, v2, callCount: callCount.value }
            })

            const result = await Effect.runPromise(program)

            expect(result.v1).toEqual([5, 2])
            expect(result.v2).toEqual([5, 2])
            expect(result.callCount).toBe(1)
        })

        it("should cache separately for different models", async () => {
            const callCount = { value: 0 }

            const fakeRawEmbed: RawEmbedFn = (text, model) => {
                callCount.value++
                return Effect.succeed([text.length, model.length])
            }

            const program = Effect.gen(function* () {
                const service = yield* makeEmbeddingsService(fakeRawEmbed)

                const v1 = yield* service.embed("hello", "m1")
                const v2 = yield* service.embed("hello", "m2")

                return { v1, v2, callCount: callCount.value }
            })

            const result = await Effect.runPromise(program)

            expect(result.v1).toEqual([5, 2])
            expect(result.v2).toEqual([5, 2])
            expect(result.callCount).toBe(2)
        })

        it("should cache separately for different texts", async () => {
            const callCount = { value: 0 }

            const fakeRawEmbed: RawEmbedFn = (text, model) => {
                callCount.value++
                return Effect.succeed([text.length, model.length])
            }

            const program = Effect.gen(function* () {
                const service = yield* makeEmbeddingsService(fakeRawEmbed)

                const v1 = yield* service.embed("hello", "m1")
                const v2 = yield* service.embed("world", "m1")

                return { v1, v2, callCount: callCount.value }
            })

            const result = await Effect.runPromise(program)

            expect(result.v1).toEqual([5, 2])
            expect(result.v2).toEqual([5, 2])
            expect(result.callCount).toBe(2)
        })
    })

    describe("concurrency", () => {
        it("should handle concurrent calls (allowing some duplicate rawEmbed calls)", async () => {
            const callCount = { value: 0 }

            const fakeRawEmbed: RawEmbedFn = (text, model) => {
                callCount.value++
                // Simulate some async work
                return Effect.delay(Effect.succeed([text.length, model.length]), "10 millis")
            }

            const program = Effect.gen(function* () {
                const service = yield* makeEmbeddingsService(fakeRawEmbed)

                // Fire multiple concurrent calls
                const results = yield* Effect.all(
                    Array.from({ length: 10 }, () => service.embed("same-text", "m1")),
                    { concurrency: "unbounded" }
                )

                return { results, callCount: callCount.value }
            })

            const result = await Effect.runPromise(program)

            // All vectors should be equal
            for (const vec of result.results) {
                expect(vec).toEqual([9, 2])
            }

            // v1: duplicate in-flight calls allowed, but should be less than 10
            // The actual number depends on timing, but it should be reasonable
            expect(result.callCount).toBeLessThanOrEqual(10)
        })
    })

    describe("error handling", () => {
        it("should propagate embedding failures", async () => {
            const fakeRawEmbed: RawEmbedFn = (text) => {
                if (text === "bad-text") {
                    return Effect.fail(new Error("Embedding failed"))
                }
                return Effect.succeed([text.length])
            }

            const program = Effect.gen(function* () {
                const service = yield* makeEmbeddingsService(fakeRawEmbed)
                return yield* service.embed("bad-text", "m1")
            })

            await expect(Effect.runPromise(program)).rejects.toThrow("Embedding failed")
        })
    })

    describe("Layer creation", () => {
        it("should create a working layer with makeEmbeddingsLayer", async () => {
            const fakeRawEmbed: RawEmbedFn = (text) => Effect.succeed([text.length])

            const testLayer = makeEmbeddingsLayer(fakeRawEmbed)

            const program = Effect.gen(function* () {
                const { embed } = yield* EmbeddingsService
                return yield* embed("test", "model")
            }).pipe(Effect.provide(testLayer))

            const result = await Effect.runPromise(program)
            expect(result).toEqual([4])
        })
    })
})
