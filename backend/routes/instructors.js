const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/instructorController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('admin'), ctrl.getAll);
router.get('/:id', authenticate, ctrl.getOne);
router.put('/:id', authenticate, ctrl.update);
router.post('/:id/features', authenticate, authorize('admin'), ctrl.toggleFeature);
router.get('/:id/students', authenticate, ctrl.getStudents);
router.get('/:id/schedule', authenticate, ctrl.getSchedule);
router.post('/:id/schedule', authenticate, authorize('admin', 'instructor'), ctrl.addSchedule);

module.exports = router;
