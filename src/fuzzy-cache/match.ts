import { Effect, Equal } from "effect"
import type {
    CacheEntry,
    CacheHitMeta,
    ExactURLSpec,
    FuzzyParamsSpec
} from "./types.js"

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalize a URL string according to the ExactURL spec.
 * - Uses platform's URL class for normalization
 * - Optionally removes hash/fragment
 * - Falls back to raw string on parse error
 */
export const normalizeUrl = (raw: string, spec: ExactURLSpec): string => {
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

// ============================================================================
// Cosine Similarity
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * - Uses standard formula: (a·b) / (|a| |b|)
 * - Returns 0 if either vector has zero magnitude
 * - Result is in range [-1, 1], typically [0, 1] for text embeddings
 */
export const cosineSimilarity = (
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

// ============================================================================
// Score Entry
// ============================================================================

/**
 * Result of scoring a cache entry against a request.
 */
export type ScoreResult = {
    readonly ok: boolean
    readonly score: number
    readonly exact: boolean
}

/**
 * Embed function type for dependency injection.
 */
export type EmbedFn = (
    input: string,
    model: string
) => Effect.Effect<readonly number[]>

/**
 * Score a cached entry against the requested params.
 *
 * For each field:
 * - No fuzzy spec → Equal.equals; mismatch → ok: false
 * - ExactURL → normalized equality; mismatch → ok: false; otherwise score += 1
 * - MoreIsBetter → cached >= requested; if not ok: false; equal keeps exact; greater sets exact = false; score += 1
 * - CosineSimilarity → compute sim; if < threshold → ok: false; if < 1 → exact = false; score += sim
 *
 * Embedding failures are caught and treated as ok: false (skip candidate).
 */
export const scoreEntry = <Params>(
    requested: Params,
    cached: Params,
    fuzzy: FuzzyParamsSpec<Params>,
    embed: EmbedFn
): Effect.Effect<ScoreResult> =>
    Effect.gen(function* () {
        let score = 0
        let exact = true

        for (const key of Object.keys(requested as object) as Array<keyof Params>) {
            const spec = fuzzy[key]
            const req = requested[key]
            const prev = cached[key]

            if (!spec) {
                // No fuzzy spec - must match exactly
                if (!Equal.equals(req as unknown, prev as unknown)) {
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

                // Try to get embeddings - catch any failures
                const embedResult = yield* Effect.all([
                    embed(reqText, spec.model).pipe(
                        Effect.catchAll(() => Effect.succeed(null))
                    ),
                    embed(prevText, spec.model).pipe(
                        Effect.catchAll(() => Effect.succeed(null))
                    )
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

// ============================================================================
// Match Best Entry
// ============================================================================

/**
 * Arguments for matchBestEntry.
 */
export type MatchArgs<Params, E, A> = {
    readonly now: number
    readonly ttl: number
    readonly params: Params
    readonly entries: Iterable<CacheEntry<Params, E, A>>
    readonly fuzzyParams?: FuzzyParamsSpec<Params>
    readonly embed: EmbedFn
}

/**
 * Result of matching - the best entry and its hit metadata.
 */
export type MatchResult<Params, E, A> = {
    readonly entry: CacheEntry<Params, E, A>
    readonly hitMeta: CacheHitMeta
}

/**
 * Find the best matching cache entry for the given params.
 *
 * - Filters by TTL: now - createdAt <= ttl
 * - Scores each candidate entry
 * - Returns the entry with the highest score among ok: true candidates
 * - Returns null if no candidates match (cache miss)
 */
export const matchBestEntry = <Params, E, A>(
    args: MatchArgs<Params, E, A>
): Effect.Effect<MatchResult<Params, E, A> | null> =>
    Effect.gen(function* () {
        const { now, ttl, params, entries, fuzzyParams, embed } = args

        // Filter by TTL
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
