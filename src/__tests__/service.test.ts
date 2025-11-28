import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
    makeEmbeddingsLayer,
    type RawEmbedFn
} from "../fuzzy-cache/embeddings.js"
import { FuzzyCacheService, makeFuzzyCacheLayer } from "../fuzzy-cache/service.js"
import { FuzzyCacheStoreService } from "../fuzzy-cache/store.js"
import type { WithCachingConfig } from "../fuzzy-cache/types.js"

/**
 * Create a test layer for FuzzyCacheService with a custom embeddings function.
 * Since FuzzyCacheService.Default has baked-in EmbeddingsService.Default,
 * we need to use makeFuzzyCacheLayer to compose with custom embeddings.
 */
const createTestLayer = (rawEmbed: RawEmbedFn) => {
    const embeddingsLayer = makeEmbeddingsLayer(rawEmbed)
    const storeLayer = FuzzyCacheStoreService.Default

    // Use makeFuzzyCacheLayer which doesn't have dependencies baked in
    return makeFuzzyCacheLayer.pipe(
        Layer.provide(embeddingsLayer),
        Layer.provide(storeLayer)
    )
}

// Simple fake embeddings that maps text to deterministic vectors
const simpleFakeEmbed: RawEmbedFn = (text) =>
    Effect.succeed([text.length, text.charCodeAt(0) ?? 0])

// Helper to run a program with the test layer
const runWithLayer = <A, E>(
    program: Effect.Effect<A, E, FuzzyCacheService>,
    rawEmbed: RawEmbedFn = simpleFakeEmbed
) => Effect.runPromise(program.pipe(Effect.provide(createTestLayer(rawEmbed))))

describe("FuzzyCacheService", () => {
    describe("exact caching (no fuzzy params)", () => {
        it("should cache and reuse exact matches", async () => {
            const callCount = { value: 0 }

            const fn = (params: { x: number }) => {
                callCount.value++
                return Effect.succeed(params.x * 2)
            }

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)

                const r1 = yield* cached({ x: 5 })
                const r2 = yield* cached({ x: 5 })

                return { r1, r2, callCount: callCount.value }
            })

            const result = await runWithLayer(program)

            expect(result.r1).toBe(10)
            expect(result.r2).toBe(10)
            expect(result.callCount).toBe(1) // Only called once
        })

        it("should compute separately for different params", async () => {
            const callCount = { value: 0 }

            const fn = (params: { x: number }) => {
                callCount.value++
                return Effect.succeed(params.x * 2)
            }

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)

                const r1 = yield* cached({ x: 5 })
                const r2 = yield* cached({ x: 10 })

                return { r1, r2, callCount: callCount.value }
            })

            const result = await runWithLayer(program)

            expect(result.r1).toBe(10)
            expect(result.r2).toBe(20)
            expect(result.callCount).toBe(2) // Called twice
        })
    })

    describe("configuration validation", () => {
        it("should die with invalid ttlMillis = 0", async () => {
            const fn = (params: { x: number }) => Effect.succeed(params.x)

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test",
                ttlMillis: 0
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)
                return yield* cached({ x: 1 })
            })

            await expect(runWithLayer(program)).rejects.toThrow(
                "ttlMillis must be positive"
            )
        })

        it("should die with invalid ttlMillis < 0", async () => {
            const fn = (params: { x: number }) => Effect.succeed(params.x)

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test",
                ttlMillis: -100
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)
                return yield* cached({ x: 1 })
            })

            await expect(runWithLayer(program)).rejects.toThrow(
                "ttlMillis must be positive"
            )
        })

        it("should work with valid positive ttlMillis", async () => {
            const fn = (params: { x: number }) => Effect.succeed(params.x * 2)

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test",
                ttlMillis: 1000
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)
                return yield* cached({ x: 5 })
            })

            const result = await runWithLayer(program)
            expect(result).toBe(10)
        })
    })

    describe("withCachingMeta", () => {
        it("should return miss on first call", async () => {
            const fn = (params: { x: number }) => Effect.succeed(params.x * 2)

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCachingMeta } = yield* FuzzyCacheService
                const cached = withCachingMeta(fn, config)
                return yield* cached({ x: 5 })
            })

            const result = await runWithLayer(program)

            expect(result.value).toBe(10)
            expect(result.cache.kind).toBe("miss")
            expect(result.cache.score).toBe(0)
        })

        it("should return exact hit on second call with same params", async () => {
            const fn = (params: { x: number }) => Effect.succeed(params.x * 2)

            const config: WithCachingConfig<{ x: number }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCachingMeta } = yield* FuzzyCacheService
                const cached = withCachingMeta(fn, config)

                const r1 = yield* cached({ x: 5 })
                const r2 = yield* cached({ x: 5 })

                return { r1, r2 }
            })

            const result = await runWithLayer(program)

            expect(result.r1.cache.kind).toBe("miss")
            expect(result.r2.cache.kind).toBe("exact")
            expect(result.r2.cache.score).toBeGreaterThan(0)
        })

        it("should return fuzzy hit when MoreIsBetter matches", async () => {
            const fn = (params: { level: number }) =>
                Effect.succeed(`level-${params.level}`)

            const config: WithCachingConfig<{ level: number }> = {
                cacheName: "test",
                fuzzyParams: {
                    level: { type: "MoreIsBetter" }
                }
            }

            const program = Effect.gen(function* () {
                const { withCachingMeta } = yield* FuzzyCacheService
                const cached = withCachingMeta(fn, config)

                // First call with high level
                const r1 = yield* cached({ level: 3 })
                // Second call with lower level - should get fuzzy hit
                const r2 = yield* cached({ level: 1 })

                return { r1, r2 }
            })

            const result = await runWithLayer(program)

            expect(result.r1.cache.kind).toBe("miss")
            expect(result.r2.cache.kind).toBe("fuzzy") // Fuzzy because cached > requested
            expect(result.r2.value).toBe("level-3") // Reuses high level result
        })
    })

    describe("failure caching", () => {
        it("should cache and reuse failures", async () => {
            const callCount = { value: 0 }

            const fn = (params: { id: string }) => {
                callCount.value++
                if (params.id === "bad") {
                    return Effect.fail("boom" as const)
                }
                return Effect.succeed("ok" as const)
            }

            const config: WithCachingConfig<{ id: string }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)

                // First call - fails
                const r1 = yield* cached({ id: "bad" }).pipe(
                    Effect.either
                )
                // Second call - should reuse cached failure
                const r2 = yield* cached({ id: "bad" }).pipe(
                    Effect.either
                )

                return { r1, r2, callCount: callCount.value }
            })

            const result = await runWithLayer(program)

            expect(result.r1._tag).toBe("Left")
            expect(result.r2._tag).toBe("Left")
            expect(result.callCount).toBe(1) // Only called once
        })

        it("should keep success and failure caches separate", async () => {
            const callCount = { value: 0 }

            const fn = (params: { id: string }) => {
                callCount.value++
                if (params.id === "bad") {
                    return Effect.fail("boom" as const)
                }
                return Effect.succeed("ok" as const)
            }

            const config: WithCachingConfig<{ id: string }> = {
                cacheName: "test"
            }

            const program = Effect.gen(function* () {
                const { withCaching } = yield* FuzzyCacheService
                const cached = withCaching(fn, config)

                // Failure
                const r1 = yield* cached({ id: "bad" }).pipe(Effect.either)
                // Success with different params
                const r2 = yield* cached({ id: "good" }).pipe(Effect.either)

                return { r1, r2, callCount: callCount.value }
            })

            const result = await runWithLayer(program)

            expect(result.r1._tag).toBe("Left")
            expect(result.r2._tag).toBe("Right")
            expect(result.callCount).toBe(2) // Called twice
        })
    })

    describe("fuzzy matching scenarios", () => {
        describe("ExactURL with excludeHash", () => {
            it("should reuse cache for same URL with different hash", async () => {
                const callCount = { value: 0 }

                const fn = (params: { url: string }) => {
                    callCount.value++
                    return Effect.succeed(`content-${params.url}`)
                }

                const config: WithCachingConfig<{ url: string }> = {
                    cacheName: "test",
                    fuzzyParams: {
                        url: { type: "ExactURL", excludeHash: true }
                    }
                }

                const program = Effect.gen(function* () {
                    const { withCaching } = yield* FuzzyCacheService
                    const cached = withCaching(fn, config)

                    const r1 = yield* cached({ url: "https://foo.com/page#section1" })
                    const r2 = yield* cached({ url: "https://foo.com/page#section2" })

                    return { r1, r2, callCount: callCount.value }
                })

                const result = await runWithLayer(program)

                expect(result.callCount).toBe(1) // Only called once
                expect(result.r2).toBe(result.r1) // Same result
            })
        })

        describe("MoreIsBetter", () => {
            it("should reuse higher level result for lower request", async () => {
                const callCount = { value: 0 }

                const fn = (params: { level: number }) => {
                    callCount.value++
                    return Effect.succeed(`computed-at-${params.level}`)
                }

                const config: WithCachingConfig<{ level: number }> = {
                    cacheName: "test",
                    fuzzyParams: {
                        level: { type: "MoreIsBetter" }
                    }
                }

                const program = Effect.gen(function* () {
                    const { withCaching } = yield* FuzzyCacheService
                    const cached = withCaching(fn, config)

                    // First call with high level
                    const r1 = yield* cached({ level: 3 })
                    // Second call with medium - should reuse high
                    const r2 = yield* cached({ level: 2 })
                    // Third call with low - should reuse high
                    const r3 = yield* cached({ level: 1 })

                    return { r1, r2, r3, callCount: callCount.value }
                })

                const result = await runWithLayer(program)

                expect(result.callCount).toBe(1) // Only called once
                expect(result.r1).toBe("computed-at-3")
                expect(result.r2).toBe("computed-at-3")
                expect(result.r3).toBe("computed-at-3")
            })

            it("should not reuse lower level for higher request", async () => {
                const callCount = { value: 0 }

                const fn = (params: { level: number }) => {
                    callCount.value++
                    return Effect.succeed(`computed-at-${params.level}`)
                }

                const config: WithCachingConfig<{ level: number }> = {
                    cacheName: "test",
                    fuzzyParams: {
                        level: { type: "MoreIsBetter" }
                    }
                }

                const program = Effect.gen(function* () {
                    const { withCaching } = yield* FuzzyCacheService
                    const cached = withCaching(fn, config)

                    // First call with low level
                    const r1 = yield* cached({ level: 1 })
                    // Second call with higher level - must recompute
                    const r2 = yield* cached({ level: 3 })

                    return { r1, r2, callCount: callCount.value }
                })

                const result = await runWithLayer(program)

                expect(result.callCount).toBe(2) // Called twice
                expect(result.r1).toBe("computed-at-1")
                expect(result.r2).toBe("computed-at-3")
            })
        })

        describe("CosineSimilarity", () => {
            it("should match similar prompts above threshold", async () => {
                const callCount = { value: 0 }

                // Custom embeddings that make "hello" and "hallo" similar
                const customEmbed: RawEmbedFn = (text) => {
                    if (text === "hello") return Effect.succeed([1, 0])
                    if (text === "hallo") return Effect.succeed([0.95, 0.1]) // Similar to hello
                    if (text === "goodbye") return Effect.succeed([0, 1]) // Different
                    return Effect.succeed([text.length, 0])
                }

                const fn = (params: { prompt: string }) => {
                    callCount.value++
                    return Effect.succeed(`response-to-${params.prompt}`)
                }

                const config: WithCachingConfig<{ prompt: string }> = {
                    cacheName: "test",
                    fuzzyParams: {
                        prompt: {
                            type: "CosineSimilarity",
                            threshold: 0.8,
                            model: "test"
                        }
                    }
                }

                const program = Effect.gen(function* () {
                    const { withCaching } = yield* FuzzyCacheService
                    const cached = withCaching(fn, config)

                    const r1 = yield* cached({ prompt: "hello" })
                    const r2 = yield* cached({ prompt: "hallo" }) // Similar
                    const r3 = yield* cached({ prompt: "goodbye" }) // Different

                    return { r1, r2, r3, callCount: callCount.value }
                })

                const result = await runWithLayer(program, customEmbed)

                expect(result.r1).toBe("response-to-hello")
                expect(result.r2).toBe("response-to-hello") // Reused from similar
                expect(result.r3).toBe("response-to-goodbye") // Different, recomputed
                expect(result.callCount).toBe(2) // hello and goodbye
            })
        })
    })

    describe("realistic summarizeWebsite scenario", () => {
        it("should handle combined fuzzy params", async () => {
            const callCount = { value: 0 }

            enum ReasoningLevel {
                low = 1,
                medium = 2,
                high = 3
            }

            type Params = {
                url: string
                prompt: string
                reasoningLevel: ReasoningLevel
            }

            const fn = (params: Params) => {
                callCount.value++
                return Effect.succeed(
                    `Summary of ${params.url} with "${params.prompt}" at level ${params.reasoningLevel}`
                )
            }

            // Custom embeddings for prompt similarity
            const customEmbed: RawEmbedFn = (text) => {
                // Make "Explain X" and "Describe X" similar
                if (text.includes("Explain")) return Effect.succeed([1, 0.1])
                if (text.includes("Describe")) return Effect.succeed([0.95, 0.15])
                return Effect.succeed([0, 1])
            }

            const config: WithCachingConfig<Params> = {
                cacheName: "summarize",
                fuzzyParams: {
                    url: { type: "ExactURL", excludeHash: true },
                    prompt: {
                        type: "CosineSimilarity",
                        threshold: 0.8,
                        model: "test"
                    },
                    reasoningLevel: { type: "MoreIsBetter" }
                }
            }

            const program = Effect.gen(function* () {
                const { withCachingMeta } = yield* FuzzyCacheService
                const cached = withCachingMeta(fn, config)

                // Initial call
                const r1 = yield* cached({
                    url: "https://example.com/page#section1",
                    prompt: "Explain the topic",
                    reasoningLevel: ReasoningLevel.high
                })

                // Same page different hash, similar prompt, lower reasoning
                const r2 = yield* cached({
                    url: "https://example.com/page#section2",
                    prompt: "Describe the topic",
                    reasoningLevel: ReasoningLevel.medium
                })

                // Different page - should miss
                const r3 = yield* cached({
                    url: "https://different.com/page",
                    prompt: "Explain the topic",
                    reasoningLevel: ReasoningLevel.low
                })

                return { r1, r2, r3, callCount: callCount.value }
            })

            const result = await runWithLayer(program, customEmbed)

            expect(result.r1.cache.kind).toBe("miss")
            expect(result.r2.cache.kind).toBe("fuzzy") // Reused with fuzzy match
            expect(result.r3.cache.kind).toBe("miss") // Different URL
            expect(result.callCount).toBe(2) // Only r1 and r3 computed
        })
    })
})
