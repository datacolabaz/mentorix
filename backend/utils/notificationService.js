const db = require("../db");

async function sendSMS(phone, message) {
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const res = await fetch("https://sendsms.az/smxml/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          head: {
            operation: "submit",
            login: "userMedpanel@",
            password: "Aty@37YulqaT",
            controlid: Date.now().toString(),
            title: "Mentorix",
            scheduled: "NOW",
            isbulk: false,
          },
          body: [{ msisdn: cleanPhone, message: message }],
        },
      }),
    });
    const data = await res.json();
    console.log("SMS gonderildi:", JSON.stringify(data));
  } catch (err) {
    console.error("SMS xetasi:", err.message);
  }
}

async function sendEnrollmentSMS(
  studentPhone,
  studentName,
  instructorName,
  subject,
  firstLessonDate,
) {
  const message = `Salam ${studentName}! Siz Mentorix.biz platformasinda ${instructorName} terefinden ${subject} kursuna qeyd edildiniz. Ugurlar!`;
  await sendSMS(studentPhone, message);
}

async function sendWhatsApp(phone, message) {
  await sendSMS(phone, message);
}

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
      ? "8 ders"
      : billingType === "12_lessons"
        ? "12 ders"
        : "aylig";
  const message = `Hormətli ${contactName}, ${studentName} adli telebenin ${cycleLabel} dovru uzre ${lessonsLeft} dersi qalib. Zehmət olmasa odenisi hazirlayın.`;
  await db.query(
    `UPDATE payment_notifications SET status = 'sent' WHERE enrollment_id = $1 AND status = 'pending'`,
    [enrollmentId],
  );
  const { rows } = await db.query(
    `SELECT e.student_id, sp.parent_id FROM enrollments e LEFT JOIN student_profiles sp ON sp.user_id = e.student_id WHERE e.id = $1`,
    [enrollmentId],
  );
  if (rows[0]) {
    const targetId = rows[0].parent_id || rows[0].student_id;
    await createSystemNotification(
      targetId,
      "Odenis xatirlatmasi",
      message,
      "payment_reminder",
      { enrollmentId },
    );
  }
  if (contactPhone) await sendSMS(contactPhone, message);
}

async function createSystemNotification(
  userId,
  title,
  body,
  type = "general",
  data = {},
) {
  await db.query(
    `INSERT INTO notifications (user_id, title, body, type, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
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
