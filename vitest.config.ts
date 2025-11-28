import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		environment: "node",
		include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.spec.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "dist/", "**/*.config.*", "**/__tests__/**"],
		},
	},
})

