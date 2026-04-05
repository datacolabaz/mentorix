const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

// POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res
      .status(400)
      .json({ success: false, message: "Email and password required" });

  const { rows } = await db.query(
    "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (!user)
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

  // Fetch role-specific profile
  let profile = null;
  if (user.role === "instructor") {
    const p = await db.query(
      "SELECT * FROM instructor_profiles WHERE user_id = $1",
      [user.id],
    );
    profile = p.rows[0] || null;
  } else if (user.role === "student") {
    const p = await db.query(
      "SELECT * FROM student_profiles WHERE user_id = $1",
      [user.id],
    );
    profile = p.rows[0] || null;
  }

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      avatar_url: user.avatar_url,
      profile,
    },
  });
};

// POST /api/auth/register (Admin creates users)
exports.register = async (req, res) => {
  try {
    const {
      full_name,
      email,
      password,
      role,
      phone,
      parent_id,
      subject,
      billing_type,
    } = req.body;

    // Check duplicate
    const exists = await db.query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    if (exists.rows[0])
      return res
        .status(409)
        .json({ success: false, message: "Email already exists" });

    const hash = await bcrypt.hash(password, 12);

    return await db.transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, phone)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role`,
        [full_name, email.toLowerCase(), hash, role, phone],
      );
      const newUser = rows[0];

      if (role === "instructor") {
        await client.query(
          `INSERT INTO instructor_profiles (user_id, subject, billing_type)
                 VALUES ($1, $2, $3)`,
          [newUser.id, subject || null, billing_type || "8_lessons"],
        );
      } else if (role === "student") {
        await client.query(
          `INSERT INTO student_profiles (user_id, parent_id)
                 VALUES ($1, $2)`,
          [newUser.id, parent_id || null],
        );
      }

      res.status(201).json({ success: true, user: newUser });
    });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ success: false, message: "Bu email artıq mövcuddur" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/me
exports.me = async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.phone, u.avatar_url, u.created_at,
                ip.billing_type, ip.alert_lessons_before, ip.testing_enabled, 
                ip.online_payment_enabled, ip.subject,
                sp.parent_id, sp.grade
         FROM users u
         LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE u.id = $1`,
    [req.user.id],
  );
  res.json({ success: true, user: rows[0] });
};

// PUT /api/auth/change-password
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  const { rows } = await db.query(
    "SELECT password_hash FROM users WHERE id = $1",
    [req.user.id],
  );
  const valid = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!valid)
    return res
      .status(400)
      .json({ success: false, message: "Current password incorrect" });

  const hash = await bcrypt.hash(new_password, 12);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    hash,
    req.user.id,
  ]);
  res.json({ success: true, message: "Password changed successfully" });
};

// Valideyn yarat ve telebeye bagla
exports.createParent = async (req, res) => {
  try {
    const { full_name, phone, student_id } = req.body;
    if (!full_name || !phone) return res.json({ success: false, message: 'Ad ve telefon lazimdir' });
    
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);
    const email = 'parent_' + phone.replace(/\D/g,'') + '@mentorix.biz';
    
    // Artiq varsa tap
    let parentId;
    const exists = await db.query('SELECT id FROM users WHERE phone = $1 AND role = $2', [phone, 'parent']);
    if (exists.rows.length) {
      parentId = exists.rows[0].id;
    } else {
      const { rows } = await db.query(
        'INSERT INTO users (full_name, email, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [full_name, email, hash, 'parent', phone]
      );
      parentId = rows[0].id;
    }
    
    // Telebenin student_profiles-ini yenile
    if (student_id) {
      await db.query('UPDATE student_profiles SET parent_id=$1 WHERE user_id=$2', [parentId, student_id]);
    }
    
    res.json({ success: true, parent_id: parentId });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
};
