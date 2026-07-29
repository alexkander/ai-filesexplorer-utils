import { NextRequest, NextResponse } from 'next/server';
import { listDuplicateGroups } from '@/application/duplicate-finder/list-duplicate-groups';
import { isSortBy } from '@/domain/duplicate-finder/duplicate-group';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';

export async function GET(request: NextRequest) {
  const sortByParam = request.nextUrl.searchParams.get('sortBy') ?? 'size';
  const pageParam = Number(request.nextUrl.searchParams.get('page') ?? '0');

  const page = Number.isFinite(pageParam) ? pageParam : 0;

  return NextResponse.json(
    listDuplicateGroups({
      repository: duplicateRepositoryAdapter,
      sortBy: isSortBy(sortByParam) ? sortByParam : 'size',
      page,
    }),
  );
}
