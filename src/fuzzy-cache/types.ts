import { Exit } from "effect"

// ============================================================================
// Fuzzy Specs
// ============================================================================

/**
 * Compare string fields by embedding similarity.
 * Only applicable to string fields.
 */
export type CosineSimilaritySpec = {
    readonly type: "CosineSimilarity"
    readonly threshold: number
    readonly model: string
}

/**
 * Normalize and compare URLs for equality.
 * Only applicable to string fields.
 */
export type ExactURLSpec = {
    readonly type: "ExactURL"
    readonly excludeHash?: boolean
}

/**
 * For numeric/enum fields: cached value satisfies request if cached >= requested.
 * Only applicable to numeric fields.
 */
export type MoreIsBetterSpec = {
    readonly type: "MoreIsBetter"
}

// ============================================================================
// Field-Level Type Constraints
// ============================================================================

/**
 * Numeric-like type for MoreIsBetter constraint
 */
export type NumericLike = number

/**
 * Type-level constraint that ensures fuzzy specs are only applied to appropriate field types:
 * - CosineSimilarity and ExactURL can only be applied to string fields
 * - MoreIsBetter can only be applied to numeric fields
 */
export type FuzzyFieldSpecFor<Params, K extends keyof Params> =
    Params[K] extends string
    ? CosineSimilaritySpec | ExactURLSpec
    : Params[K] extends NumericLike
    ? MoreIsBetterSpec
    : never

/**
 * Fuzzy parameter specification for a params object.
 * Each field can optionally have a fuzzy matching rule.
 */
export type FuzzyParamsSpec<Params> = {
    readonly [K in keyof Params]?: FuzzyFieldSpecFor<Params, K>
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * The outcome of a cached computation - stored as an Exit for both success and failure.
 */
export type CacheOutcome<E, A> = Exit.Exit<A, E>

/**
 * A cache entry storing the params, outcome, and creation timestamp.
 */
export type CacheEntry<Params, E, A> = {
    readonly params: Params
    readonly outcome: CacheOutcome<E, A>
    readonly createdAt: number // epoch millis
}

/**
 * The kind of cache hit that occurred.
 */
export type CacheHitKind = "miss" | "exact" | "fuzzy"

/**
 * Metadata about a cache lookup result.
 * Score is cumulative and used for ranking candidates - not an absolute quality metric.
 */
export type CacheHitMeta = {
    readonly kind: CacheHitKind
    readonly score: number // cumulative match strength; 0 for miss
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default TTL: 24 hours in milliseconds
 */
export const DEFAULT_TTL_MILLIS = 24 * 60 * 60 * 1000

/**
 * Configuration for wrapping a function with fuzzy caching.
 * - cacheName: unique identifier for this cache
 * - fuzzyParams: optional fuzzy matching rules per field
 * - ttlMillis: optional TTL in milliseconds (must be positive if specified, defaults to 24h)
 */
export type WithCachingConfig<Params> = {
    readonly cacheName: string
    readonly fuzzyParams?: FuzzyParamsSpec<Params>
    readonly ttlMillis?: number // default 24h; must be positive if specified
}
