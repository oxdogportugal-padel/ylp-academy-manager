'use strict';
// Catalyst Data Store implementation of the driver interface.
// Reads go through ZCQL (results unwrapped from their table-name key, paginated
// in 300-row pages); writes go through the table API (insertRows in 200-row batches).
const { TABLES } = require('./schema');

const ZCQL_PAGE = 300;
const INSERT_BATCH = 200;
const ID_RE = /^\d+$/;

function literal(value, type) {
  if (value === null || value === undefined) return 'null';
  if (type === 'int' || type === 'bigint') {
    const s = String(value);
    if (!/^-?\d+$/.test(s)) throw new Error(`Invalid numeric value: ${s}`);
    return s;
  }
  if (type === 'boolean') return value === true || value === 'true' ? 'true' : 'false';
  const str = String(value);
  // Values that reach WHERE clauses are ids, ISO dates, statuses, normalised URLs and
  // validated e-mails. Refuse anything with characters whose ZCQL escaping is ambiguous.
  if (/[\\\u0000-\u001f]/.test(str)) throw new Error('Unsupported character in query value');
  return `'${str.replace(/'/g, "''")}'`;
}

function column(table, field) {
  if (field === 'id') return ['ROWID', 'bigint'];
  const c = TABLES[table].columns[field];
  if (!c) throw new Error(`Unknown field ${table}.${field}`);
  return c;
}

/** Builds a ZCQL WHERE clause from { field: value | {in|lt|lte|gt|gte|ne} | null }. */
function whereClause(table, where = {}) {
  const parts = Object.entries(where).map(([field, cond]) => {
    const [col, type] = column(table, field);
    if (cond === null) return `${col} IS NULL`;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) {
        if (!cond.in.length) return '1 = 0';
        return `${col} IN (${cond.in.map((v) => literal(v, type)).join(', ')})`;
      }
      const ops = { lt: '<', lte: '<=', gt: '>', gte: '>=', ne: '!=' };
      const [op, v] = Object.entries(cond)[0];
      if (!ops[op]) throw new Error(`Unsupported operator ${op}`);
      return `${col} ${ops[op]} ${literal(v, type)}`;
    }
    return `${col} = ${literal(cond, type)}`;
  });
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

function fromRow(table, row) {
  if (!row) return null;
  const out = { id: String(row.ROWID) };
  for (const [field, [col, type, , opts]] of Object.entries(TABLES[table].columns)) {
    let v = row[col];
    if (v === undefined || v === '') v = null;
    if (v !== null) {
      if (type === 'int') v = Number(v);
      else if (type === 'bigint') v = String(v);
      else if (type === 'boolean') v = v === true || v === 'true';
      else if (opts?.json) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
    }
    out[field] = v;
  }
  return out;
}

function toRow(table, obj) {
  const row = {};
  for (const [field, value] of Object.entries(obj)) {
    if (value === undefined || field === 'id') continue;
    const [col, type, , opts] = column(table, field);
    if (value === null) row[col] = null;
    else if (opts?.json) row[col] = JSON.stringify(value);
    else if (type === 'boolean') row[col] = value ? 'true' : 'false';
    else row[col] = value;
  }
  return row;
}

function createCatalystDriver(catalystApp) {
  const zcql = catalystApp.zcql();
  const ds = catalystApp.datastore();
  const name = (t) => TABLES[t].name;

  async function query(sql) {
    return zcql.executeZCQLQuery(sql);
  }

  return {
    query,
    async insert(table, obj) {
      return fromRow(table, await ds.table(name(table)).insertRow(toRow(table, obj)));
    },
    async insertMany(table, objs) {
      const out = [];
      for (let i = 0; i < objs.length; i += INSERT_BATCH) {
        const rows = await ds.table(name(table)).insertRows(objs.slice(i, i + INSERT_BATCH).map((o) => toRow(table, o)));
        out.push(...rows.map((r) => fromRow(table, r)));
      }
      return out;
    },
    async update(table, id, fields) {
      if (!ID_RE.test(String(id))) throw new Error('Invalid id');
      return fromRow(table, await ds.table(name(table)).updateRow({ ROWID: String(id), ...toRow(table, fields) }));
    },
    async get(table, id) {
      if (!ID_RE.test(String(id))) return null;
      const rows = await this.find(table, { id: String(id) }, { limit: 1 });
      return rows[0] || null;
    },
    async find(table, where, { orderBy = [], limit } = {}) {
      const order = orderBy.length ? ` ORDER BY ${orderBy.map(([f, d]) => `${column(table, f)[0]} ${d === 'DESC' ? 'DESC' : 'ASC'}`).join(', ')}` : '';
      const base = `SELECT * FROM ${name(table)}${whereClause(table, where)}${order}`;
      const out = [];
      for (let offset = 0; ; offset += ZCQL_PAGE) {
        const size = limit ? Math.min(ZCQL_PAGE, limit - out.length) : ZCQL_PAGE;
        if (size <= 0) break;
        const rows = (await query(`${base} LIMIT ${offset}, ${size}`)).map((r) => r[name(table)]).filter(Boolean);
        out.push(...rows.map((r) => fromRow(table, r)));
        if (rows.length < size) break;
      }
      return out;
    },
    async count(table, where) {
      const res = await query(`SELECT COUNT(ROWID) FROM ${name(table)}${whereClause(table, where)}`);
      const first = res[0] && Object.values(res[0])[0];
      return first ? Number(Object.values(first)[0]) || 0 : 0;
    },
    async remove(table, where) {
      if (!Object.keys(where || {}).length) throw new Error('Refusing to delete without a WHERE clause');
      await query(`DELETE FROM ${name(table)}${whereClause(table, where)}`);
    },
  };
}

module.exports = { createCatalystDriver, whereClause, literal, fromRow, toRow };
