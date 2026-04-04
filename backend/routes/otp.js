const express = require("express");
const router = express.Router();
const db = require("../db");

async function sendSMS(phone, message) {
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
        body: [{ msisdn: phone.replace(/\D/g, ""), message }],
      },
    }),
  });
  return await res.json();
}

// OTP göndər
router.post("/send", async (req, res) => {
  const { phone } = req.body;
  if (!phone)
    return res
      .status(400)
      .json({ success: false, message: "Telefon lazımdır" });

  const cleanPhone = phone.replace(/\D/g, "");

  // İstifadəçi mövcuddur?
  const { rows } = await db.query(
    "SELECT * FROM users WHERE phone = $1 AND is_active = TRUE",
    [cleanPhone],
  );
  if (!rows.length)
    return res
      .status(404)
      .json({ success: false, message: "Bu nömrə ilə istifadəçi tapılmadı" });

  // OTP generasiya et
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dəqiqə

  // Köhnə OTP-ləri sil
  await db.query("DELETE FROM otp_codes WHERE phone = $1", [cleanPhone]);

  // Yeni OTP saxla
  await db.query(
    "INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)",
    [cleanPhone, code, expiresAt],
  );

  // SMS göndər
  await sendSMS(
    cleanPhone,
    `Mentorix: ${code} kodunuz. 5 deqiqe erzinde daxil edin.`,
  );

  res.json({ success: true, message: "OTP göndərildi" });
});

// OTP yoxla
router.post("/verify", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code)
    return res
      .status(400)
      .json({ success: false, message: "Telefon və kod lazımdır" });

  const cleanPhone = phone.replace(/\D/g, "");

  const { rows } = await db.query(
    "SELECT * FROM otp_codes WHERE phone = $1 AND code = $2 AND is_used = FALSE AND expires_at > NOW()",
    [cleanPhone, code],
  );

  if (!rows.length)
    return res
      .status(400)
      .json({ success: false, message: "Kod yanlış və ya müddəti bitib" });

  // OTP istifadə edildi
  await db.query("UPDATE otp_codes SET is_used = TRUE WHERE id = $1", [
    rows[0].id,
  ]);

  // İstifadəçini tap
  const userRes = await db.query(
    "SELECT * FROM users WHERE phone = $1 AND is_active = TRUE",
    [cleanPhone],
  );
  const user = userRes.rows[0];

  // 30 günlük token yarat
  const jwt = require("jsonwebtoken");
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      role: user.role,
      email: user.email,
      phone: user.phone,
    },
  });
});

module.exports = router;
