import { NextResponse } from 'next/server';
import { getScanStatus } from '@/application/duplicate-finder/get-scan-status';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';
// Importing the worker here (and not only in /scan) is what guarantees its
// startup reconciliation runs even when the first thing a fresh process
// serves is a status poll — otherwise a scan interrupted by a restart would
// keep reporting `running` until someone pressed Scan again.
import '@/infrastructure/duplicate-finder/duplicate-scan-worker';

export async function GET() {
  return NextResponse.json(getScanStatus(duplicateRepositoryAdapter));
}
