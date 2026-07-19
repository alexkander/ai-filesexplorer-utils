import { NextResponse } from 'next/server';
import { listIgnoredPaths } from '@/application/directory-comparison/list-ignored-paths';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';

export async function GET() {
  const paths = listIgnoredPaths(comparisonRepositoryAdapter);
  return NextResponse.json({ paths });
}
