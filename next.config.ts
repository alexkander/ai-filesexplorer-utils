import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  env: { NEXT_PUBLIC_COMMIT_HASH: getCommitHash() },
};

export default nextConfig;
