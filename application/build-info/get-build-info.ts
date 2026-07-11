import type { BuildInfo, BuildInfoPort } from './build-info-port';

export function getBuildInfo(port: BuildInfoPort): BuildInfo {
  return port.getBuildInfo();
}
