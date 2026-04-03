// payments.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

router.post('/', authenticate, ctrl.create);
router.get('/enrollment/:enrollmentId', authenticate, ctrl.getByEnrollment);
router.post('/stripe/intent', authenticate, ctrl.createStripeIntent);
router.post('/stripe/webhook', express.raw({type:'application/json'}), ctrl.stripeWebhook);
router.post('/goldenpay/create', authenticate, ctrl.createGoldenPayOrder);
router.post('/goldenpay/callback', ctrl.goldenPayCallback);
router.post('/million/create', authenticate, ctrl.createMillionOrder);

module.exports = router;
