const db = require("../db");

// ============================================================
// NOTIFICATION SERVICE
// Send via WhatsApp (Twilio), SMS, or store as system notification
// ============================================================

//const twilio = require("twilio");

async function sendEnrollmentSMS(
  studentPhone,
  studentName,
  instructorName,
  subject,
  firstLessonDate,
) {
  try {
    const phone = studentPhone.replace(/\D/g, "");
    const res = await fetch(
      `${process.env.INFOBIP_BASE_URL}/sms/2/text/advanced`,
      {
        method: "POST",
        headers: {
          Authorization: `App ${process.env.INFOBIP_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              from: "MedPanel",
              destinations: [{ to: phone }],
              text: `Salam ${studentName}! Siz Mentorix.biz platformasinda ${instructorName} terefinden ${subject} kursuna qeyd edildiniz. Ilk dersiniz ${firstLessonDate} olacaq. Ugurlar!`,
            },
          ],
        }),
      },
    );
    const data = await res.json();
    console.log("✓ SMS göndərildi:", JSON.stringify(data));
  } catch (err) {
    console.error("SMS xətası:", err.message);
  }
}

module.exports.sendEnrollmentSMS = sendEnrollmentSMS;

async function sendPaymentReminder({
  enrollmentId,
  contactName,
  contactPhone,
  studentName,
  lessonsLeft,
  billingType,
}) {
  const cycleLabel =
    billingType === "8_lessons"
      ? "8 dərs"
      : billingType === "12_lessons"
        ? "12 dərs"
        : "aylıq";
  const message = `Hörmətli ${contactName}, ${studentName} adlı tələbənin ${cycleLabel} dövrü üzrə ${lessonsLeft} dərsi qalıb. Zəhmət olmasa ödənişi hazırlayın. 📚`;

  // 1. Store in DB
  await db.query(
    `
        UPDATE payment_notifications SET status = 'sent' 
        WHERE enrollment_id = $1 AND status = 'pending'
    `,
    [enrollmentId],
  );

  // 2. Get student/parent user id to send system notification
  const { rows } = await db.query(
    `
        SELECT e.student_id, sp.parent_id
        FROM enrollments e
        LEFT JOIN student_profiles sp ON sp.user_id = e.student_id
        WHERE e.id = $1
    `,
    [enrollmentId],
  );

  if (rows[0]) {
    const targetId = rows[0].parent_id || rows[0].student_id;
    await createSystemNotification(
      targetId,
      "💳 Ödəniş xatırlatması",
      message,
      "payment_reminder",
      { enrollmentId },
    );
  }

  // 3. WhatsApp via Twilio (if configured)

  if (process.env.INFOBIP_API_KEY && contactPhone) {
    await sendWhatsApp(contactPhone, message);
  }

  console.log(
    `[Notification] Payment reminder sent for enrollment ${enrollmentId}`,
  );
}

async function sendWhatsApp(phone, message) {
  try {
    const res = await fetch(
      `${process.env.INFOBIP_BASE_URL}/sms/2/text/advanced`,
      {
        method: "POST",
        headers: {
          Authorization: `App ${process.env.INFOBIP_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              from: "447860030760",
              destinations: [{ to: phone }],
              text: message,
            },
          ],
        }),
      },
    );
    const data = await res.json();
    console.log("SMS göndərildi:", JSON.stringify(data));
  } catch (err) {
    console.error("SMS xətası:", err.message);
  }
}

async function createSystemNotification(
  userId,
  title,
  body,
  type = "general",
  data = {},
) {
  await db.query(
    `INSERT INTO notifications (user_id, title, body, type, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, title, body, type, JSON.stringify(data)],
  );
}

async function getUnreadCount(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  );
  return parseInt(rows[0].count);
}

async function markAllRead(userId) {
  await db.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [
    userId,
  ]);
}

module.exports = {
  sendEnrollmentSMS,
  sendPaymentReminder,
  sendWhatsApp,
  createSystemNotification,
  getUnreadCount,
  markAllRead,
};
