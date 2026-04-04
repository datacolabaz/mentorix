require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'frontend')));

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth',        require('./backend/routes/auth'));
app.use('/api/users',       require('./backend/routes/users'));
app.use('/api/instructors', require('./backend/routes/instructors'));
app.use('/api/students',    require('./backend/routes/students'));
app.use('/api/enrollments', require('./backend/routes/enrollments'));
app.use('/api/attendance',  require('./backend/routes/attendance'));
app.use('/api/tasks',       require('./backend/routes/tasks'));
app.use('/api/payments',    require('./backend/routes/payments'));
app.use('/api/analytics',   require('./backend/routes/analytics'));
app.use('/api/notifications', require('./backend/routes/notifications'));
app.use('/api/uploads',     require('./backend/routes/uploads'));
app.use('/api/otp',          require('./backend/routes/otp'));

// ============================================================
// EXAM PAGE
app.get("/exam", (req, res) => { res.sendFile(path.join(__dirname, "frontend", "exam.html")); });

// SPA FALLBACK — serve frontend for all non-API routes
// ============================================================
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    }
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🎓 School Management System running on port ${PORT}`);
    console.log(`📚 Frontend: http://localhost:${PORT}`);
    console.log(`🔌 API: http://localhost:${PORT}/api`);
});

module.exports = app;
// exam route already handled by static files
