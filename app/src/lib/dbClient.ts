import { getIdToken } from './cognitoAuth'
import { apiUrl } from './urlConfig'

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'is_not' | 'like' | 'ilike'

interface Filter {
  column: string
  op: FilterOp
  value: any
}

interface OrderSpec {
  column: string
  ascending?: boolean
  nullsFirst?: boolean
}

interface RequestPayload {
  table: string
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  filters?: Filter[]
  data?: any
  columns?: string
  order?: OrderSpec[]
  limit?: number
  offset?: number
  onConflict?: string
  count?: boolean
  single?: boolean
  maybeSingle?: boolean
}

interface DbResponse<T = any> {
  data: T
  error: { message: string; code?: string } | null
  count?: number
}

async function getAccessToken(): Promise<string> {
  try {
    return await getIdToken()
  } catch {
    return ''
  }
}

const READ_TIMEOUT_MS = 20_000
const WRITE_TIMEOUT_MS = 45_000

function timeoutForPayload(payload: RequestPayload): number {
  return payload.operation === 'select' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS
}

async function sendRequestOnce<T = any>(payload: RequestPayload): Promise<DbResponse<T>> {
  try {
    const token = await getAccessToken()
    const url = apiUrl('/api/db')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutForPayload(payload))
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      return { data: null as any, error: { message: body?.error?.message || `HTTP ${resp.status}`, code: body?.error?.code } }
    }

    return await resp.json()
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || 'Network error')
    return { data: null as any, error: { message: msg } }
  }
}

async function sendRequest<T = any>(payload: RequestPayload): Promise<DbResponse<T>> {
  const result = await sendRequestOnce<T>(payload)

  if (payload.operation !== 'select' && result.error) {
    const msg = result.error.message || ''
    if (msg === 'Request timed out' || msg.includes('504') || msg.includes('502')) {
      // Pre-warm before retry — the container likely died
      await fetch(apiUrl('/api/ping')).catch(() => {})
      await new Promise(r => setTimeout(r, 500))
      return await sendRequestOnce<T>(payload)
    }
  }

  return result
}

class QueryBuilder {
  private _payload: RequestPayload

  constructor(table: string, operation: RequestPayload['operation']) {
    this._payload = { table, operation, filters: [], order: [] }
  }

  select(columns?: string) {
    // Only set operation to 'select' if no write operation is already pending.
    // PostgREST pattern: .upsert({}).select() means "upsert and return columns",
    // not "switch to a select". Same for insert/update/delete + .select().
    if (!['insert', 'upsert', 'update', 'delete'].includes(this._payload.operation)) {
      this._payload.operation = 'select'
    }
    if (columns) this._payload.columns = columns
    return this
  }

  insert(data: any, options?: { onConflict?: string }) {
    this._payload.operation = 'insert'
    this._payload.data = data
    if (options?.onConflict) this._payload.onConflict = options.onConflict
    return this
  }

  update(data: any) {
    this._payload.operation = 'update'
    this._payload.data = data
    return this
  }

  upsert(data: any, options?: { onConflict?: string }) {
    this._payload.operation = 'upsert'
    this._payload.data = data
    if (options?.onConflict) this._payload.onConflict = options.onConflict
    return this
  }

  delete() {
    this._payload.operation = 'delete'
    return this
  }

  eq(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'neq', value })
    return this
  }

  gt(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'gt', value })
    return this
  }

  gte(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'gte', value })
    return this
  }

  lt(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'lt', value })
    return this
  }

  lte(column: string, value: any) {
    this._payload.filters!.push({ column, op: 'lte', value })
    return this
  }

  in(column: string, values: any[]) {
    this._payload.filters!.push({ column, op: 'in', value: values })
    return this
  }

  is(column: string, value: null | boolean) {
    this._payload.filters!.push({ column, op: value === null ? 'is' : 'eq', value })
    return this
  }

  not(column: string, op: string, value: any) {
    if (op === 'is' && value === null) {
      this._payload.filters!.push({ column, op: 'is_not', value: null })
    } else {
      const negated = op === 'eq' ? 'neq' : op === 'in' ? 'neq' : ('neq' as FilterOp)
      this._payload.filters!.push({ column, op: negated, value })
    }
    return this
  }

  like(column: string, pattern: string) {
    this._payload.filters!.push({ column, op: 'like', value: pattern })
    return this
  }

  ilike(column: string, pattern: string) {
    this._payload.filters!.push({ column, op: 'ilike', value: pattern })
    return this
  }

  or(_expression: string) {
    console.warn('[dbClient] .or() is not supported by the CRUD proxy — this filter will be ignored. Restructure the query to use separate requests.')
    return this
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this._payload.order!.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    })
    return this
  }

  limit(count: number) {
    this._payload.limit = count
    return this
  }

  range(from: number, to: number) {
    this._payload.offset = from
    this._payload.limit = to - from + 1
    return this
  }

  single() {
    this._payload.single = true
    return this
  }

  maybeSingle() {
    this._payload.maybeSingle = true
    return this
  }

  then<TResult1 = DbResponse, TResult2 = never>(
    onfulfilled?: ((value: DbResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return sendRequest(this._payload).then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<DbResponse | TResult> {
    return this.then(undefined, onrejected)
  }
}

function from(table: string) {
  return new QueryBuilder(table, 'select')
}

async function rpc(fnName: string, params?: Record<string, any>): Promise<DbResponse> {
  if (fnName === 'save_weekly_plan_atomic') {
    try {
      const token = await getAccessToken()
      const url = apiUrl('/api/rpc/weekly-plan')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS)
      let resp: Response
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(params ?? {}),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        return { data: null, error: { message: body?.error?.message || `HTTP ${resp.status}` } }
      }
      return await resp.json()
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || 'Network error')
      return { data: null, error: { message: msg } }
    }
  }

  return { data: null, error: { message: `Unknown RPC function: ${fnName}` } }
}

export const db = { from, rpc }
