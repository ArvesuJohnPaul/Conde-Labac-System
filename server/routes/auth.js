// /api/auth — real login against the database.
// One endpoint answers "who are you?" by WHICH table the credentials match:
//   app_user          → staff  (role column decides Admin/Officer/Staff/Viewer)
//   resident_account  → resident (being in the table IS the role)
const express = require("express");
const crypto = require("crypto");
const { query } = require("../db");
const router = express.Router();

// Counterpart of hashPassword in residents.js ("salt:hash" scrypt, hex).
// timingSafeEqual avoids leaking how much of the hash matched.
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/auth/login   Body: { username, password }
// username is the staff username OR the resident's account email.
router.post("/login", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.username || !b.password)
      return res
        .status(400)
        .json({ error: "Username/email and password are required." });
    const u = b.username.trim().toLowerCase();

    // 1) Staff first — an admin's row wins over a resident account that
    //    happens to share the same email.
    const staff = await query(
      `SELECT user_id, username, display_name, role, password_hash
         FROM app_user
        WHERE lower(username) = $1`,
      [u]
    );
    if (staff.rows.length && verifyPassword(b.password, staff.rows[0].password_hash)) {
      const s = staff.rows[0];
      return res.json({
        kind: "staff",
        role: s.role,
        name: s.display_name,
        user_id: s.user_id,
        username: s.username,
      });
    }

    // 2) Resident account (email login).
    const resident = await query(
      `SELECT ra.resident_id, ra.email, ra.password_hash,
              trim(r.last_name || ', ' || r.first_name ||
                   COALESCE(' ' || left(r.middle_name, 1) || '.', '')) AS name
         FROM resident_account ra
         JOIN resident r ON r.resident_id = ra.resident_id
        WHERE lower(ra.email) = $1
          AND r.status = 'active'`,
      [u]
    );
    if (resident.rows.length && verifyPassword(b.password, resident.rows[0].password_hash)) {
      const rr = resident.rows[0];
      return res.json({
        kind: "resident",
        role: "Resident",
        name: rr.name,
        resident_id: rr.resident_id,
        username: rr.email,
      });
    }

    // Same message for "no such user" and "wrong password" — don't reveal
    // which emails exist.
    res.status(401).json({ error: "Invalid email/username or password." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
