const db = require('../db');

// GET /api/analytics/admin — Admin overview
exports.adminOverview = async (req, res) => {
    const [usersRes, enrollRes, revenueRes, referralRes] = await Promise.all([
        db.query(`SELECT role, COUNT(*) FROM users WHERE is_active=TRUE GROUP BY role`),
        db.query(`SELECT status, COUNT(*) FROM enrollments GROUP BY status`),
        db.query(`SELECT SUM(amount), currency FROM payments WHERE status='completed' GROUP BY currency`),
        db.query(`
            SELECT rs.name AS source, COUNT(e.id) AS count
            FROM enrollments e
            JOIN referral_sources rs ON rs.id = e.referral_source_id
            GROUP BY rs.name ORDER BY count DESC
        `)
    ]);

    res.json({
        success: true,
        users: usersRes.rows,
        enrollments: enrollRes.rows,
        revenue: revenueRes.rows,
        referrals: referralRes.rows
    });
};

// GET /api/analytics/instructor/:id — Instructor dashboard
exports.instructorDashboard = async (req, res) => {
    const instructorId = req.user.role === 'admin' ? req.params.id : req.user.id;

    const [studentsRes, taskRes, referralRes, topStudentsRes, recentAttendRes] = await Promise.all([
        // Student stats
        db.query(`
            SELECT COUNT(*) AS total, 
                   SUM(CASE WHEN e.status='active' THEN 1 ELSE 0 END) AS active
            FROM enrollments e WHERE e.instructor_id = $1
        `, [instructorId]),

        // Task completion rate
        db.query(`
            SELECT t.id, t.title,
                   COUNT(ta.id) AS assigned,
                   COUNT(ts.id) AS submitted,
                   ROUND(AVG(ts.percentage), 1) AS avg_score
            FROM tasks t
            LEFT JOIN task_assignments ta ON ta.task_id = t.id
            LEFT JOIN task_submissions ts ON ts.task_assignment_id = ta.id AND ts.status = 'graded'
            WHERE t.instructor_id = $1
            GROUP BY t.id ORDER BY t.created_at DESC LIMIT 5
        `, [instructorId]),

        // Referral breakdown
        db.query(`
            SELECT rs.name AS source, rs.icon, COUNT(e.id) AS count
            FROM enrollments e
            JOIN referral_sources rs ON rs.id = e.referral_source_id
            WHERE e.instructor_id = $1
            GROUP BY rs.name, rs.icon ORDER BY count DESC
        `, [instructorId]),

        // Top performing students
        db.query(`
            SELECT u.full_name, u.avatar_url, e.id AS enrollment_id,
                   ROUND(AVG(a.session_score), 1) AS avg_score,
                   COUNT(a.id) AS lessons_done,
                   (SELECT COUNT(*) FROM task_submissions ts 
                    JOIN task_assignments ta ON ta.id = ts.task_assignment_id 
                    WHERE ta.student_id = e.student_id AND ts.status = 'graded') AS tasks_graded
            FROM enrollments e
            JOIN users u ON u.id = e.student_id
            LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.attended = TRUE
            WHERE e.instructor_id = $1
            GROUP BY u.full_name, u.avatar_url, e.id
            ORDER BY avg_score DESC NULLS LAST LIMIT 10
        `, [instructorId]),

        // Recent attendance (last 30 days)
        db.query(`
            SELECT DATE(a.date) AS day, COUNT(*) AS count
            FROM attendance a
            JOIN enrollments e ON e.id = a.enrollment_id
            WHERE e.instructor_id = $1 AND a.date >= NOW() - INTERVAL '30 days'
            GROUP BY day ORDER BY day
        `, [instructorId])
    ]);

    res.json({
        success: true,
        students: studentsRes.rows[0],
        tasks: taskRes.rows,
        referrals: referralRes.rows,
        topStudents: topStudentsRes.rows,
        recentAttendance: recentAttendRes.rows
    });
};

// GET /api/analytics/student/:enrollmentId — Student progress
exports.studentProgress = async (req, res) => {
    const { enrollmentId } = req.params;

    const [progressRes, taskRes, enrollRes] = await Promise.all([
        db.query(`
            SELECT a.lesson_number, a.date, a.session_score, a.attended,
                   ROUND(AVG(a.session_score) OVER (ORDER BY a.lesson_number 
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_avg
            FROM attendance a WHERE a.enrollment_id = $1 ORDER BY a.lesson_number
        `, [enrollmentId]),

        db.query(`
            SELECT t.title, ts.percentage, ts.submitted_at, ts.status
            FROM task_submissions ts
            JOIN task_assignments ta ON ta.id = ts.task_assignment_id
            JOIN tasks t ON t.id = ta.task_id
            WHERE ta.enrollment_id = $1
            ORDER BY ts.submitted_at DESC
        `, [enrollmentId]),

        db.query(`
            SELECT e.lesson_count, e.billing_type, e.enrolled_at,
                   ip.billing_type AS instructor_billing
            FROM enrollments e
            JOIN instructor_profiles ip ON ip.user_id = e.instructor_id
            WHERE e.id = $1
        `, [enrollmentId])
    ]);

    const progress = progressRes.rows;
    const scored = progress.filter(p => p.session_score !== null);

    res.json({
        success: true,
        progress,
        tasks: taskRes.rows,
        enrollment: enrollRes.rows[0],
        summary: {
            total_lessons: progress.length,
            attended: progress.filter(p => p.attended).length,
            first_score: scored[0]?.session_score ?? null,
            latest_score: scored[scored.length - 1]?.session_score ?? null,
            avg_score: scored.length ? Math.round(scored.reduce((s, r) => s + r.session_score, 0) / scored.length) : null
        }
    });
};

// GET /api/analytics/referrals — Referral source stats
exports.referralStats = async (req, res) => {
    const instructorId = req.user.role === 'admin' ? req.query.instructor_id : req.user.id;
    let query = `
        SELECT rs.name, rs.icon, COUNT(e.id) AS total,
               COUNT(CASE WHEN e.status='active' THEN 1 END) AS active,
               -- Top referrer student
               ru.full_name AS top_referrer
        FROM enrollments e
        JOIN referral_sources rs ON rs.id = e.referral_source_id
        LEFT JOIN users ru ON ru.id = e.referred_by_student_id
    `;
    const params = [];
    if (instructorId) {
        query += ` WHERE e.instructor_id = $1`;
        params.push(instructorId);
    }
    query += ` GROUP BY rs.name, rs.icon, ru.full_name ORDER BY total DESC`;

    const { rows } = await db.query(query, params);
    res.json({ success: true, referrals: rows });
};
