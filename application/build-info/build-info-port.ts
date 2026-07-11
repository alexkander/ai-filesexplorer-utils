export interface BuildInfo {
  appName: string;
  version: string;
  commitHash: string;
}

export interface BuildInfoPort {
  getBuildInfo(): BuildInfo;
}
