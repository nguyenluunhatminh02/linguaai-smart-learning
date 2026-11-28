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

export interface CursorPageRequest {
  cursor?: string;
  limit: number;
  direction?: 'forward' | 'backward';
}

export interface CursorPageResponse<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  limit: number;
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
  if (
    !Number.isFinite(page) ||
    page < 0 ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
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

interface CursorPayload {
  t: string;
  i: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CursorDirection = 'forward' | 'backward';

function normalizeDirection(direction?: CursorDirection): CursorDirection {
  return direction === 'backward' ? 'backward' : 'forward';
}

function invertOrder(order: 'asc' | 'desc'): 'asc' | 'desc' {
  return order === 'asc' ? 'desc' : 'asc';
}

export function encodeCursor<T extends { created_at: Date; id: string }>(
  row: T,
): string {
  const payload: CursorPayload = {
    t: row.created_at.toISOString(),
    i: row.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { t: Date; i: string } | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    // base64url is URL-safe, so whitespace/newlines indicate a malformed cursor.
    if (/[^A-Za-z0-9_-]/.test(raw)) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.t !== 'string' ||
      typeof parsed.i !== 'string'
    ) {
      return null;
    }
    if (!UUID_PATTERN.test(parsed.i)) {
      return null;
    }
    const timestamp = new Date(parsed.t);
    if (!Number.isFinite(timestamp.getTime())) {
      return null;
    }
    return { t: timestamp, i: parsed.i };
  } catch {
    return null;
  }
}

export function buildCursorWhere(
  direction: CursorDirection | undefined,
  cursor: string | undefined,
  tieBreakOrder: 'asc' | 'desc' = 'desc',
): Record<string, unknown> | undefined {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (!decoded) {
    return undefined;
  }

  const effectiveDirection = normalizeDirection(direction);
  // Forward walks in the requested sort direction; backward reverses it.
  const comparison =
    (effectiveDirection === 'forward'
      ? tieBreakOrder
      : invertOrder(tieBreakOrder)) === 'asc'
      ? 'gt'
      : 'lt';
  const operator = { [comparison]: decoded.t };
  const idOperator = { [comparison]: decoded.i };

  // The strict comparison must live only inside the OR. Putting it at the top
  // level would AND it with the tie-break branch and skip every row sharing
  // the cursor's created_at timestamp.
  return {
    OR: [{ created_at: operator }, { created_at: decoded.t, id: idOperator }],
  };
}

export function buildCursorOrderBy(
  direction: CursorDirection | undefined,
  tieBreakOrder: 'asc' | 'desc' = 'desc',
): Array<{ created_at: 'asc' | 'desc' } | { id: 'asc' | 'desc' }> {
  const order =
    normalizeDirection(direction) === 'forward'
      ? tieBreakOrder
      : invertOrder(tieBreakOrder);
  return [{ created_at: order }, { id: order }];
}
