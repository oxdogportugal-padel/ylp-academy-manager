'use strict';
// In-memory implementation of the driver interface (tests + local dev server).
const { TABLES } = require('./schema');

function matches(row, where = {}) {
  return Object.entries(where).every(([field, cond]) => {
    const v = row[field];
    if (cond === null) return v === null || v === undefined;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return cond.in.map(String).includes(String(v));
      if ('lt' in cond) return v !== null && v !== undefined && v < cond.lt;
      if ('lte' in cond) return v !== null && v !== undefined && v <= cond.lte;
      if ('gt' in cond) return v !== null && v !== undefined && v > cond.gt;
      if ('gte' in cond) return v !== null && v !== undefined && v >= cond.gte;
      if ('ne' in cond) return String(v) !== String(cond.ne);
    }
    return String(v) === String(cond);
  });
}

function createMemoryDriver() {
  const data = Object.fromEntries(Object.keys(TABLES).map((t) => [t, []]));
  let seq = 4000000000000000;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fill = (table, obj) => {
    const out = {};
    for (const f of Object.keys(TABLES[table].columns)) out[f] = obj[f] === undefined ? null : obj[f];
    return out;
  };

  return {
    data,
    async insert(table, obj) {
      seq += 1;
      const row = { id: String(seq), ...fill(table, obj) };
      data[table].push(row);
      return clone(row);
    },
    async insertMany(table, objs) { const out = []; for (const o of objs) out.push(await this.insert(table, o)); return out; },
    async update(table, id, fields) {
      const row = data[table].find((r) => r.id === String(id));
      if (!row) throw new Error(`${table} ${id} not found`);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && k in TABLES[table].columns) row[k] = v;
      return clone(row);
    },
    async get(table, id) { const r = data[table].find((x) => x.id === String(id)); return r ? clone(r) : null; },
    async find(table, where, { orderBy = [], limit } = {}) {
      let rows = data[table].filter((r) => matches(r, where));
      if (orderBy.length) {
        rows = rows.sort((a, b) => {
          for (const [f, dir] of orderBy) {
            const av = f === 'id' ? BigInt(a.id) : a[f];
            const bv = f === 'id' ? BigInt(b.id) : b[f];
            if (av === bv) continue;
            const c = av === null ? -1 : bv === null ? 1 : av < bv ? -1 : 1;
            return dir === 'DESC' ? -c : c;
          }
          return 0;
        });
      }
      if (limit) rows = rows.slice(0, limit);
      return rows.map(clone);
    },
    async count(table, where) { return data[table].filter((r) => matches(r, where)).length; },
    async remove(table, where) {
      const keep = data[table].filter((r) => !matches(r, where));
      const removed = data[table].length - keep.length;
      data[table] = keep;
      return removed;
    },
  };
}

module.exports = { createMemoryDriver };
