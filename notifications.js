const express = require("express");
const { read, transact } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/notifications - mine, newest first
router.get("/", requireAuth, (req, res) => {
  const db = read();
  const mine = (db.notifications || [])
    .filter((n) => n.user_id === req.user.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json(mine);
});

// GET /api/notifications/summary - cheap check used by the dashboard to notice new activity
router.get("/summary", requireAuth, (req, res) => {
  const mine = (read().notifications || []).filter((n) => n.user_id === req.user.id);
  res.json({ unread: mine.filter((n) => !n.read).length, latest_id: mine.length ? mine[mine.length - 1].id : null });
});

// PUT /api/notifications/:id/read
router.put("/:id/read", requireAuth, (req, res) => {
  const updated = transact((db) => {
    const n = (db.notifications || []).find((x) => x.id === req.params.id && x.user_id === req.user.id);
    if (!n) throw { status: 404, message: "Notification not found." };
    n.read = true;
    return n;
  });
  res.json(updated);
});

// PUT /api/notifications/read-all
router.put("/read-all", requireAuth, (req, res) => {
  transact((db) => {
    (db.notifications || []).forEach((n) => {
      if (n.user_id === req.user.id) n.read = true;
    });
  });
  res.json({ success: true });
});

module.exports = router;
