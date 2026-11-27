export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function buildPageResponse<E, T>(
  items: E[],
  mapFn: (item: E) => T,
  page: number,
  size: number,
  total: number,
): PageResponse<T> {
  // Skip may be 0 or negative for out-of-range pages, so treat those requests
  // as an empty page rather than silently claiming the first/last page.
  if (!Number.isFinite(page) || page < 0 || !Number.isFinite(size) || size <= 0) {
    return {
      content: [],
      page: Number.isFinite(page) ? Math.trunc(page) : 0,
      size: Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0,
      totalElements: total,
      totalPages: 0,
      first: false,
      last: false,
      hasNext: false,
      hasPrevious: false,
    };
  }

  const safePage = Math.trunc(page);
  const safeSize = Math.trunc(size);
  const totalPages = Math.ceil(total / safeSize);
  if (safePage >= totalPages) {
    // Genuinely out-of-range: items should be empty; report coherent flags.
    return {
      content: items.map(mapFn),
      page: safePage,
      size: safeSize,
      totalElements: total,
      totalPages,
      first: safePage === 0,
      last: totalPages === 0,
      hasNext: false,
      hasPrevious: totalPages > 0,
    };
  }

  return {
    content: items.map(mapFn),
    page: safePage,
    size: safeSize,
    totalElements: total,
    totalPages,
    first: safePage === 0,
    last: safePage >= totalPages - 1,
    hasNext: safePage < totalPages - 1,
    hasPrevious: safePage > 0,
  };
}
