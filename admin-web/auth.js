const crypto = require("crypto");
const { one } = require("./db");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

async function authenticate(username, password) {
  const admin = await one("SELECT id, username, password_hash FROM admins WHERE username = ?", [username]);
  if (!admin) return null;
  if (admin.password_hash !== hashPassword(password)) return null;
  return { id: admin.id, username: admin.username };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

module.exports = { authenticate, requireAuth, hashPassword };
