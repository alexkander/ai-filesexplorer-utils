import pkg from '@/package.json';
import { APP_NAME } from '@/infrastructure/app-name';
import type {
  BuildInfo,
  BuildInfoPort,
} from '@/application/build-info/build-info-port';

export const buildInfoAdapter: BuildInfoPort = {
  getBuildInfo(): BuildInfo {
    return {
      appName: APP_NAME,
      version: pkg.version,
      commitHash: process.env.NEXT_PUBLIC_COMMIT_HASH || 'unknown',
    };
  },
};
