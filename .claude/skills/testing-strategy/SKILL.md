---
name: testing-strategy
description: Design test strategies and test plans. Trigger with "how should we test", "test strategy for", "write tests for", "test plan", "what tests do we need", or when the user needs help with testing approaches, coverage, or test architecture.
---

> **Lens Lab project note** (added for this repo; everything below the note is Anthropic's original skill from [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills`, commit `da38ec1`, unchanged).
>
> Tests are Vitest unit tests in `tests/` (`npm test`): hand-calculated optics cases (`optics`, `lensModel`,
> `phoneOptics`), schema checks of every file in `data/`, and invariants of the illustrative optical layouts. Keep new
> physics cases in sync with the "physics verification" tables in `PLAN.md`. There is no component-test framework: UI and
> rendering are checked end-to-end with Playwright against `npm run dev` / `npm run preview` at desktop and phone widths,
> with zero console errors. WebGL is software-rendered in the container, so assert on DOM state and console output, not
> on frame rates.

# Testing Strategy

Design effective testing strategies balancing coverage, speed, and maintenance.

## Testing Pyramid

```
        /  E2E  \         Few, slow, high confidence
       / Integration \     Some, medium speed
      /    Unit Tests  \   Many, fast, focused
```

## Strategy by Component Type

- **API endpoints**: Unit tests for business logic, integration tests for HTTP layer, contract tests for consumers
- **Data pipelines**: Input validation, transformation correctness, idempotency tests
- **Frontend**: Component tests, interaction tests, visual regression, accessibility
- **Infrastructure**: Smoke tests, chaos engineering, load tests

## What to Cover

Focus on: business-critical paths, error handling, edge cases, security boundaries, data integrity.

Skip: trivial getters/setters, framework code, one-off scripts.

## Output

Produce a test plan with: what to test, test type for each area, coverage targets, and example test cases. Identify gaps in existing coverage.
