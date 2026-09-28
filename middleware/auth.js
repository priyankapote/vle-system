const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

function signToken(user) {
  return jwt.sign(
    { id: user.id, profile_type: user.profile_type },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, profile_type }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not logged in." });
    if (!roles.includes(req.user.profile_type)) {
      return res.status(403).json({ error: "You do not have permission to do that." });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
