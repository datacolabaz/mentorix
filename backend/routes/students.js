// ============================================================
// students.js
// ============================================================
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/students — list (admin or instructor)
router.get('/', authenticate, async (req, res) => {
    const { rows } = await db.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url,
               sp.parent_id, sp.grade, pu.full_name AS parent_name
        FROM users u
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        LEFT JOIN users pu ON pu.id = sp.parent_id
        WHERE u.role = 'student' AND u.is_active = TRUE
        ORDER BY u.full_name
    `);
    res.json({ success: true, students: rows });
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
    const { rows } = await db.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.created_at,
               sp.parent_id, sp.grade, sp.date_of_birth, sp.notes,
               pu.full_name AS parent_name, pu.phone AS parent_phone
        FROM users u
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        LEFT JOIN users pu ON pu.id = sp.parent_id
        WHERE u.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, student: rows[0] });
});

module.exports = router;
