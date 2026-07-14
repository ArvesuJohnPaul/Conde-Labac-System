// Create or reset a staff (app_user) login from the command line.
// Usage (run inside the server/ folder):
//   node create-staff.js <username/email> <password> [role] [display name]
// Examples:
//   node create-staff.js admin@condelabac.gov.ph S3cret123 Admin "System Administrator"
//   node create-staff.js maria@condelabac.gov.ph pass1234 Officer "Reyes, Maria R."
const crypto = require("crypto");
const { pool, query } = require("./db");

async function main() {
  const [username, password, role = "Officer", displayName] = process.argv.slice(2);
  if (!username || !password) {
    console.log("Usage: node create-staff.js <username/email> <password> [role] [display name]");
    process.exit(1);
  }
  if (!["Admin", "Officer", "Staff", "Viewer"].includes(role)) {
    console.log("Role must be one of: Admin, Officer, Staff, Viewer");
    process.exit(1);
  }
  if (password.length < 8) {
    console.log("Password must be at least 8 characters.");
    process.exit(1);
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const { rows } = await query(
    `INSERT INTO app_user (username, display_name, role, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role          = EXCLUDED.role,
           display_name  = COALESCE($2, app_user.display_name)
     RETURNING user_id, username, role`,
    [username.toLowerCase(), displayName || username, role, salt + ":" + hash]
  );
  console.log("Saved staff login:", rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
