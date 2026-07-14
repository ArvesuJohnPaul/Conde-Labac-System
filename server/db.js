// One shared connection pool for the whole app. Reads PG* vars from .env.
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

// Thin helper so routes can just `const { rows } = await query(sql, params)`.
// Always use parameterized queries ($1, $2 …) — never string-concatenate user
// input into SQL (that's how SQL injection happens).
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
