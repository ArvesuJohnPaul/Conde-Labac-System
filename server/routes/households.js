// /api/households — the geotagged unit that ties residents to a building/purok.
const express = require("express");
const { query } = require("../db");
const router = express.Router();

// GET /api/households  → list with purok name + member count.
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT h.household_id, h.household_no, h.address_text,
              p.name AS purok, h.building_id, h.status,
              (SELECT count(*) FROM resident r
                WHERE r.household_id = h.household_id
                  AND r.status = 'active') AS members
         FROM household h
         LEFT JOIN purok p ON p.purok_id = h.purok_id
        WHERE h.status = 'active'
        ORDER BY h.household_no`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/households  → create.
// Body: { household_no?, purok_id?, building_id?, address_text? }
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows } = await query(
      `INSERT INTO household (household_no, purok_id, building_id, address_text)
       VALUES ($1,$2,$3,$4)
       RETURNING household_id`,
      [b.household_no || null, b.purok_id || null, b.building_id || null, b.address_text || null]
    );
    res.status(201).json({ id: rows[0].household_id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
