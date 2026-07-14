// ============================================================================
//  Conde Labac Barangay MIS — API server
//  Serves JSON endpoints AND the existing static site, so you run ONE thing.
//    npm install       (once)
//    npm start         (start it; open http://localhost:3000)
// ============================================================================
const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { pool } = require("./db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" })); // GeoJSON payloads can be chunky

// ── API routes ──────────────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/residents", require("./routes/residents"));
app.use("/api/households", require("./routes/households"));
app.use("/api/gis", require("./routes/gis"));

// Health check — hit http://localhost:3000/api/health to confirm the DB is up.
app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT postgis_version() AS postgis");
    res.json({ ok: true, postgis: rows[0].postgis });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Serve the existing static site ───────────────────────────────────────────
// The project root is one level up from /server. This lets the same origin
// serve index.html AND /api/*, so the frontend's fetch() calls need no host.
const SITE_ROOT = path.join(__dirname, "..");
app.use(express.static(SITE_ROOT));

// ── Central error handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Conde Labac MIS server running → http://localhost:${PORT}`);
});
