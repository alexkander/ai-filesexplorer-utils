import { NextResponse } from 'next/server';
import { checksumMatchWorker } from '@/infrastructure/directory-comparison/checksum-match-worker';

export async function GET() {
  return NextResponse.json(checksumMatchWorker.getStatus());
}
