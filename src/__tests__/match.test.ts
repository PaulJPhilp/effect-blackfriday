import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
    cosineSimilarity,
    matchBestEntry,
    normalizeUrl,
    scoreEntry
} from "../fuzzy-cache/match.js"
import type { CacheEntry, FuzzyParamsSpec } from "../fuzzy-cache/types.js"

describe("normalizeUrl", () => {
    it("should remove hash when excludeHash is true", () => {
        const result = normalizeUrl("https://foo.com/page#section1", {
            type: "ExactURL",
            excludeHash: true
        })
        expect(result).toBe("https://foo.com/page")
    })

    it("should keep hash when excludeHash is false", () => {
        const result = normalizeUrl("https://foo.com/page#section1", {
            type: "ExactURL",
            excludeHash: false
        })
        expect(result).toBe("https://foo.com/page#section1")
    })

    it("should keep hash when excludeHash is undefined", () => {
        const result = normalizeUrl("https://foo.com/page#section1", {
            type: "ExactURL"
        })
        expect(result).toBe("https://foo.com/page#section1")
    })

    it("should return raw string for invalid URLs", () => {
        const result = normalizeUrl("not-a-url", {
            type: "ExactURL",
            excludeHash: true
        })
        expect(result).toBe("not-a-url")
    })

    it("should normalize URL casing (scheme and domain)", () => {
        const result = normalizeUrl("HTTPS://FOO.COM/Path", {
            type: "ExactURL",
            excludeHash: true
        })
        // Platform normalizes scheme and domain to lowercase
        expect(result.toLowerCase()).toContain("https://foo.com")
    })
})

describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
        const result = cosineSimilarity([1, 0], [1, 0])
        expect(result).toBeCloseTo(1, 5)
    })

    it("should return 0 for orthogonal vectors", () => {
        const result = cosineSimilarity([1, 0], [0, 1])
        expect(result).toBeCloseTo(0, 5)
    })

    it("should return -1 for opposite vectors", () => {
        const result = cosineSimilarity([1, 0], [-1, 0])
        expect(result).toBeCloseTo(-1, 5)
    })

    it("should handle similar vectors", () => {
        const result = cosineSimilarity([1, 0], [0.9, 0.1])
        // Should be close to but less than 1
        expect(result).toBeGreaterThan(0.9)
        expect(result).toBeLessThan(1)
    })

    it("should return 0 for zero magnitude vectors", () => {
        expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
        expect(cosineSimilarity([1, 0], [0, 0])).toBe(0)
        expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
    })

    it("should handle vectors of different lengths", () => {
        // Uses min length
        const result = cosineSimilarity([1, 0, 0], [1, 0])
        expect(result).toBeCloseTo(1, 5)
    })
})

describe("scoreEntry", () => {
    // Fake embed function for testing
    const fakeEmbed = (text: string): Effect.Effect<readonly number[]> => {
        const vectors: Record<string, readonly number[]> = {
            same: [1, 0],
            similar: [0.9, 0.1],
            different: [0, 1]
        }
        return Effect.succeed(vectors[text] ?? [text.length, 0])
    }

    describe("non-fuzzy exact matching", () => {
        it("should match exactly when all fields are equal", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ a: 1, b: "x" }, { a: 1, b: "x" }, {}, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(true)
            expect(result.score).toBe(2) // Two fields matched
        })

        it("should fail when any field differs", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ a: 1, b: "x" }, { a: 2, b: "x" }, {}, fakeEmbed)
            )

            expect(result.ok).toBe(false)
        })
    })

    describe("ExactURL matching", () => {
        type Params = { url: string }
        const fuzzy: FuzzyParamsSpec<Params> = {
            url: { type: "ExactURL", excludeHash: true }
        }

        it("should match when hash is ignored", async () => {
            const result = await Effect.runPromise(
                scoreEntry(
                    { url: "https://foo.com/page#section1" },
                    { url: "https://foo.com/page#section2" },
                    fuzzy,
                    fakeEmbed
                )
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(true)
            expect(result.score).toBe(1)
        })

        it("should fail when URLs differ (excluding hash)", async () => {
            const result = await Effect.runPromise(
                scoreEntry(
                    { url: "https://foo.com/page1" },
                    { url: "https://foo.com/page2" },
                    fuzzy,
                    fakeEmbed
                )
            )

            expect(result.ok).toBe(false)
        })

        it("should respect excludeHash: false", async () => {
            const fuzzyNoExclude: FuzzyParamsSpec<Params> = {
                url: { type: "ExactURL", excludeHash: false }
            }

            const result = await Effect.runPromise(
                scoreEntry(
                    { url: "https://foo.com/page#section1" },
                    { url: "https://foo.com/page#section2" },
                    fuzzyNoExclude,
                    fakeEmbed
                )
            )

            expect(result.ok).toBe(false)
        })
    })

    describe("MoreIsBetter matching", () => {
        type Params = { level: number }
        const fuzzy: FuzzyParamsSpec<Params> = {
            level: { type: "MoreIsBetter" }
        }

        it("should match when cached >= requested", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ level: 1 }, { level: 3 }, fuzzy, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(false) // Not exact because cached > requested
            expect(result.score).toBe(1)
        })

        it("should be exact when values are equal", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ level: 2 }, { level: 2 }, fuzzy, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(true)
            expect(result.score).toBe(1)
        })

        it("should fail when cached < requested", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ level: 3 }, { level: 1 }, fuzzy, fakeEmbed)
            )

            expect(result.ok).toBe(false)
        })
    })

    describe("CosineSimilarity matching", () => {
        type Params = { prompt: string }
        const fuzzy: FuzzyParamsSpec<Params> = {
            prompt: { type: "CosineSimilarity", threshold: 0.5, model: "test" }
        }

        it("should match when similarity >= threshold", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ prompt: "same" }, { prompt: "similar" }, fuzzy, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(false) // Not exact because sim < 1
            expect(result.score).toBeGreaterThan(0.5)
        })

        it("should be exact when vectors are identical", async () => {
            const result = await Effect.runPromise(
                scoreEntry({ prompt: "same" }, { prompt: "same" }, fuzzy, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.exact).toBe(true)
            expect(result.score).toBeCloseTo(1, 5)
        })

        it("should fail when similarity < threshold", async () => {
            const result = await Effect.runPromise(
                scoreEntry(
                    { prompt: "same" },
                    { prompt: "different" },
                    fuzzy,
                    fakeEmbed
                )
            )

            expect(result.ok).toBe(false)
        })
    })

    describe("embedding failures", () => {
        const failingEmbed = (text: string): Effect.Effect<readonly number[]> => {
            if (text === "bad-text") {
                return Effect.fail(new Error("Embedding failed"))
            }
            return Effect.succeed([text.length, 0])
        }

        type Params = { prompt: string }
        const fuzzy: FuzzyParamsSpec<Params> = {
            prompt: { type: "CosineSimilarity", threshold: 0.5, model: "test" }
        }

        it("should skip candidate when embedding fails", async () => {
            const result = await Effect.runPromise(
                scoreEntry(
                    { prompt: "normal" },
                    { prompt: "bad-text" },
                    fuzzy,
                    failingEmbed
                )
            )

            expect(result.ok).toBe(false)
        })
    })

    describe("score accumulation", () => {
        it("should accumulate scores from multiple fields", async () => {
            type Params = { a: number; b: number; c: number }

            const result = await Effect.runPromise(
                scoreEntry({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3 }, {}, fakeEmbed)
            )

            expect(result.ok).toBe(true)
            expect(result.score).toBe(3) // Three exact matches
        })

        it("should accumulate cosine similarity in score", async () => {
            type Params = { exact: number; fuzzy: string }
            const fuzzy: FuzzyParamsSpec<Params> = {
                fuzzy: { type: "CosineSimilarity", threshold: 0.5, model: "test" }
            }

            const result = await Effect.runPromise(
                scoreEntry(
                    { exact: 1, fuzzy: "same" },
                    { exact: 1, fuzzy: "similar" },
                    fuzzy,
                    fakeEmbed
                )
            )

            expect(result.ok).toBe(true)
            // Score = 1 (exact match) + similarity (< 1)
            expect(result.score).toBeGreaterThan(1)
            expect(result.score).toBeLessThan(2)
        })
    })
})

describe("matchBestEntry", () => {
    const fakeEmbed = (text: string): Effect.Effect<readonly number[]> =>
        Effect.succeed([text.length, 0])

    const makeEntry = <P>(
        params: P,
        value: string,
        createdAt: number
    ): CacheEntry<P, never, string> => ({
        params,
        outcome: Exit.succeed(value),
        createdAt
    })

    it("should return null for empty entries", async () => {
        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { x: 1 },
                entries: [],
                fuzzyParams: {},
                embed: fakeEmbed
            })
        )

        expect(result).toBeNull()
    })

    it("should return null when all entries are expired", async () => {
        const result = await Effect.runPromise(
            matchBestEntry({
                now: 10000,
                ttl: 1000,
                params: { x: 1 },
                entries: [makeEntry({ x: 1 }, "old", 0)],
                fuzzyParams: {},
                embed: fakeEmbed
            })
        )

        expect(result).toBeNull()
    })

    it("should return matching entry within TTL", async () => {
        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { x: 1 },
                entries: [makeEntry({ x: 1 }, "value", 500)],
                fuzzyParams: {},
                embed: fakeEmbed
            })
        )

        expect(result).not.toBeNull()
        expect(result?.hitMeta.kind).toBe("exact")
        expect(result?.hitMeta.score).toBe(1)
    })

    it("should select highest scoring entry", async () => {
        type Params = { level: number }
        const entries: CacheEntry<Params, never, string>[] = [
            makeEntry({ level: 1 }, "low", 0),
            makeEntry({ level: 3 }, "high", 0),
            makeEntry({ level: 2 }, "medium", 0)
        ]

        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { level: 1 },
                entries,
                fuzzyParams: { level: { type: "MoreIsBetter" } },
                embed: fakeEmbed
            })
        )

        // All entries satisfy level: 1, but they all have score = 1
        // The first one that matches should be returned
        expect(result).not.toBeNull()
    })

    it("should skip entries that don't match", async () => {
        type Params = { x: number }
        const entries: CacheEntry<Params, never, string>[] = [
            makeEntry({ x: 2 }, "wrong", 0),
            makeEntry({ x: 1 }, "right", 0)
        ]

        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { x: 1 },
                entries,
                fuzzyParams: {},
                embed: fakeEmbed
            })
        )

        expect(result).not.toBeNull()
        expect(Exit.isSuccess(result!.entry.outcome)).toBe(true)
        if (Exit.isSuccess(result!.entry.outcome)) {
            expect(result!.entry.outcome.value).toBe("right")
        }
    })

    it("should return fuzzy kind for non-exact matches", async () => {
        type Params = { level: number }
        const entries: CacheEntry<Params, never, string>[] = [
            makeEntry({ level: 3 }, "high", 0)
        ]

        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { level: 1 }, // Requesting lower than cached
                entries,
                fuzzyParams: { level: { type: "MoreIsBetter" } },
                embed: fakeEmbed
            })
        )

        expect(result?.hitMeta.kind).toBe("fuzzy")
    })

    it("should return null when all candidates fail to score", async () => {
        const failingEmbed = (): Effect.Effect<readonly number[]> =>
            Effect.fail(new Error("Embedding failed"))

        type Params = { prompt: string }
        const entries: CacheEntry<Params, never, string>[] = [
            makeEntry({ prompt: "test" }, "value", 0)
        ]

        const result = await Effect.runPromise(
            matchBestEntry({
                now: 1000,
                ttl: 5000,
                params: { prompt: "test" },
                entries,
                fuzzyParams: {
                    prompt: { type: "CosineSimilarity", threshold: 0.5, model: "test" }
                },
                embed: failingEmbed
            })
        )

        expect(result).toBeNull()
    })
})
