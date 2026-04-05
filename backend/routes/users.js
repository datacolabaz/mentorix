const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/users — Admin only
router.get('/', authenticate, authorize('admin'), async (req, res) => {
    const { role } = req.query;
    let query = `SELECT u.id, u.full_name, u.email, u.role, u.phone, u.is_active, u.created_at,
                        ip.subject, ip.billing_type, ip.testing_enabled, ip.online_payment_enabled
                 FROM users u LEFT JOIN instructor_profiles ip ON ip.user_id = u.id`;
    const params = [];
    if (role) { query += ` WHERE u.role = $1`; params.push(role); }
    query += ` ORDER BY u.created_at DESC`;
    const { rows } = await db.query(query, params);
    res.json({ success: true, users: rows });
});

// PUT /api/users/:id/toggle-active
router.put('/:id/toggle-active', authenticate, authorize('admin'), async (req, res) => {
    const { rows } = await db.query(
        `UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING is_active`,
        [req.params.id]
    );
    res.json({ success: true, is_active: rows[0].is_active });
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    await db.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'User deactivated' });
});

module.exports = router;

// POST - yeni istifadeci elave et
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { full_name, email, phone, role, student_limit, password } = req.body;
  try {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password || 'Pass@123', 10);
    const result = await req.db.query(
      `INSERT INTO users (full_name, email, phone, role, student_limit, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, full_name, email, role`,
      [full_name, email, phone, role || 'instructor', student_limit || 10, hash]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// PATCH - istifadecini yenile
router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { is_active } = req.body;
  try {
    await req.db.query('UPDATE users SET is_active=$1 WHERE id=$2', [is_active, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});
