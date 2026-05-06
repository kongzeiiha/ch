/**
 * Operation logs — full audit trail of human-initiated writes.
 *
 * Two ways a row gets written:
 *   1. **Explicit** — handler calls `logOperation(req, {...})`. Use this when
 *      you want a meaningful operation name + payload (before/after, reason).
 *   2. **Catch-all hook** — `onResponse` writes a fallback row for any admin
 *      write (POST/PATCH/PUT/DELETE) that didn't already log explicitly.
 *      Guarantees no human write goes unrecorded.
 *
 * Operator identity comes from `x-operator` / `x-operator-id` headers (UI fills
 * them; missing → 'anonymous'). When real auth lands, swap getOperator() to
 * read from req.user.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { query } from '@ch/db';

export interface OperationContext {
  /** "<domain>.<action>", e.g. "source.create" / "compliance.approve" */
  operation: string;
  /** Type of the entity being operated on. */
  targetType: string;
  /** Primary key of the entity (UUID for items/sources, task uuid for distribution_tasks). */
  targetId?: string | null;
  /** Free-form structured context — before/after diff, reason, batch ids, etc. */
  payload?: Record<string, unknown>;
}

interface LogRow extends OperationContext {
  operator: string;
  operatorId: string | null;
  requestId: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  statusCode: number | null;
  ip: string | null;
  userAgent: string | null;
}

const OPLOG_HANDLED = Symbol.for('ch.opLogHandled');
const OPLOG_IDS = Symbol.for('ch.opLogIds');

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `logOperation()` so the catch-all hook knows not to double-write. */
    [OPLOG_HANDLED]?: boolean;
    /** IDs of explicit log rows written this request, backfilled with the final
     *  response status code by the onResponse hook. */
    [OPLOG_IDS]?: string[];
  }
}

export function getOperator(req: FastifyRequest): { operator: string; operatorId: string | null } {
  // Header may be a string or array; we only honor the first value.
  const h = (name: string): string | null => {
    const v = req.headers[name];
    if (Array.isArray(v)) return v[0] ?? null;
    if (typeof v === 'string') return v;
    return null;
  };
  return {
    operator: h('x-operator') ?? 'anonymous',
    operatorId: h('x-operator-id'),
  };
}

async function insertRow(row: LogRow): Promise<string | null> {
  // Failures here must NOT bubble up — never break a real action because
  // logging failed. Swallow + console.warn. Returns the row id for explicit
  // logs (so the onResponse hook can backfill status_code), or null on error.
  try {
    const id = randomUUID();
    await query(
      `INSERT INTO operation_logs
        (id, operator, operator_id, operation, target_type, target_id, payload,
         request_id, http_method, http_path, status_code, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        row.operator,
        row.operatorId,
        row.operation,
        row.targetType,
        row.targetId ?? null,
        JSON.stringify(row.payload ?? {}),
        row.requestId,
        row.httpMethod,
        row.httpPath,
        row.statusCode,
        row.ip,
        row.userAgent,
      ],
    );
    return id;
  } catch (e: any) {
    console.warn(`[op-log] insert failed: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Record an operation. Handlers should call this *before* sending the response
 * so the row is durable even if the response phase later fails. Marks the
 * request as handled so the catch-all hook skips it.
 *
 * The row is inserted with status_code=null up front; the onResponse hook
 * backfills the actual response code in a single batched UPDATE per request.
 * Cost: 1 INSERT + 1 UPDATE per request regardless of how many explicit logs
 * the handler emits (the UPDATE uses WHERE id = ANY(ids)).
 */
export async function logOperation(req: FastifyRequest, ctx: OperationContext): Promise<void> {
  req[OPLOG_HANDLED] = true;
  const { operator, operatorId } = getOperator(req);
  const id = await insertRow({
    operator,
    operatorId,
    operation: ctx.operation,
    targetType: ctx.targetType,
    targetId: ctx.targetId ?? null,
    payload: ctx.payload ?? {},
    requestId: req.id ?? null,
    httpMethod: req.method ?? null,
    httpPath: req.url ?? null,
    statusCode: null, // backfilled by onResponse hook
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  });
  if (id) {
    if (!req[OPLOG_IDS]) req[OPLOG_IDS] = [];
    req[OPLOG_IDS]!.push(id);
  }
}

/**
 * Map an admin URL we don't recognize to a generic operation name. Used by the
 * catch-all hook so even un-instrumented endpoints leave a footprint.
 */
function deriveGenericOperation(method: string, path: string): { operation: string; targetType: string; targetId: string | null } {
  // Pull the resource segment after /admin/. /admin/sources/abc-123 → segs = ['sources', 'abc-123']
  const segs = path.replace(/^\/+/, '').replace(/\?.*$/, '').split('/').filter(Boolean);
  const adminIdx = segs.indexOf('admin');
  const rest = adminIdx >= 0 ? segs.slice(adminIdx + 1) : segs;
  const resource = rest[0] ?? 'unknown';
  const tail = rest[rest.length - 1] ?? null;
  const looksLikeId =
    tail !== null &&
    tail !== resource &&
    /[a-f0-9-]{8,}/i.test(tail);

  const verb = ({ POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' } as Record<string, string>)[method] ?? method.toLowerCase();
  return {
    operation: `${resource}.${verb}`,
    targetType: resource,
    targetId: looksLikeId ? tail : null,
  };
}

/**
 * Register the catch-all hook on a Fastify instance. Should be called once at
 * startup, before the admin routes are registered.
 *
 * Two responsibilities:
 *   1. Backfill `status_code` on any rows the handler wrote via `logOperation()`
 *      (one batched UPDATE per request).
 *   2. Insert a fallback row for any admin write that didn't log explicitly.
 *
 * We hook `onSend`, NOT `onResponse`. Reason: Fastify's onResponse async hook
 * runs fire-and-forget — `app.inject()` resolves before the hook's awaits
 * complete, which races the audit write against the caller's read. onSend is
 * awaited before the body is actually sent, guaranteeing the row is durable
 * by the time the response lands. Cost: a few ms of extra response latency
 * per admin write — well worth correctness for an audit log.
 */
export function registerOpLogHook(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    // 1) Backfill status_code on explicit logs from this request, if any.
    //    Done first — independent of method/url filters below, since handlers
    //    on any route are free to call logOperation().
    const ids = req[OPLOG_IDS];
    if (ids && ids.length > 0) {
      try {
        await query(
          `UPDATE operation_logs SET status_code = $2 WHERE id = ANY($1::uuid[])`,
          [ids, reply.statusCode],
        );
      } catch (e: any) {
        console.warn(`[op-log] status_code backfill failed: ${e?.message ?? e}`);
      }
    }

    // 2) Catch-all: only admin writes; reads don't change state.
    if (!req.url?.startsWith('/admin/')) return payload;
    const method = req.method ?? '';
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return payload;
    // Skip if a handler already logged. Their explicit row is more meaningful.
    if (req[OPLOG_HANDLED]) return payload;
    // Skip 4xx/5xx for the catch-all path: failed input doesn't represent a
    // state change, and explicit handlers can still log validation failures
    // when they want them recorded.
    if (reply.statusCode >= 400) return payload;

    const derived = deriveGenericOperation(method, req.url);
    const { operator, operatorId } = getOperator(req);
    await insertRow({
      operator,
      operatorId,
      operation: derived.operation,
      targetType: derived.targetType,
      targetId: derived.targetId,
      payload: { auto: true },
      requestId: req.id ?? null,
      httpMethod: method,
      httpPath: req.url,
      statusCode: reply.statusCode,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    return payload;
  });
}

/**
 * Register the query endpoint(s) for the operation log. Read-only.
 */
export async function registerOpLogAdmin(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      operator?: string;
      operation?: string;
      target_type?: string;
      target_id?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>('/admin/op-logs', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 500);
    const offset = Math.max(Number(q.offset ?? 0), 0);

    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, val: unknown) => {
      params.push(val);
      where.push(sql.replace('$?', `$${params.length}`));
    };

    if (q.operator)    add('operator = $?', q.operator);
    if (q.operation)   add('operation = $?', q.operation);
    if (q.target_type) add('target_type = $?', q.target_type);
    if (q.target_id)   add('target_id = $?', q.target_id);
    if (q.from)        add('occurred_at >= $?', q.from);
    if (q.to)          add('occurred_at <= $?', q.to);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Reuse params for COUNT, then add limit/offset only for the data query.
    const [countRow] = await query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM operation_logs ${whereSql}`,
      params,
    );

    params.push(limit);  const limitIdx = params.length;
    params.push(offset); const offsetIdx = params.length;

    const rows = await query(
      `SELECT id, operator, operator_id, occurred_at,
              operation, target_type, target_id, payload,
              request_id, http_method, http_path, status_code, ip, user_agent
       FROM operation_logs
       ${whereSql}
       ORDER BY occurred_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    void reply;
    return { logs: rows, total: countRow?.count ?? 0, limit, offset };
  });

  // Single-target trail: every operation that touched this entity, in order.
  app.get<{ Params: { type: string; id: string } }>(
    '/admin/op-logs/target/:type/:id',
    async (req) => {
      const { type, id } = req.params;
      const rows = await query(
        `SELECT id, operator, operator_id, occurred_at,
                operation, target_type, target_id, payload,
                http_method, http_path, status_code
         FROM operation_logs
         WHERE target_type = $1 AND target_id = $2
         ORDER BY occurred_at DESC
         LIMIT 200`,
        [type, id],
      );
      return { trail: rows };
    },
  );
}
