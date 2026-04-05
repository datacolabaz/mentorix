const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const instrId = req.user.role === 'instructor' ? req.user.id : null;
    const { rows } = await db.query(`
      SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url,
             sp.parent_id, sp.grade, pu.full_name AS parent_name,
             e.id AS enrollment_id, e.billing_type, e.lesson_count,
             e.status AS enrollment_status, e.referral_notes AS referral_source,
             e.instructor_id,
             iu.full_name AS instructor_name,
             ROUND(AVG(a.session_score)) AS avg_score
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN users pu ON pu.id = sp.parent_id
      LEFT JOIN enrollments e ON e.student_id = u.id
      LEFT JOIN users iu ON iu.id = e.instructor_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.attended = TRUE
      WHERE u.role = 'student' AND u.is_active = TRUE
        ${instrId ? "AND e.instructor_id = '" + instrId + "'" : ''}
      GROUP BY u.id, sp.parent_id, sp.grade, pu.full_name,
               e.id, e.billing_type, e.lesson_count, e.status,
               e.referral_notes, e.instructor_id, iu.full_name
      ORDER BY u.full_name
    `);
    res.json({ success: true, students: rows });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.created_at,
             sp.parent_id, sp.grade, sp.date_of_birth, sp.notes,
             pu.full_name AS parent_name, pu.phone AS parent_phone,
             e.id AS enrollment_id, e.billing_type, e.lesson_count, e.status AS enrollment_status,
             e.instructor_id, iu.full_name AS instructor_name
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN users pu ON pu.id = sp.parent_id
      LEFT JOIN enrollments e ON e.student_id = u.id
      LEFT JOIN users iu ON iu.id = e.instructor_id
      WHERE u.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, student: rows[0] });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
