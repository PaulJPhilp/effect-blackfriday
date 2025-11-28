import { Data, Effect, HashMap, Layer, Ref } from "effect"

// ============================================================================
// Types
// ============================================================================

/**
 * Key for embedding cache - combines text and model for uniqueness.
 */
export type EmbeddingKey = {
    readonly text: string
    readonly model: string
}

/**
 * The raw embedding provider function type.
 * This is the function that actually calls the embedding API.
 */
export type RawEmbedFn = (
    input: string,
    model: string
) => Effect.Effect<readonly number[]>

/**
 * Embeddings service interface.
 * Provides memoized embedding lookups.
 */
export type Embeddings = {
    readonly embed: (
        input: string,
        model: string
    ) => Effect.Effect<readonly number[]>
}

// ============================================================================
// Default rawEmbed (placeholder)
// ============================================================================

/**
 * Default rawEmbed implementation that fails.
 * In production, this would be replaced with an actual embedding provider.
 */
const defaultRawEmbed: RawEmbedFn = () =>
    Effect.dieMessage("rawEmbed not implemented - provide a real embedding provider")

// ============================================================================
// EmbeddingsService
// ============================================================================

/**
 * Creates an EmbeddingsService with the given rawEmbed function.
 * Memoizes embeddings per (text, model) key indefinitely.
 *
 * v1 constraints:
 * - Unbounded memoization (no size cap or TTL for embeddings)
 * - Concurrent calls may result in duplicate rawEmbed calls if they miss simultaneously
 */
export const makeEmbeddingsService = (
    rawEmbed: RawEmbedFn = defaultRawEmbed
): Effect.Effect<Embeddings> =>
    Effect.gen(function* () {
        const cacheRef = yield* Ref.make(
            HashMap.empty<EmbeddingKey, readonly number[]>()
        )

        const embed = (input: string, model: string): Effect.Effect<readonly number[]> =>
            Effect.gen(function* () {
                const key = Data.struct({ text: input, model })

                const cache0 = yield* Ref.get(cacheRef)
                const cached = HashMap.get(cache0, key)

                if (cached._tag === "Some") {
                    return cached.value
                }

                const vector = yield* rawEmbed(input, model)

                // Store in cache - note: concurrent calls may store the same key twice
                // which is acceptable for v1
                yield* Ref.update(cacheRef, HashMap.set(key, vector))

                return vector
            })

        return { embed } as const
    })

/**
 * EmbeddingsService as an Effect.Service class.
 * Uses default rawEmbed (which will fail if called without override).
 */
export class EmbeddingsService extends Effect.Service<Embeddings>()(
    "Embeddings",
    {
        effect: makeEmbeddingsService(defaultRawEmbed),
        accessors: true
    }
) { }

/**
 * Creates a Layer for EmbeddingsService with a custom rawEmbed function.
 */
export const makeEmbeddingsLayer = (rawEmbed: RawEmbedFn) =>
    Layer.effect(EmbeddingsService, makeEmbeddingsService(rawEmbed))