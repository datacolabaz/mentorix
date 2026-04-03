const db = require('../db');
const bcrypt = require('bcryptjs');

// GET /api/instructors — Admin: all instructors
exports.getAll = async (req, res) => {
    const { rows } = await db.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at,
               ip.subject, ip.billing_type, ip.alert_lessons_before,
               ip.testing_enabled, ip.online_payment_enabled,
               COUNT(DISTINCT e.id) AS student_count
        FROM users u
        JOIN instructor_profiles ip ON ip.user_id = u.id
        LEFT JOIN enrollments e ON e.instructor_id = u.id AND e.status = 'active'
        WHERE u.role = 'instructor'
        GROUP BY u.id, ip.subject, ip.billing_type, ip.alert_lessons_before,
                 ip.testing_enabled, ip.online_payment_enabled
        ORDER BY u.created_at DESC
    `);
    res.json({ success: true, instructors: rows });
};

// GET /api/instructors/:id
exports.getOne = async (req, res) => {
    const { rows } = await db.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.avatar_url,
               ip.subject, ip.billing_type, ip.alert_lessons_before,
               ip.testing_enabled, ip.online_payment_enabled, ip.bio
        FROM users u
        JOIN instructor_profiles ip ON ip.user_id = u.id
        WHERE u.id = $1 AND u.role = 'instructor'
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Instructor not found' });
    res.json({ success: true, instructor: rows[0] });
};

// PUT /api/instructors/:id — Update instructor profile
exports.update = async (req, res) => {
    const { billing_type, alert_lessons_before, testing_enabled,
            online_payment_enabled, subject, bio, phone } = req.body;
    const targetId = req.params.id;

    // Only admin or self can update
    if (req.user.role !== 'admin' && req.user.id !== targetId) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await db.query(`UPDATE users SET phone = COALESCE($1, phone), updated_at = NOW()
                    WHERE id = $2`, [phone, targetId]);

    await db.query(`
        UPDATE instructor_profiles SET
            billing_type = COALESCE($1, billing_type),
            alert_lessons_before = COALESCE($2, alert_lessons_before),
            testing_enabled = COALESCE($3, testing_enabled),
            online_payment_enabled = COALESCE($4, online_payment_enabled),
            subject = COALESCE($5, subject),
            bio = COALESCE($6, bio),
            updated_at = NOW()
        WHERE user_id = $7
    `, [billing_type, alert_lessons_before, testing_enabled, online_payment_enabled, subject, bio, targetId]);

    res.json({ success: true, message: 'Instructor updated' });
};

// Admin: Toggle feature for instructor
exports.toggleFeature = async (req, res) => {
    const { feature, enabled } = req.body; // feature: 'testing_enabled' | 'online_payment_enabled'
    const allowed = ['testing_enabled', 'online_payment_enabled'];
    if (!allowed.includes(feature))
        return res.status(400).json({ success: false, message: 'Invalid feature' });

    await db.query(
        `UPDATE instructor_profiles SET ${feature} = $1, updated_at = NOW() WHERE user_id = $2`,
        [enabled, req.params.id]
    );
    res.json({ success: true, message: `Feature ${feature} set to ${enabled}` });
};

// GET /api/instructors/:id/students
exports.getStudents = async (req, res) => {
    const instructorId = req.user.role === 'admin' ? req.params.id : req.user.id;
    const { rows } = await db.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url,
               e.id AS enrollment_id, e.lesson_count, e.billing_type, e.status AS enrollment_status,
               e.enrolled_at,
               sp.grade, sp.parent_id,
               pu.full_name AS parent_name, pu.phone AS parent_phone,
               rs.name AS referral_source,
               (SELECT COUNT(*) FROM attendance a WHERE a.enrollment_id = e.id AND a.attended = TRUE) AS attended_lessons,
               (SELECT AVG(session_score) FROM attendance a WHERE a.enrollment_id = e.id AND a.session_score IS NOT NULL) AS avg_score
        FROM enrollments e
        JOIN users u ON u.id = e.student_id
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        LEFT JOIN users pu ON pu.id = sp.parent_id
        LEFT JOIN referral_sources rs ON rs.id = e.referral_source_id
        WHERE e.instructor_id = $1
        ORDER BY e.enrolled_at DESC
    `, [instructorId]);
    res.json({ success: true, students: rows });
};

// GET /api/instructors/:id/schedule
exports.getSchedule = async (req, res) => {
    const instructorId = req.user.role === 'admin' ? req.params.id : req.user.id;
    const { rows } = await db.query(`
        SELECT ls.*, e.student_id, u.full_name AS student_name
        FROM lesson_schedules ls
        JOIN enrollments e ON e.id = ls.enrollment_id
        JOIN users u ON u.id = e.student_id
        WHERE e.instructor_id = $1
        ORDER BY ls.scheduled_date ASC
    `, [instructorId]);
    res.json({ success: true, schedule: rows });
};

// POST /api/instructors/:id/schedule
exports.addSchedule = async (req, res) => {
    const { enrollment_id, title, description, scheduled_date, duration_minutes } = req.body;
    const { rows } = await db.query(`
        INSERT INTO lesson_schedules (enrollment_id, title, description, scheduled_date, duration_minutes)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [enrollment_id, title, description, scheduled_date, duration_minutes || 60]);
    res.status(201).json({ success: true, schedule: rows[0] });
};
