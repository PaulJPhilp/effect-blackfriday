# AGENTS.md

This document provides guidance for AI coding assistants (Claude Code, Gemini CLI, Amp) when working on this project.

## Project Context

Effect Black Friday is an experimental project for managing Black Friday deals using Effect.ts. This project demonstrates Effect.ts patterns for handling asynchronous operations, error handling, and service composition.

**Tech Stack:**
- Language: TypeScript 5.8+ (strict mode)
- Runtime: Effect.ts 3.16+
- Package Manager: Bun
- Testing: Vitest

## Key Principles

1. **Type Safety First**: Let TypeScript catch errors at compile time
2. **Effect Everything**: All side effects go through Effect runtime
3. **Explicit Errors**: Use custom TaggedError classes, avoid generic Error
4. **Pure Functions**: Keep business logic separate from effects
5. **Test Coverage**: Write tests for utilities and critical paths

## Rules

Follow workspace root rules:
- **CLAUDE.md**: Project-specific guidance
- **`.cursor/rules/effect-*.mdc`**: Effect patterns (automatically applied)

For Effect Patterns rules, see the workspace root `.cursor/rules/effect-*.mdc` files or the project's CLAUDE.md for references.

## Common Tasks

### Adding a New Utility

1. Create `src/utils/newThing.ts`
2. Define error type in `src/types.ts` if needed
3. Implement function returning `Effect.Effect<T, Err>`
4. Create `src/__tests__/newThing.test.ts` with Vitest
5. Export from `src/index.ts`

### Adding a Service

1. Create `src/services/MyService.ts`
2. Use `Effect.Service` class pattern (Effect v3.16+)
3. Define TaggedError types for errors
4. Write tests in `src/__tests__/MyService.test.ts`
5. Export from `src/index.ts`

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Implement fix in source
3. Verify test passes
4. Run full test suite: `bun test`
5. Check types compile: `bun run check`

## Build & Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build TypeScript
bun run build

# Type checking
bun run check

# Development mode
bun run dev
```

## Directory Structure

```
src/
├── services/        # Service implementations (Effect.Service)
├── schema.ts       # Schema definitions (optional)
├── types.ts        # Type definitions
├── index.ts        # Main entry point
└── __tests__/      # Test files
```

## Effect.ts Patterns

- **Effect.Service**: Use class pattern only (v3.16+)
- **Tagged Errors**: All errors extend `Data.TaggedError`
- **Dependency Injection**: Access via `yield* ServiceName`
- **No Context.Tag**: Only use `Effect.Service` class pattern

See workspace root rules for detailed patterns:
- `/Users/paul/Projects/.cursor/rules/EFFECT_BEGINNER_PATTERNS.md`
- `/Users/paul/Projects/.cursor/rules/EFFECT_INTERMEDIATE_PATTERNS.md`
- `/Users/paul/Projects/.cursor/rules/EFFECT_ADVANCED_PATTERNS.md`

