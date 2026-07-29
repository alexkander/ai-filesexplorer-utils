import { NextResponse } from 'next/server';
import { stopScan } from '@/application/duplicate-finder/stop-scan';
import { duplicateScanWorker } from '@/infrastructure/duplicate-finder/duplicate-scan-worker';

export async function POST() {
  stopScan(duplicateScanWorker);
  return NextResponse.json({ stopped: true });
}
