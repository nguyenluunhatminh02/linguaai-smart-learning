import { Pool } from 'pg';

/**
 * DB-04 pagination contract: a cursor is the pair (created_at, id).
 * Deterministic ordering requires both columns, because `created_at` alone
 * can be identical for rows inserted in the same statement or transaction.
 *
 * The helpers live in this spec deliberately: the assigned slice is tests only.
 * When the production helper lands in `pagination.util.ts`, replace these local
 * definitions with imports and keep the assertions unchanged.
 */

type SortDirection = 'asc' | 'desc';

interface CursorRow {
  created_at: Date | string;
  id: string;
  created_at_iso?: string;
}

interface Cursor {
  createdAt: string;
  id: string;
}

function normalizeTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid cursor timestamp: ${String(value)}`);
  }
  return date.toISOString();
}

function encodeCursor(row: CursorRow): string {
  // Always normalise to a UTC ISO string: pg returns Date objects whose
  // toString() carries a timezone offset, and a cursor must round-trip exactly.
  return Buffer.from(
    `${normalizeTimestamp(row.created_at)}|${row.id}`,
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid cursor encoding');
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) {
    throw new Error('Invalid cursor payload');
  }
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(new Date(createdAt).getTime()) || id.length === 0) {
    throw new Error('Invalid cursor payload');
  }
  return { createdAt, id };
}

function compareCursorRows(a: CursorRow, b: CursorRow): number {
  const byTime = normalizeTimestamp(a.created_at).localeCompare(
    normalizeTimestamp(b.created_at),
  );
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

function afterCursor<T extends CursorRow>(
  rows: T[],
  cursor: string | undefined,
  direction: SortDirection = 'asc',
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  if (!cursor) {
    return [...rows].sort((a, b) => factor * compareCursorRows(a, b));
  }
  const { createdAt, id } = decodeCursor(cursor);
  const anchor: CursorRow = { created_at: createdAt, id };
  return rows
    .filter((row) => factor * compareCursorRows(row, anchor) > 0)
    .sort((a, b) => factor * compareCursorRows(a, b));
}

interface Page<T> {
  content: T[];
  nextCursor?: string;
}

function paginate<T extends CursorRow>(
  rows: T[],
  limit: number,
  cursor?: string,
  direction: SortDirection = 'asc',
): Page<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  const remaining = afterCursor(rows, cursor, direction);
  const content = remaining.slice(0, limit);
  const last = content[content.length - 1];
  return {
    content,
    nextCursor:
      remaining.length > limit && last ? encodeCursor(last) : undefined,
  };
}

/**
 * Composite SQL predicate with a fixed parameter layout: $1 is the cursor
 * timestamp (NULL on the first page), $2 the cursor id, $3 the scope and $4
 * the limit. $1 IS NULL bypasses the keyset condition on the first page.
 */
function cursorPredicate(direction: SortDirection): string {
  const operator = direction === 'asc' ? '>' : '<';
  return `($1::timestamp IS NULL OR created_at ${operator} $1::timestamp OR (created_at = $1::timestamp AND id ${operator} $2::uuid))`;
}

function cursorParams(
  cursor: string | undefined,
): [string | null, string | null] {
  if (!cursor) return [null, null];
  const { createdAt, id } = decodeCursor(cursor);
  return [createdAt, id];
}

const fixedTimestamp = '2026-01-15T08:30:00.000Z';
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
];

describe('cursor pagination contract (created_at, id)', () => {
  describe('unit behaviour', () => {
    it('breaks equal-timestamp ties by id so no row is skipped or repeated', () => {
      // Input order deliberately differs from keyset order.
      const rows = [ids[2], ids[0], ids[4], ids[1], ids[3]].map((id) => ({
        id,
        created_at: new Date(fixedTimestamp),
        body: id,
      }));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
        const page = paginate(rows, 2, cursor);
        seen.push(...page.content.map((row) => row.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toEqual(ids);
      expect(new Set(seen).size).toBe(ids.length);
      expect(cursor).toBeUndefined();
    });

    it('pages through a mix of duplicate and distinct timestamps without drift', () => {
      const rows = [
        { id: ids[4], created_at: '2026-01-15T08:31:00.000Z' },
        { id: ids[1], created_at: fixedTimestamp },
        { id: ids[3], created_at: fixedTimestamp },
        { id: ids[0], created_at: '2026-01-15T08:29:00.000Z' },
        { id: ids[2], created_at: fixedTimestamp },
      ];

      const collected: string[] = [];
      let cursor: string | undefined;
      do {
        const page = paginate(rows, 1, cursor);
        expect(page.content).toHaveLength(1);
        collected.push(page.content[0].id);
        cursor = page.nextCursor;
      } while (cursor);

      expect(collected).toEqual([ids[0], ids[1], ids[2], ids[3], ids[4]]);
    });

    it('pages descending with the opposite keyset comparison', () => {
      const rows = ids.map((id) => ({
        id,
        created_at: new Date(fixedTimestamp),
      }));
      const cursor = encodeCursor(rows[2]);

      expect(cursorPredicate('desc')).toBe(
        '($1::timestamp IS NULL OR created_at < $1::timestamp OR (created_at = $1::timestamp AND id < $2::uuid))',
      );
      expect(cursorParams(cursor)).toEqual([fixedTimestamp, ids[2]]);

      const page = paginate(rows, 2, cursor, 'desc');
      expect(page.content.map((row) => row.id)).toEqual([ids[1], ids[0]]);
    });

    it('uses the composite condition for ascending traversal too', () => {
      expect(cursorPredicate('asc')).toBe(
        '($1::timestamp IS NULL OR created_at > $1::timestamp OR (created_at = $1::timestamp AND id > $2::uuid))',
      );
      const cursor = encodeCursor({
        id: ids[1],
        created_at: fixedTimestamp,
      });
      expect(cursorParams(cursor)).toEqual([fixedTimestamp, ids[1]]);
    });

    it('ignores rows inserted concurrently behind the last delivered cursor', () => {
      const rows = ids.map((id) => ({
        id,
        created_at: new Date(fixedTimestamp),
      }));
      const first = paginate(rows, 2);

      // New rows share the timestamp but sort before the cursor: offset
      // pagination would shift the window and repeat ids[1]; keyset does not.
      const lateRows = [
        {
          id: '00000000-0000-4000-8000-000000000000',
          created_at: new Date(fixedTimestamp),
        },
        ...rows,
      ];
      const second = paginate(lateRows, 2, first.nextCursor);

      expect(second.content.map((row) => row.id)).toEqual([ids[2], ids[3]]);
    });

    it('includes rows inserted concurrently ahead of the last delivered cursor', () => {
      const rows = ids.slice(0, 3).map((id) => ({
        id,
        created_at: new Date(fixedTimestamp),
      }));
      const first = paginate(rows, 2);

      const withLateRow = [
        ...rows,
        { id: ids[3], created_at: new Date(fixedTimestamp) },
      ];
      const second = paginate(withLateRow, 3, first.nextCursor);

      expect(second.content.map((row) => row.id)).toEqual([ids[2], ids[3]]);
    });

    it('rejects malformed cursors instead of silently restarting page 1', () => {
      expect(() => decodeCursor('not-a-cursor')).toThrow(
        'Invalid cursor payload',
      );
      expect(() =>
        decodeCursor(
          Buffer.from('bad-time|some-id', 'utf8').toString('base64url'),
        ),
      ).toThrow('Invalid cursor payload');
    });
  });

  /**
   * Integration coverage against a disposable Postgres only. Set
   * RUN_PAGINATION_DB_TESTS=1 and point DATABASE_URL at a throwaway test DB.
   * Never run this against a production or shared development database.
   */
  describe('Postgres integration', () => {
    const runDbTests = process.env.RUN_PAGINATION_DB_TESTS === '1';
    const describeDb = runDbTests ? describe : describe.skip;
    let pool: Pool | undefined;
    const conversationId = '10000000-0000-4000-8000-000000000001';
    const tableName = 'pagination_cursor_test';

    async function fetchPage(
      limit: number,
      direction: SortDirection,
      cursor?: string,
    ): Promise<Page<CursorRow>> {
      if (!pool) throw new Error('Test pool is not initialised');
      const [cursorTime, cursorId] = cursorParams(cursor);
      const result = await pool.query(
        `SELECT id, created_at, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
         FROM ${tableName}
         WHERE conversation_id = $3::uuid
         AND ${cursorPredicate(direction)}
         ORDER BY created_at ${direction}, id ${direction}
         LIMIT $4`,
        [cursorTime, cursorId, conversationId, limit],
      );
      const rows = result.rows as CursorRow[];
      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && last
          ? encodeCursor({
              id: last.id,
              created_at: last.created_at_iso ?? last.created_at,
            })
          : undefined;
      // A full final page can yield the same cursor again; stop rather than
      // looping forever when no row advanced past the anchor.
      return {
        content: rows,
        nextCursor: nextCursor === cursor ? undefined : nextCursor,
      };
    }

    beforeAll(async () => {
      if (!runDbTests) return;
      const url =
        process.env.DATABASE_URL || 'postgresql://localhost:5432/linguaai_test';
      pool = new Pool({ connectionString: url });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL,
          created_at TIMESTAMP(6) NOT NULL,
          body TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_pagination_cursor_test_keyset
          ON ${tableName} (conversation_id, created_at, id);
      `);
      await pool.query(`DELETE FROM ${tableName} WHERE conversation_id = $1`, [
        conversationId,
      ]);
    });

    afterAll(async () => {
      if (!pool) return;
      await pool.query(`DELETE FROM ${tableName} WHERE conversation_id = $1`, [
        conversationId,
      ]);
      await pool.end();
      pool = undefined;
    });

    describeDb('with equal timestamps', () => {
      it('traverses all rows exactly once when every created_at is identical', async () => {
        if (!pool) throw new Error('Test pool is not initialised');
        await pool.query(
          `INSERT INTO ${tableName} (id, conversation_id, created_at, body)
           SELECT unnest($1::uuid[]), $2::uuid, $3::timestamp, 'seed'`,
          [ids, conversationId, fixedTimestamp],
        );

        const collected: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await fetchPage(2, 'asc', cursor);
          collected.push(...page.content.map((row) => row.id));
          cursor = page.nextCursor;
        } while (cursor);

        expect(collected).toEqual(ids);
      });

      it('does not skip or repeat rows when N inserts commit concurrently', async () => {
        if (!pool) throw new Error('Test pool is not initialised');
        await pool.query(
          `DELETE FROM ${tableName} WHERE conversation_id = $1`,
          [conversationId],
        );
        const concurrentIds = ids.map(
          (_, index) =>
            `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        );

        // No sleeps: the barrier is Promise.all over independent inserts.
        await Promise.all(
          concurrentIds.map((id) =>
            pool!.query(
              `INSERT INTO ${tableName} (id, conversation_id, created_at, body)
               VALUES ($1, $2, $3, 'concurrent')`,
              [id, conversationId, fixedTimestamp],
            ),
          ),
        );

        const collected: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await fetchPage(2, 'asc', cursor);
          collected.push(...page.content.map((row) => row.id));
          cursor = page.nextCursor;
        } while (cursor);

        expect(collected).toEqual([...concurrentIds].sort());
        expect(new Set(collected).size).toBe(concurrentIds.length);
      });

      it('keeps rows inserted after the first page stable in descending order', async () => {
        if (!pool) throw new Error('Test pool is not initialised');
        await pool.query(
          `DELETE FROM ${tableName} WHERE conversation_id = $1`,
          [conversationId],
        );
        await pool.query(
          `INSERT INTO ${tableName} (id, conversation_id, created_at, body)
           SELECT unnest($1::uuid[]), $2::uuid, $3::timestamp, 'seed'`,
          [ids, conversationId, fixedTimestamp],
        );

        const first = await fetchPage(2, 'desc');
        const lateId = '30000000-0000-4000-8000-000000000001';
        await pool.query(
          `INSERT INTO ${tableName} (id, conversation_id, created_at, body)
           VALUES ($1, $2, $3, 'late')`,
          [lateId, conversationId, fixedTimestamp],
        );

        const collected = [...first.content.map((row) => row.id)];
        let cursor = first.nextCursor;
        while (cursor) {
          const page = await fetchPage(2, 'desc', cursor);
          collected.push(...page.content.map((row) => row.id));
          cursor = page.nextCursor;
        }

        // `lateId` sorts after the first page's cursor, so a descending
        // traversal must not revisit it; the remaining seed rows are intact.
        expect(collected).toEqual([...ids].sort().reverse());
        expect(collected).not.toContain(lateId);
        expect(new Set(collected).size).toBe(collected.length);
      });
    });
  });
});
