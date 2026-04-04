// enrollments.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

const { sendEnrollmentSMS } = require("../utils/notificationService");

router.post(
  "/",
  authenticate,
  authorize("admin", "instructor"),
  async (req, res) => {
    const {
      instructor_id,
      student_id,
      billing_type,
      referral_source_id,
      referred_by_student_id,
      referral_notes,
      first_lesson_date,
    } = req.body;
    const instrId =
      req.user.role === "instructor" ? req.user.id : instructor_id;

    const { rows } = await db.query(
      `
        INSERT INTO enrollments (instructor_id, student_id, billing_type, referral_source_id, referred_by_student_id, referral_notes)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `,
      [
        instrId,
        student_id,
        billing_type || null,
        referral_source_id || null,
        referred_by_student_id || null,
        referral_notes || null,
      ],
    );

    // SMS göndər
    try {
      const { rows: studentRows } = await db.query(
        `SELECT u.full_name, u.phone FROM users u WHERE u.id = $1`,
        [student_id],
      );
      const { rows: instrRows } = await db.query(
        `SELECT u.full_name, ip.subject FROM users u 
             JOIN instructor_profiles ip ON ip.user_id = u.id 
             WHERE u.id = $1`,
        [instrId],
      );

      const student = studentRows[0];
      const instructor = instrRows[0];

      if (student?.phone) {
        const lessonDate = first_lesson_date
          ? new Date(first_lesson_date).toLocaleString("az-AZ", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "tezliklə bildiriləcək";

        await sendEnrollmentSMS(
          student.phone,
          student.full_name,
          instructor.full_name,
          instructor.subject || "kurs",
          lessonDate,
        );
      }
    } catch (smsErr) {
      console.error("SMS xətası:", smsErr.message);
    }

    res.status(201).json({ success: true, enrollment: rows[0] });
  },
);

router.get("/:id", authenticate, async (req, res) => {
  const { rows } = await db.query(
    `
        SELECT e.*, u_s.full_name AS student_name, u_i.full_name AS instructor_name,
               ip.billing_type AS instructor_billing, ip.alert_lessons_before, ip.testing_enabled
        FROM enrollments e
        JOIN users u_s ON u_s.id = e.student_id
        JOIN users u_i ON u_i.id = e.instructor_id
        JOIN instructor_profiles ip ON ip.user_id = e.instructor_id
        WHERE e.id = $1
    `,
    [req.params.id],
  );
  if (!rows[0])
    return res
      .status(404)
      .json({ success: false, message: "Enrollment not found" });
  res.json({ success: true, enrollment: rows[0] });
});

router.put("/:id", authenticate, async (req, res) => {
  const { billing_type, status } = req.body;
  const { rows } = await db.query(
    `
        UPDATE enrollments SET billing_type = COALESCE($1, billing_type), status = COALESCE($2, status)
        WHERE id = $3 RETURNING *
    `,
    [billing_type, status, req.params.id],
  );
  res.json({ success: true, enrollment: rows[0] });
});

// GET referral sources
router.get("/meta/referral-sources", authenticate, async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM referral_sources ORDER BY name",
  );
  res.json({ success: true, sources: rows });
});

module.exports = router;

router.delete("/:id", authenticate, async (req, res) => {
  try {
    await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
