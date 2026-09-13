// Dedicated vitest config for wall-clock performance BENCHMARKS.
//
// These are measurement instruments, NOT pass/fail CI gates: wall-clock timings
// are environment-dependent and flaky across CI runners, so they must stay out
// of the default `pnpm test` run. The deterministic perf REGRESSION guard
// (tokenizer call-count) lives in a normal `*.spec.ts` and DOES run in CI; see
// src/__tests__/typingPerf.spec.ts and docs/dev/performance.md.
//
// Bench files are named `*.bench.ts` so the default config's
// `src/**/__tests__/**/*.{spec,test}.ts` include glob never picks them up.
//
// Used by:
//   pnpm --filter @muyajs/core test:bench     (runs all *.bench.ts, logs numbers)

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.bench.ts'],
        environment: 'happy-dom',
        // Benchmarks iterate many times; keep a generous ceiling.
        testTimeout: 60000,
    },
});
