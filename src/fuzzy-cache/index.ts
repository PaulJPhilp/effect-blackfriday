// ============================================================================
// FuzzyCache - Fuzzy Caching for Effect Services
// ============================================================================

// Types
export { DEFAULT_TTL_MILLIS } from "./types.js"
export type {
    CacheEntry,
    CacheHitKind,
    CacheHitMeta,
    CacheOutcome,
    CosineSimilaritySpec,
    ExactURLSpec,
    FuzzyFieldSpecFor,
    FuzzyParamsSpec,
    MoreIsBetterSpec,
    NumericLike,
    WithCachingConfig
} from "./types.js"

// Embeddings
export {
    EmbeddingsService,
    makeEmbeddingsLayer,
    makeEmbeddingsService
} from "./embeddings.js"
export type { EmbeddingKey, Embeddings, RawEmbedFn } from "./embeddings.js"

// Store
export { FuzzyCacheStoreService, makeFuzzyCacheStoreService } from "./store.js"
export type { FuzzyCacheStore } from "./store.js"

// Matching
export {
    cosineSimilarity,
    matchBestEntry,
    normalizeUrl,
    scoreEntry
} from "./match.js"
export type { EmbedFn, MatchArgs, MatchResult, ScoreResult } from "./match.js"

// Service
export { FuzzyCacheService } from "./service.js"
export type { FuzzyCache } from "./service.js"

// Examples
export {
    predictUserInterests,
    predictUserInterestsCacheConfig,
    ReasoningLevel,
    summarizeWebsite,
    summarizeWebsiteCacheConfig
} from "./examples.js"
export type {
    PredictUserInterestsParams,
    SummarizeWebsiteParams
} from "./examples.js"

