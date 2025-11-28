import { Effect } from "effect"

/**
 * Main entry point for effect-blackfriday
 */
export function main(): Effect.Effect<void> {
	return Effect.gen(function* () {
		yield* Effect.log("Hello from effect-blackfriday!")
	})
}

// Run if this is the main module
if (import.meta.main) {
	Effect.runPromise(main())
}

