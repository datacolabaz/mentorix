// notifications.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const notifService = require('../utils/notificationService');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
    const { rows } = await db.query(
        `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.user.id]
    );
    const unread = await notifService.getUnreadCount(req.user.id);
    res.json({ success: true, notifications: rows, unread });
});

router.put('/:id/read', authenticate, async (req, res) => {
    await db.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ success: true });
});

router.put('/read-all', authenticate, async (req, res) => {
    await notifService.markAllRead(req.user.id);
    res.json({ success: true });
});

module.exports = router;
