import { NextRequest, NextResponse } from 'next/server';
import { listDirectoryDuplicates } from '@/application/duplicate-finder/list-directory-duplicates';
import { isDirectorySortBy } from '@/domain/duplicate-finder/directory-row';
import { isSortDir } from '@/domain/duplicate-finder/duplicate-group';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sortByParam = params.get('sortBy') ?? 'count';
  const sortDirParam = params.get('sortDir') ?? 'desc';
  const pageParam = Number(params.get('page') ?? '0');

  return NextResponse.json(
    listDirectoryDuplicates({
      repository: duplicateRepositoryAdapter,
      path: params.get('path'),
      sortBy: isDirectorySortBy(sortByParam) ? sortByParam : 'count',
      sortDir: isSortDir(sortDirParam) ? sortDirParam : 'desc',
      hideEmptyDirectories: params.get('hideEmpty') === 'true',
      filters: {
        excludeEmptyFiles: params.get('excludeEmptyFiles') === 'true',
        excludeEmptyDirectories:
          params.get('excludeEmptyDirectories') === 'true',
      },
      page: Number.isFinite(pageParam) ? pageParam : 0,
    }),
  );
}
