import { NextResponse } from 'next/server';
import { listUnreliableSizeFiles } from '@/application/directory-comparison/list-unreliable-size-files';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';

export async function GET() {
  const files = listUnreliableSizeFiles(comparisonRepositoryAdapter);
  return NextResponse.json({ files });
}
