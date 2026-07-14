// /api/residents — resident records (backed by the resident + resident_view).
const express = require("express");
const crypto = require("crypto");
const { pool, query } = require("../db");
const router = express.Router();

// scrypt password hashing (built into Node — no extra dependency).
// Stored as "salt:hash" hex; verify by re-deriving with the stored salt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

// GET /api/residents  → list (uses the view so age is derived, purok joined).
// The shape matches what residency.js already renders: name / age / purok /
// cat / status.
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT resident_id, full_name, age, purok, status, account_claimed,
              classifications
         FROM resident_view
        WHERE status <> 'archived'
        ORDER BY full_name`
    );
    res.json(
      rows.map((r) => ({
        id: r.resident_id,
        name: r.full_name,
        age: r.age,
        purok: r.purok,
        cat: (r.classifications && r.classifications[0]) || "",
        cats: r.classifications || [],
        // Lifecycle state (active/deceased/moved) — kept for reference.
        lifecycle: r.status,
        // Account-claimed flag → what the UI's "Status" column shows.
        claimed: r.account_claimed,
        status: r.account_claimed ? "Active" : "Unclaimed",
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/residents  → create one resident.
// Body: { last_name, first_name, middle_name?, birthdate?, sex?,
//         household_id?, classifications?: string[] }
router.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.last_name || !b.first_name) {
      return res
        .status(400)
        .json({ error: "last_name and first_name are required" });
    }
    await client.query("BEGIN");
    // NOTE: no account fields here — a new resident starts unclaimed by
    // construction, since "claimed" means a resident_account row exists and
    // only POST /claim (the resident's own action) can create one.
    const { rows } = await client.query(
      `INSERT INTO resident
         (household_id, last_name, first_name, middle_name, suffix, birthdate,
          sex, civil_status, relationship_to_head, contact_no, occupation,
          voter_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING resident_id`,
      [
        b.household_id || null,
        b.last_name,
        b.first_name,
        b.middle_name || null,
        b.suffix || null,
        b.birthdate || null,
        b.sex || null,
        b.civil_status || null,
        b.relationship_to_head || null,
        b.contact_no || null,
        b.occupation || null,
        b.voter_status || null,
      ]
    );
    const id = rows[0].resident_id;

    for (const c of b.classifications || []) {
      await client.query(
        `INSERT INTO resident_classification (resident_id, classification)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, c]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// ── Account claiming ─────────────────────────────────────────────────────────
// Two-phase: /claim/verify finds + checks the record (no change), /claim flips
// account_claimed. Matching = name (case-insensitive) + birthdate when the
// stored record has one — name alone isn't enough to take over an account.
async function findClaimTarget(b) {
  const { rows } = await query(
    `SELECT r.resident_id,
            EXISTS (SELECT 1 FROM resident_account a
                     WHERE a.resident_id = r.resident_id) AS account_claimed,
            to_char(r.birthdate, 'YYYY-MM-DD') AS birthdate,
            trim(r.last_name || ', ' || r.first_name ||
                 COALESCE(' ' || left(r.middle_name, 1) || '.', '')) AS full_name,
            p.name AS purok, h.household_no
       FROM resident r
       LEFT JOIN household h ON h.household_id = r.household_id
       LEFT JOIN purok     p ON p.purok_id    = h.purok_id
      WHERE lower(r.last_name)  = lower($1)
        AND lower(r.first_name) = lower($2)
        AND r.status = 'active'
      ORDER BY r.resident_id`,
    [b.last_name.trim(), b.first_name.trim()]
  );
  if (!rows.length)
    return {
      status: 404,
      error:
        "No matching resident record found. Please visit the barangay office to register first.",
    };
  // Prefer an exact birthdate match; reject when every candidate has a
  // birthdate on file and none of them matches what was entered.
  let row = rows[0];
  if (b.birthdate) {
    const exact = rows.find((r) => r.birthdate === b.birthdate);
    if (exact) row = exact;
    else if (rows.every((r) => r.birthdate))
      return {
        status: 404,
        error:
          "A record with that name exists, but the date of birth does not match.",
      };
    else row = rows.find((r) => !r.birthdate);
  } else if (rows.every((r) => r.birthdate)) {
    return {
      status: 400,
      error: "Please enter your date of birth so we can verify your identity.",
    };
  }
  if (row.account_claimed)
    return { status: 409, error: "This account has already been claimed." };
  return { row };
}

// POST /api/residents/claim/verify  → step 1 of claiming: look up the record
// and confirm it's claimable, WITHOUT changing anything.
// Body: { first_name, last_name, birthdate? (YYYY-MM-DD) }
router.post("/claim/verify", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name) {
      return res
        .status(400)
        .json({ error: "first_name and last_name are required" });
    }
    const found = await findClaimTarget(b);
    if (found.error)
      return res.status(found.status).json({ error: found.error });
    res.json({
      id: found.row.resident_id,
      name: found.row.full_name,
      purok: found.row.purok,
      household_no: found.row.household_no,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/residents/claim  → step 2: create the resident_account row. Its
// existence IS the "claimed/Active" state — no flag to flip.
// Body: { resident_id (from /claim/verify) OR first_name+last_name+birthdate,
//         email, password, mobile_no? }
router.post("/claim", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.email || !/^\S+@\S+\.\S+$/.test(b.email))
      return res.status(400).json({ error: "A valid email is required." });
    if (!b.password || b.password.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });

    let id = null;
    if (b.resident_id) {
      // Re-check server-side — never trust that verify was actually called.
      const { rows } = await query(
        `SELECT r.resident_id,
                EXISTS (SELECT 1 FROM resident_account a
                         WHERE a.resident_id = r.resident_id) AS account_claimed
           FROM resident r
          WHERE r.resident_id = $1 AND r.status = 'active'`,
        [b.resident_id]
      );
      if (!rows.length)
        return res.status(404).json({ error: "Resident record not found." });
      if (rows[0].account_claimed)
        return res
          .status(409)
          .json({ error: "This account has already been claimed." });
      id = rows[0].resident_id;
    } else {
      if (!b.first_name || !b.last_name) {
        return res
          .status(400)
          .json({ error: "first_name and last_name are required" });
      }
      const found = await findClaimTarget(b);
      if (found.error)
        return res.status(found.status).json({ error: found.error });
      id = found.row.resident_id;
    }

    try {
      await query(
        `INSERT INTO resident_account (resident_id, email, mobile_no, password_hash)
         VALUES ($1, $2, $3, $4)`,
        [id, b.email.trim().toLowerCase(), b.mobile_no || null, hashPassword(b.password)]
      );
    } catch (err) {
      if (err.code === "23505") {
        // unique violation — either the resident or the email is already taken
        const dupEmail = /email/.test(err.constraint || "");
        return res.status(409).json({
          error: dupEmail
            ? "That email address is already used by another account."
            : "This account has already been claimed.",
        });
      }
      throw err;
    }
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// GET /api/residents/:id  → full profile for the View modal: every resident
// column + derived age, household/purok, classifications.
router.get("/:id", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id))
      return res.status(400).json({ error: "invalid id" });
    const { rows } = await query(
      `SELECT r.resident_id, r.last_name, r.first_name, r.middle_name, r.suffix,
              to_char(r.birthdate, 'YYYY-MM-DD') AS birthdate,
              CASE WHEN r.birthdate IS NULL THEN NULL
                   ELSE date_part('year', age(r.birthdate))::int END AS age,
              r.sex, r.civil_status, r.relationship_to_head, r.contact_no,
              r.occupation, r.voter_status, r.status,
              EXISTS (SELECT 1 FROM resident_account a
                       WHERE a.resident_id = r.resident_id) AS account_claimed,
              to_char(r.date_registered, 'YYYY-MM-DD') AS date_registered,
              r.household_id, h.household_no, h.address_text, p.name AS purok,
              COALESCE(
                (SELECT array_agg(rc.classification)
                   FROM resident_classification rc
                  WHERE rc.resident_id = r.resident_id), '{}') AS classifications
         FROM resident r
         LEFT JOIN household h ON h.household_id = r.household_id
         LEFT JOIN purok     p ON p.purok_id    = h.purok_id
        WHERE r.resident_id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/residents/:id  → update any of the resident's fields; when
// `classifications` is an array it replaces the resident's classification set.
// COALESCE semantics: omitted/empty fields keep their current value.
router.put("/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE resident SET
         last_name    = COALESCE($2,  last_name),
         first_name   = COALESCE($3,  first_name),
         middle_name  = COALESCE($4,  middle_name),
         suffix       = COALESCE($5,  suffix),
         birthdate    = COALESCE($6,  birthdate),
         sex          = COALESCE($7,  sex),
         civil_status = COALESCE($8,  civil_status),
         relationship_to_head = COALESCE($9, relationship_to_head),
         contact_no   = COALESCE($10, contact_no),
         occupation   = COALESCE($11, occupation),
         voter_status = COALESCE($12, voter_status),
         status       = COALESCE($13, status),
         household_id = COALESCE($14, household_id)
       WHERE resident_id = $1`,
      [
        req.params.id,
        b.last_name || null,
        b.first_name || null,
        b.middle_name || null,
        b.suffix || null,
        b.birthdate || null,
        b.sex || null,
        b.civil_status || null,
        b.relationship_to_head || null,
        b.contact_no || null,
        b.occupation || null,
        b.voter_status || null,
        b.status || null,
        b.household_id || null,
      ]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not found" });
    }
    if (Array.isArray(b.classifications)) {
      await client.query(
        `DELETE FROM resident_classification WHERE resident_id = $1`,
        [req.params.id]
      );
      for (const c of b.classifications) {
        await client.query(
          `INSERT INTO resident_classification (resident_id, classification)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.id, c]
        );
      }
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/residents/:id  → soft-delete (archive), never hard delete records.
router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE resident SET status = 'archived' WHERE resident_id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
