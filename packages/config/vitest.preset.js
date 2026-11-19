// Shared Vitest settings: spread into a package's own vitest config.
export default {
  test: {
    include: ['src/**/*.test.ts'],
    // A test may run for 30 s before it counts as hung: on a CI runner busy with every package's
    // tests at once, a test of a few seconds can take several times as long. Speed is checked by
    // the tests that time what they mean to.
    testTimeout: 30_000,
  },
}
