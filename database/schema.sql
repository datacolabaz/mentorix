-- ============================================================
-- SCHOOL MANAGEMENT SYSTEM - PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS TABLE (Multi-role: admin, instructor, student, parent)
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'instructor', 'student', 'parent')),
    phone VARCHAR(50),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PARENT-STUDENT RELATIONSHIP
-- ============================================================
CREATE TABLE student_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Parent user_id
    date_of_birth DATE,
    grade VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INSTRUCTOR PROFILES
-- ============================================================
CREATE TABLE instructor_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255),
    bio TEXT,
    -- Billing preferences
    billing_type VARCHAR(20) DEFAULT '8_lessons' CHECK (billing_type IN ('8_lessons', '12_lessons', 'monthly')),
    -- Alert preference: how many lessons before payment alert
    alert_lessons_before INT DEFAULT 2 CHECK (alert_lessons_before IN (1, 2)),
    -- Features enabled by admin
    testing_enabled BOOLEAN DEFAULT FALSE,
    online_payment_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REFERRAL SOURCES (Where did the student come from?)
-- ============================================================
CREATE TABLE referral_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE, -- 'Facebook', 'Instagram', 'TikTok', 'Recommendation', 'Other'
    icon VARCHAR(50)
);

INSERT INTO referral_sources (name, icon) VALUES
    ('Facebook', 'facebook'),
    ('Instagram', 'instagram'),
    ('TikTok', 'tiktok'),
    ('WhatsApp', 'whatsapp'),
    ('Recommendation', 'user-plus'),
    ('Other', 'globe');

-- ============================================================
-- INSTRUCTOR-STUDENT ENROLLMENTS
-- ============================================================
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Billing override per enrollment (inherits instructor default if NULL)
    billing_type VARCHAR(20) CHECK (billing_type IN ('8_lessons', '12_lessons', 'monthly')),
    -- Referral tracking
    referral_source_id UUID REFERENCES referral_sources(id),
    referred_by_student_id UUID REFERENCES users(id), -- which student referred this one
    referral_notes TEXT,
    -- Lesson counter
    lesson_count INT DEFAULT 0,
    monthly_start_date DATE, -- for monthly billing
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(instructor_id, student_id)
);

-- ============================================================
-- LESSON SCHEDULE / CURRICULUM (Instructor defines per student)
-- ============================================================
CREATE TABLE lesson_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    scheduled_date TIMESTAMPTZ,
    duration_minutes INT DEFAULT 60,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ATTENDANCE RECORDS
-- ============================================================
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    lesson_schedule_id UUID REFERENCES lesson_schedules(id),
    attended BOOLEAN DEFAULT TRUE,
    lesson_number INT, -- cumulative lesson number
    date TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    -- Score for this session (0-100)
    session_score INT CHECK (session_score >= 0 AND session_score <= 100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYMENT NOTIFICATIONS / ALERTS
-- ============================================================
CREATE TABLE payment_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    triggered_at_lesson INT, -- lesson count when triggered
    notification_type VARCHAR(30) DEFAULT 'payment_reminder',
    sent_to VARCHAR(20) CHECK (sent_to IN ('student', 'parent', 'both')),
    channel VARCHAR(20) CHECK (channel IN ('sms', 'whatsapp', 'email', 'system')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TASKS (Instructor creates tasks for students)
-- ============================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    -- Task type
    task_type VARCHAR(20) DEFAULT 'manual' CHECK (task_type IN ('manual', 'pdf', 'mixed')),
    pdf_url TEXT, -- S3/storage URL for PDF
    -- Questions (JSON array for manual entry)
    questions JSONB DEFAULT '[]',
    -- Scoring
    total_points INT DEFAULT 100,
    -- Target
    target_type VARCHAR(20) DEFAULT 'enrollment' CHECK (target_type IN ('enrollment', 'student', 'all')),
    due_date TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TASK ASSIGNMENTS (which students get which tasks)
-- ============================================================
CREATE TABLE task_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_id UUID REFERENCES enrollments(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    due_date TIMESTAMPTZ,
    UNIQUE(task_id, student_id)
);

-- ============================================================
-- TASK SUBMISSIONS
-- ============================================================
CREATE TABLE task_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_assignment_id UUID NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answers JSONB DEFAULT '{}', -- {question_id: answer}
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    -- Grading
    score INT,
    percentage DECIMAL(5,2),
    graded_at TIMESTAMPTZ,
    graded_by UUID REFERENCES users(id),
    feedback TEXT,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned'))
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'AZN',
    payment_method VARCHAR(30) CHECK (payment_method IN ('cash', 'online', 'bank_transfer', 'millioncard', 'goldenpay')),
    -- Payment cycle covered
    period_start_lesson INT,
    period_end_lesson INT,
    period_month DATE, -- for monthly billing
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    -- Online payment
    transaction_id VARCHAR(255),
    payment_provider VARCHAR(50),
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROGRESS / ACHIEVEMENTS
-- ============================================================
CREATE TABLE progress_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    snapshot_date DATE DEFAULT CURRENT_DATE,
    -- Aggregated scores
    avg_score DECIMAL(5,2),
    tasks_completed INT DEFAULT 0,
    tasks_total INT DEFAULT 0,
    attendance_rate DECIMAL(5,2),
    lessons_completed INT DEFAULT 0,
    -- For charting: first vs latest score comparison
    first_score INT,
    latest_score INT,
    improvement_percentage DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS (system-wide)
-- ============================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    type VARCHAR(50) DEFAULT 'general',
    is_read BOOLEAN DEFAULT FALSE,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FILE UPLOADS
-- ============================================================
CREATE TABLE file_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploaded_by UUID NOT NULL REFERENCES users(id),
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INT,
    related_type VARCHAR(50), -- 'task', 'avatar', etc.
    related_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_enrollments_instructor ON enrollments(instructor_id);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_attendance_enrollment ON attendance(enrollment_id);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_task_assignments_student ON task_assignments(student_id);
CREATE INDEX idx_submissions_student ON task_submissions(student_id);
CREATE INDEX idx_payments_enrollment ON payments(enrollment_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- TRIGGER: Update lesson_count and check payment alert
-- ============================================================
CREATE OR REPLACE FUNCTION update_lesson_count_and_notify()
RETURNS TRIGGER AS $$
DECLARE
    v_enrollment enrollments%ROWTYPE;
    v_billing_type VARCHAR(20);
    v_alert_before INT;
    v_threshold INT;
    v_current_count INT;
BEGIN
    -- Get enrollment
    SELECT * INTO v_enrollment FROM enrollments WHERE id = NEW.enrollment_id;
    
    -- Get instructor billing settings
    SELECT 
        COALESCE(e.billing_type, ip.billing_type),
        ip.alert_lessons_before
    INTO v_billing_type, v_alert_before
    FROM enrollments e
    JOIN instructor_profiles ip ON ip.user_id = e.instructor_id
    WHERE e.id = NEW.enrollment_id;

    -- Only count attended lessons
    IF NEW.attended = TRUE THEN
        -- Update lesson count
        UPDATE enrollments 
        SET lesson_count = lesson_count + 1
        WHERE id = NEW.enrollment_id
        RETURNING lesson_count INTO v_current_count;

        -- Determine threshold
        IF v_billing_type = '8_lessons' THEN
            v_threshold := 8 - v_alert_before; -- e.g. 6 if alert_before=2
        ELSIF v_billing_type = '12_lessons' THEN
            v_threshold := 12 - v_alert_before; -- e.g. 10 if alert_before=2
        END IF;

        -- Insert payment notification if threshold reached (for lesson-based billing)
        IF v_billing_type != 'monthly' AND v_current_count = v_threshold THEN
            INSERT INTO payment_notifications (
                enrollment_id,
                triggered_at_lesson,
                notification_type,
                sent_to,
                channel,
                status,
                message
            ) VALUES (
                NEW.enrollment_id,
                v_current_count,
                'payment_reminder',
                'parent',
                'system',
                'pending',
                'Payment reminder: ' || v_alert_before || ' lessons remaining before next payment cycle.'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_lesson_count
AFTER INSERT ON attendance
FOR EACH ROW EXECUTE FUNCTION update_lesson_count_and_notify();

-- ============================================================
-- FUNCTION: Get student progress summary
-- ============================================================
CREATE OR REPLACE FUNCTION get_student_progress(p_enrollment_id UUID)
RETURNS TABLE (
    lesson_number INT,
    lesson_date TIMESTAMPTZ,
    score INT,
    attended BOOLEAN,
    cumulative_avg DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.lesson_number,
        a.date,
        a.session_score,
        a.attended,
        AVG(a.session_score) OVER (
            ORDER BY a.lesson_number 
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_avg
    FROM attendance a
    WHERE a.enrollment_id = p_enrollment_id
    ORDER BY a.lesson_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default admin user (password: Admin@123)
INSERT INTO users (full_name, email, password_hash, role, phone) VALUES
('System Admin', 'admin@school.az', crypt('Admin@123', gen_salt('bf')), 'admin', '+994501234567');

-- Sample referral sources already inserted above
