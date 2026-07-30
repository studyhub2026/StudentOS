// Test stub for the `server-only` package.
//
// Next.js swaps `server-only` for an empty module in server builds, but under
// Vitest (plain Node) its real entry point throws on import. The service and
// lib modules under test all guard themselves with `import 'server-only'`, so
// this no-op stub is aliased in for them via vitest.config.ts.
export {};
