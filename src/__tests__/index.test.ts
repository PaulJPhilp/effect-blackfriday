import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { main } from "../index"

describe("main", () => {
	it("should run successfully", async () => {
		const program = main()
		await expect(Effect.runPromise(program)).resolves.toBeUndefined()
	})
})

