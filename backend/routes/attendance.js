const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/attendanceController');
const { authenticate } = require('../middleware/auth');

router.post('/', authenticate, ctrl.mark);
router.get('/enrollment/:enrollmentId', authenticate, ctrl.getByEnrollment);
router.get('/enrollment/:enrollmentId/progress', authenticate, ctrl.getProgress);
router.put('/:id', authenticate, ctrl.update);

module.exports = router;
