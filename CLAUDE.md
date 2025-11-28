# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on this project.

## Project Overview

Effect Black Friday is an experimental project for managing Black Friday deals using Effect.ts. This project demonstrates Effect.ts patterns for handling asynchronous operations, error handling, and service composition.

## Technologies

- **Runtime**: Bun
- **Language**: TypeScript 5.8+
- **Framework**: Effect.ts 3.16+
- **Package Manager**: Bun
- **Testing**: Vitest

## Project Structure

```
project-root/
├── src/
│   ├── services/    # Service implementations (Effect.Service)
│   ├── schema.ts    # Schema definitions (optional)
│   ├── types.ts      # Type definitions
│   └── index.ts      # Main entry point
├── __tests__/        # Test files
├── dist/             # Build output (gitignored)
└── node_modules/     # Dependencies (gitignored)
```

## Development Commands

```bash
bun install          # Install dependencies
bun run build        # Build the project
bun run test         # Run tests (watch mode)
bun run test:ci      # Run tests with coverage
bun run check        # Type checking
bun run dev          # Development mode
```

## Coding Standards

This project follows the workspace root coding standards. See:

- **Workspace Root**: `/Users/paul/Projects/CLAUDE.md` - Workspace-level guidance
- **Coding Standards**: `/Users/paul/Projects/.cursor/rules/CODING_STANDARDS.md`
- **TypeScript Patterns**: `/Users/paul/Projects/.cursor/rules/TYPESCRIPT_PATTERNS.md`

## Effect.ts Patterns

For Effect.ts patterns, see the workspace root rules:

- **Beginner**: `/Users/paul/Projects/.cursor/rules/EFFECT_BEGINNER_PATTERNS.md`
- **Intermediate**: `/Users/paul/Projects/.cursor/rules/EFFECT_INTERMEDIATE_PATTERNS.md`
- **Advanced**: `/Users/paul/Projects/.cursor/rules/EFFECT_ADVANCED_PATTERNS.md`

These rules are automatically applied when working with TypeScript files.

## Project-Specific Rules

[Add any project-specific rules, conventions, or patterns here]

## Common Tasks

### Adding a New Service

1. Create `src/services/MyService.ts`
2. Use `Effect.Service` class pattern (Effect v3.16+)
3. Define TaggedError types for errors
4. Write tests in `src/__tests__/MyService.test.ts`
5. Export from `src/index.ts`

### Adding a New Feature

1. Create feature module in `src/features/`
2. Implement using Effect patterns
3. Add integration tests
4. Update documentation

## Testing

- Use Vitest for all tests
- No Vitest mocks - build custom mocks instead
- Prefer integration tests over mocks
- Co-locate tests with source files in `__tests__/` directories

## Type Safety

- Strict mode enabled
- No `any` types - use `unknown` and narrow
- Interfaces over types for object shapes
- Avoid enums - use maps or const objects

