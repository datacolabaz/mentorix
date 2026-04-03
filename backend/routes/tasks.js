// tasks.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/taskController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, ctrl.getAll);
router.post('/', authenticate, authorize('instructor'), ctrl.create);
router.put('/:id', authenticate, authorize('instructor'), ctrl.update);
router.get('/student', authenticate, authorize('student'), ctrl.getStudentTasks);
router.post('/:id/submit', authenticate, authorize('student'), ctrl.submit);
router.put('/submissions/:id/grade', authenticate, authorize('instructor'), ctrl.grade);

module.exports = router;
