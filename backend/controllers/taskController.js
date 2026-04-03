const db = require('../db');

// GET /api/tasks — Instructor's tasks
exports.getAll = async (req, res) => {
    const instructorId = req.user.id;
    const { rows } = await db.query(`
        SELECT t.*,
               COUNT(DISTINCT ta.id) AS assigned_count,
               COUNT(DISTINCT ts.id) AS submitted_count,
               ROUND(AVG(ts.percentage), 1) AS avg_score
        FROM tasks t
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN task_submissions ts ON ts.task_assignment_id = ta.id
        WHERE t.instructor_id = $1
        GROUP BY t.id ORDER BY t.created_at DESC
    `, [instructorId]);
    res.json({ success: true, tasks: rows });
};

// POST /api/tasks — Create task
exports.create = async (req, res) => {
    const { title, description, task_type, questions, total_points, due_date, enrollment_ids } = req.body;
    const instructorId = req.user.id;
    
    // Check testing is enabled for this instructor
    const { rows: ipRows } = await db.query(
        'SELECT testing_enabled FROM instructor_profiles WHERE user_id = $1', [instructorId]
    );
    if (!ipRows[0]?.testing_enabled) {
        return res.status(403).json({ success: false, message: 'Testing feature not enabled. Contact admin.' });
    }

    return await db.transaction(async (client) => {
        const { rows } = await client.query(`
            INSERT INTO tasks (instructor_id, title, description, task_type, questions, total_points, due_date)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING *
        `, [instructorId, title, description, task_type || 'manual',
            JSON.stringify(questions || []), total_points || 100, due_date || null]);

        const task = rows[0];

        // Assign to specific enrollments or all students
        if (enrollment_ids && enrollment_ids.length > 0) {
            for (const enrollId of enrollment_ids) {
                const { rows: enRows } = await client.query(
                    'SELECT student_id FROM enrollments WHERE id = $1 AND instructor_id = $2',
                    [enrollId, instructorId]
                );
                if (enRows[0]) {
                    await client.query(`
                        INSERT INTO task_assignments (task_id, student_id, enrollment_id, due_date)
                        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
                    `, [task.id, enRows[0].student_id, enrollId, due_date || null]);
                }
            }
        }

        res.status(201).json({ success: true, task });
    });
};

// PUT /api/tasks/:id — Update (attach PDF url after upload)
exports.update = async (req, res) => {
    const { title, description, questions, pdf_url, total_points, due_date, is_active } = req.body;
    const { rows } = await db.query(`
        UPDATE tasks SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            questions = COALESCE($3::jsonb, questions),
            pdf_url = COALESCE($4, pdf_url),
            total_points = COALESCE($5, total_points),
            due_date = COALESCE($6, due_date),
            is_active = COALESCE($7, is_active)
        WHERE id = $8 AND instructor_id = $9 RETURNING *
    `, [title, description, questions ? JSON.stringify(questions) : null,
        pdf_url, total_points, due_date, is_active, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task: rows[0] });
};

// GET /api/tasks/student — Student's assigned tasks
exports.getStudentTasks = async (req, res) => {
    const studentId = req.user.id;
    const { rows } = await db.query(`
        SELECT t.id, t.title, t.description, t.task_type, t.pdf_url,
               t.questions, t.total_points, ta.due_date,
               ts.id AS submission_id, ts.score, ts.percentage, ts.status AS submission_status,
               ts.submitted_at, ts.feedback,
               u.full_name AS instructor_name
        FROM task_assignments ta
        JOIN tasks t ON t.id = ta.task_id
        JOIN users u ON u.id = t.instructor_id
        LEFT JOIN task_submissions ts ON ts.task_assignment_id = ta.id AND ts.student_id = $1
        WHERE ta.student_id = $1 AND t.is_active = TRUE
        ORDER BY ta.assigned_at DESC
    `, [studentId]);
    res.json({ success: true, tasks: rows });
};

// POST /api/tasks/:id/submit — Student submits task
exports.submit = async (req, res) => {
    const { answers } = req.body;
    const studentId = req.user.id;

    const { rows: taRows } = await db.query(
        `SELECT ta.id, ta.enrollment_id, t.questions, t.total_points
         FROM task_assignments ta
         JOIN tasks t ON t.id = ta.task_id
         WHERE ta.task_id = $1 AND ta.student_id = $2`,
        [req.params.id, studentId]
    );
    if (!taRows[0]) return res.status(404).json({ success: false, message: 'Task not assigned to you' });

    const ta = taRows[0];
    const questions = ta.questions || [];

    // Auto-grade if questions have correct_answer
    let score = null, percentage = null;
    if (questions.length > 0 && answers) {
        let correct = 0;
        questions.forEach(q => {
            if (q.correct_answer && answers[q.id] !== undefined) {
                if (String(answers[q.id]).toLowerCase() === String(q.correct_answer).toLowerCase()) correct++;
            }
        });
        score = Math.round((correct / questions.length) * ta.total_points);
        percentage = Math.round((correct / questions.length) * 100);
    }

    const { rows } = await db.query(`
        INSERT INTO task_submissions (task_assignment_id, student_id, answers, score, percentage, status, graded_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING *
    `, [ta.id, studentId, JSON.stringify(answers || {}),
        score, percentage,
        score !== null ? 'graded' : 'submitted',
        score !== null ? 'NOW()' : null]);

    res.status(201).json({ success: true, submission: rows[0] });
};

// PUT /api/tasks/submissions/:id/grade — Instructor grades
exports.grade = async (req, res) => {
    const { score, feedback } = req.body;
    const { rows: subRows } = await db.query('SELECT * FROM task_submissions WHERE id = $1', [req.params.id]);
    if (!subRows[0]) return res.status(404).json({ success: false, message: 'Submission not found' });

    const { rows: taskRows } = await db.query(
        `SELECT t.total_points FROM task_submissions ts
         JOIN task_assignments ta ON ta.id = ts.task_assignment_id
         JOIN tasks t ON t.id = ta.task_id
         WHERE ts.id = $1 AND t.instructor_id = $2`,
        [req.params.id, req.user.id]
    );
    if (!taskRows[0]) return res.status(403).json({ success: false, message: 'Not your task' });

    const percentage = Math.round((score / taskRows[0].total_points) * 100);
    const { rows } = await db.query(`
        UPDATE task_submissions SET score = $1, percentage = $2, feedback = $3,
               graded_at = NOW(), graded_by = $4, status = 'graded'
        WHERE id = $5 RETURNING *
    `, [score, percentage, feedback, req.user.id, req.params.id]);
    res.json({ success: true, submission: rows[0] });
};
