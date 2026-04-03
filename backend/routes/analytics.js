// analytics.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/admin', authenticate, authorize('admin'), ctrl.adminOverview);
router.get('/instructor/:id', authenticate, ctrl.instructorDashboard);
router.get('/student/:enrollmentId', authenticate, ctrl.studentProgress);
router.get('/referrals', authenticate, ctrl.referralStats);

module.exports = router;
