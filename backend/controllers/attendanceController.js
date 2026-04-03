const db = require('../db');
const notificationService = require('../utils/notificationService');

// POST /api/attendance — Mark attendance
exports.mark = async (req, res) => {
    const { enrollment_id, attended, session_score, notes, lesson_schedule_id } = req.body;

    // Get enrollment + instructor settings
    const { rows: enrollRows } = await db.query(`
        SELECT e.*, ip.billing_type AS instructor_billing, ip.alert_lessons_before,
               ip.testing_enabled,
               u_s.full_name AS student_name, u_s.phone AS student_phone,
               u_p.full_name AS parent_name, u_p.phone AS parent_phone,
               sp.parent_id
        FROM enrollments e
        JOIN instructor_profiles ip ON ip.user_id = e.instructor_id
        JOIN users u_s ON u_s.id = e.student_id
        LEFT JOIN student_profiles sp ON sp.user_id = e.student_id
        LEFT JOIN users u_p ON u_p.id = sp.parent_id
        WHERE e.id = $1
    `, [enrollment_id]);

    if (!enrollRows[0])
        return res.status(404).json({ success: false, message: 'Enrollment not found' });

    const enrollment = enrollRows[0];

    // Get current lesson count
    const countRes = await db.query(
        'SELECT COUNT(*) FROM attendance WHERE enrollment_id = $1 AND attended = TRUE',
        [enrollment_id]
    );
    const currentCount = parseInt(countRes.rows[0].count);
    const lessonNumber = currentCount + 1;

    // Insert attendance
    const { rows } = await db.query(`
        INSERT INTO attendance (enrollment_id, lesson_schedule_id, attended, lesson_number, session_score, notes)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [enrollment_id, lesson_schedule_id || null, attended !== false, lessonNumber, session_score || null, notes || null]);

    // The trigger handles lesson_count update and notification insertion
    // But we also send the actual notification here
    const billingType = enrollment.billing_type || enrollment.instructor_billing || '8_lessons';
    const alertBefore = enrollment.alert_lessons_before || 2;
    let threshold = null;

    if (billingType === '8_lessons') threshold = 8 - alertBefore;
    else if (billingType === '12_lessons') threshold = 12 - alertBefore;

    if (threshold && attended !== false && lessonNumber === threshold) {
        // Send payment reminder
        const contactPhone = enrollment.parent_id ? enrollment.parent_phone : enrollment.student_phone;
        const contactName = enrollment.parent_id ? enrollment.parent_name : enrollment.student_name;
        const lessonsLeft = (billingType === '8_lessons' ? 8 : 12) - lessonNumber;

        await notificationService.sendPaymentReminder({
            enrollmentId: enrollment_id,
            contactName,
            contactPhone,
            studentName: enrollment.student_name,
            lessonsLeft,
            billingType
        });
    }

    // Mark lesson schedule as completed if provided
    if (lesson_schedule_id) {
        await db.query(
            `UPDATE lesson_schedules SET status = 'completed' WHERE id = $1`,
            [lesson_schedule_id]
        );
    }

    res.status(201).json({ success: true, attendance: rows[0], lessonNumber });
};

// GET /api/attendance/enrollment/:enrollmentId
exports.getByEnrollment = async (req, res) => {
    const { rows } = await db.query(`
        SELECT a.*, ls.title AS lesson_title
        FROM attendance a
        LEFT JOIN lesson_schedules ls ON ls.id = a.lesson_schedule_id
        WHERE a.enrollment_id = $1
        ORDER BY a.lesson_number ASC
    `, [req.params.enrollmentId]);
    res.json({ success: true, attendance: rows });
};

// GET /api/attendance/enrollment/:enrollmentId/progress
exports.getProgress = async (req, res) => {
    const { rows } = await db.query(`
        SELECT 
            a.lesson_number,
            a.date,
            a.session_score,
            a.attended,
            a.notes,
            ROUND(AVG(a.session_score) OVER (
                ORDER BY a.lesson_number 
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ), 2) AS cumulative_avg
        FROM attendance a
        WHERE a.enrollment_id = $1
        ORDER BY a.lesson_number ASC
    `, [req.params.enrollmentId]);

    // Summary stats
    const attended = rows.filter(r => r.attended);
    const scored = attended.filter(r => r.session_score !== null);
    const firstScore = scored.length > 0 ? scored[0].session_score : null;
    const latestScore = scored.length > 0 ? scored[scored.length - 1].session_score : null;
    const improvement = firstScore && latestScore ? latestScore - firstScore : 0;

    res.json({
        success: true,
        progress: rows,
        summary: {
            total_lessons: rows.length,
            attended_count: attended.length,
            attendance_rate: rows.length > 0 ? Math.round((attended.length / rows.length) * 100) : 0,
            avg_score: scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b.session_score, 0) / scored.length) : null,
            first_score: firstScore,
            latest_score: latestScore,
            improvement
        }
    });
};

// PUT /api/attendance/:id
exports.update = async (req, res) => {
    const { attended, session_score, notes } = req.body;
    const { rows } = await db.query(`
        UPDATE attendance SET
            attended = COALESCE($1, attended),
            session_score = COALESCE($2, session_score),
            notes = COALESCE($3, notes)
        WHERE id = $4 RETURNING *
    `, [attended, session_score, notes, req.params.id]);
    res.json({ success: true, attendance: rows[0] });
};
