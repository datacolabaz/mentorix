// uploads.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// Local storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = process.env.LOCAL_UPLOAD_PATH || './uploads';
        require('fs').mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only PDF and image files allowed'));
    }
});

// POST /api/uploads/task-pdf
router.post('/task-pdf', authenticate, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const fileUrl = `/uploads/${req.file.filename}`;
    await db.query(`
        INSERT INTO file_uploads (uploaded_by, file_name, file_path, file_type, file_size, related_type)
        VALUES ($1, $2, $3, $4, $5, 'task')
    `, [req.user.id, req.file.originalname, fileUrl, req.file.mimetype, req.file.size]);

    res.json({ success: true, url: fileUrl, filename: req.file.originalname });
});

// POST /api/uploads/avatar
router.post('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    await db.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [fileUrl, req.user.id]);
    res.json({ success: true, url: fileUrl });
});

module.exports = router;
