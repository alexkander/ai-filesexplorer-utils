import { NextResponse } from 'next/server';
import { listIgnoredPaths } from '@/application/duplicate-finder/list-ignored-paths';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';

export async function GET() {
  return NextResponse.json({
    paths: listIgnoredPaths(duplicateRepositoryAdapter),
  });
}
