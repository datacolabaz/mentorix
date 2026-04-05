// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', ctrl.login);
router.post('/register', authenticate, ctrl.register); // only authenticated (admin)
router.get('/me', authenticate, ctrl.me);
router.put('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
router.post('/create-parent', authenticate, require('../controllers/authController').createParent);
