const crypto = require("crypto");
const { one } = require("./db");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

async function authenticate(username, password) {
  const admin = await one(
    `SELECT a.id,
            a.username,
            a.password_hash,
            a.display_name,
            a.role,
            a.server_slot_id,
            a.is_active,
            s.display_name AS server_name
     FROM admins a
     LEFT JOIN server_slots s ON s.id = a.server_slot_id
     WHERE a.username = ?`,
    [username],
  );
  if (!admin) return null;
  if (!admin.is_active) return null;
  if (admin.password_hash !== hashPassword(password)) return null;
  const role = admin.role === "bqt" ? "bqt" : "admin";
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.display_name || admin.username,
    role,
    serverSlotId: admin.server_slot_id || null,
    serverName: admin.server_name || "",
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

module.exports = { authenticate, requireAuth, hashPassword };
