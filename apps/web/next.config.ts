import { join } from 'node:path'

import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The image runs the standalone server, traced from the repo's root so the workspace's packages come along.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  // The commit the image is built from: a tab on an older build reloads rather than ask for chunks or actions this one lacks.
  ...(process.env.BUILD_ID ? { deploymentId: process.env.BUILD_ID } : {}),
  // next dev writes no AGENTS.md: the repo's own CLAUDE.md is the agents' guide.
  agentRules: false,
  experimental: {
    // next dev tells an agent to run `next upgrade` when the installed Next.js has a security advisory.
    agentUpgrade: 'security',
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: './lib/empty.ts' },
      path: { browser: './lib/empty.ts' },
    },
  },
}

export default config
