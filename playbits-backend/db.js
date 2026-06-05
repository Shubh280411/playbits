const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => console.error("[DB] Pool error:", err.message));

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

async function get(table, id, idField = "id") {
  const sanitized = table.replace(/[^a-zA-Z0-9_]/g, "");
  const res = await query(`SELECT * FROM "${sanitized}" WHERE "${idField}" = $1`, [String(id)]);
  return res.rows.length ? res.rows[0] : null;
}

async function patch(table, id, updates, idField = "id") {
  const sanitized = table.replace(/[^a-zA-Z0-9_]/g, "");
  const keys = Object.keys(updates);
  if (!keys.length) return true;
  const setClauses = keys.map((k, i) => `"${k}" = $${i + 2}`);
  const values = keys.map(k => updates[k]);
  const sql = `UPDATE "${sanitized}" SET ${setClauses.join(", ")} WHERE "${idField}" = $1`;
  await query(sql, [String(id), ...values]);
  return true;
}

async function insert(table, id, data, idField = "id") {
  const sanitized = table.replace(/[^a-zA-Z0-9_]/g, "");
  data[idField] = id;
  const keys = Object.keys(data);
  const cols = keys.map(k => `"${k}"`);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map(k => data[k]);
  const sql = `INSERT INTO "${sanitized}" (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT ("${idField}") DO UPDATE SET ${keys.map((k, i) => `"${k}" = EXCLUDED."${k}"`).join(", ")}`;
  await query(sql, values);
  return true;
}

async function insertMany(table, items, idField = "id") {
  if (!items.length) return;
  const sanitized = table.replace(/[^a-zA-Z0-9_]/g, "");
  const allKeys = [...new Set(items.flatMap(Object.keys))];
  if (!allKeys.includes(idField)) allKeys.unshift(idField);
  const placeholders = items.map((_, i) => `(${allKeys.map((_, j) => `$${i * allKeys.length + j + 1}`).join(", ")})`);
  const values = items.flatMap(item => allKeys.map(k => item[k] ?? null));
  const cols = allKeys.map(k => `"${k}"`);
  const conflictCol = `"${idField}"`;
  const updateClauses = allKeys.filter(k => k !== idField).map(k => `"${k}" = EXCLUDED."${k}"`);
  const chunks = [];
  const chunkSize = 100;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunkPlaceholders = placeholders.slice(i, i + chunkSize);
    const chunkValues = values.slice(i * allKeys.length, (i + chunkSize) * allKeys.length);
    chunks.push({ sql: `INSERT INTO "${sanitized}" (${cols.join(", ")}) VALUES ${chunkPlaceholders.join(", ")} ON CONFLICT (${conflictCol}) DO UPDATE SET ${updateClauses.join(", ")}`, values: chunkValues });
  }
  for (const chunk of chunks) {
    await query(chunk.sql, chunk.values);
  }
  return true;
}

async function runQuery(filters) {
  const { table, where, limit, orderBy } = filters;
  const sanitized = table.replace(/[^a-zA-Z0-9_]/g, "");
  let sql = `SELECT * FROM "${sanitized}"`;
  const values = [];
  const clauses = [];

  if (where) {
    for (const [key, val] of Object.entries(where)) {
      const op = val.op || "=";
      values.push(val.value !== undefined ? val.value : val);
      if (op === "EQUAL") clauses.push(`"${key}" = $${values.length}`);
      else if (op === "GREATER_THAN_OR_EQUAL") clauses.push(`"${key}" >= $${values.length}`);
      else if (op === "LESS_THAN_OR_EQUAL") clauses.push(`"${key}" <= $${values.length}`);
      else if (op === "IN") {
        const inVals = Array.isArray(val.value) ? val.value : [val.value];
        const inPlaceholders = inVals.map((v, i) => {
          values.push(v);
          return `$${values.length - inVals.length + i + 1}`;
        });
        clauses.push(`"${key}" IN (${inPlaceholders.join(", ")})`);
      } else clauses.push(`"${key}" $${values.length}::TEXT`);
    }
  }

  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  if (orderBy) sql += ` ORDER BY "${orderBy.field}" ${orderBy.direction || "ASC"}`;
  if (limit) sql += ` LIMIT ${Math.min(limit, 500)}`;

  const res = await query(sql, values);
  return res.rows;
}

module.exports = { pool, query, get, patch, insert, insertMany, runQuery };
