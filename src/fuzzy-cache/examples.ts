import { Effect } from "effect"
import type { WithCachingConfig } from "./types.js"

// ============================================================================
// Example Types
// ============================================================================

/**
 * Reasoning level enum for example functions.
 * Used with MoreIsBetter - higher levels can substitute for lower.
 */
export enum ReasoningLevel {
    minimal = 0,
    low = 1,
    medium = 2,
    high = 3
}

// ============================================================================
// Example Function Param Types
// ============================================================================

export type SummarizeWebsiteParams = {
    url: string
    prompt: string
    reasoningLevel: ReasoningLevel
}

export type PredictUserInterestsParams = {
    userProfileBio: string
    userEmailDomain: string
    listOfPotentialInterests: string[]
    reasoningLevel: ReasoningLevel
}

// ============================================================================
// Example Functions
// ============================================================================

/**
 * Example function: Summarize a website.
 * This would typically call an LLM to generate the summary.
 */
export const summarizeWebsite = (
    params: SummarizeWebsiteParams
): Effect.Effect<string> =>
    Effect.succeed(
        `Summarized content from ${params.url} with prompt "${params.prompt}" ` +
        `at reasoning level ${ReasoningLevel[params.reasoningLevel]}`
    )

/**
 * Example function: Predict user interests.
 * This would typically use ML/LLM to analyze user data.
 */
export const predictUserInterests = (
    params: PredictUserInterestsParams
): Effect.Effect<string> =>
    Effect.succeed(
        `Predicted interests for user from ${params.userEmailDomain} ` +
        `with ${params.listOfPotentialInterests.length} potential interests`
    )

// ============================================================================
// Cache Configurations
// ============================================================================

/**
 * Cache config for summarizeWebsite.
 *
 * Fuzzy matching:
 * - url: ExactURL with excludeHash (same page, different fragments reuse cache)
 * - prompt: CosineSimilarity (paraphrased prompts can hit cache)
 * - reasoningLevel: MoreIsBetter (high-quality results reused for lower requests)
 */
export const summarizeWebsiteCacheConfig: WithCachingConfig<SummarizeWebsiteParams> =
{
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
}

/**
 * Cache config for predictUserInterests.
 *
 * Fuzzy matching:
 * - userProfileBio: CosineSimilarity (similar bios can hit cache)
 * - reasoningLevel: MoreIsBetter
 * - userEmailDomain: exact match (not specified in fuzzyParams)
 * - listOfPotentialInterests: exact match (not specified in fuzzyParams)
 */
export const predictUserInterestsCacheConfig: WithCachingConfig<PredictUserInterestsParams> =
{
    cacheName: "predictUserInterestsCache",
    fuzzyParams: {
        userProfileBio: {
            type: "CosineSimilarity",
            threshold: 0.1,
            model: "text-embedding-3-small"
        },
        reasoningLevel: { type: "MoreIsBetter" }
    }
}
