const jwt = require('jsonwebtoken');
const db = require('../db');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Fetch user
        const { rows } = await db.query(
            'SELECT id, full_name, email, role, is_active FROM users WHERE id = $1',
            [decoded.userId]
        );
        if (!rows[0] || !rows[0].is_active) {
            return res.status(401).json({ success: false, message: 'User not found or inactive' });
        }
        req.user = rows[0];
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

// Role-based access control
const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    next();
};

module.exports = { authenticate, authorize };
