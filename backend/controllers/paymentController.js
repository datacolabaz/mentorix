const db = require('../db');
const axios = require('axios');

// POST /api/payments — Record payment
exports.create = async (req, res) => {
    const { enrollment_id, amount, currency, payment_method, period_start_lesson,
            period_end_lesson, period_month, notes } = req.body;

    const { rows } = await db.query(`
        INSERT INTO payments (enrollment_id, amount, currency, payment_method,
            period_start_lesson, period_end_lesson, period_month, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8) RETURNING *
    `, [enrollment_id, amount, currency || 'AZN', payment_method || 'cash',
        period_start_lesson || null, period_end_lesson || null, period_month || null, notes]);

    // Reset lesson count after payment
    if (period_start_lesson && period_end_lesson) {
        await db.query(
            `UPDATE enrollments SET lesson_count = 0 WHERE id = $1`,
            [enrollment_id]
        );
    }

    res.status(201).json({ success: true, payment: rows[0] });
};

// GET /api/payments/enrollment/:enrollmentId
exports.getByEnrollment = async (req, res) => {
    const { rows } = await db.query(
        `SELECT * FROM payments WHERE enrollment_id = $1 ORDER BY created_at DESC`,
        [req.params.enrollmentId]
    );
    res.json({ success: true, payments: rows });
};

// ============================================================
// STRIPE ONLINE PAYMENT
// ============================================================
exports.createStripeIntent = async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { enrollment_id, amount, currency } = req.body;

    try {
        const intent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // in cents
            currency: currency || 'azn',
            metadata: { enrollment_id }
        });
        res.json({ success: true, client_secret: intent.client_secret });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.stripeWebhook = async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        await db.query(`
            INSERT INTO payments (enrollment_id, amount, currency, payment_method, status, transaction_id, payment_provider, paid_at)
            VALUES ($1, $2, $3, 'online', 'completed', $4, 'stripe', NOW())
        `, [intent.metadata.enrollment_id, intent.amount / 100, intent.currency.toUpperCase(), intent.id]);
        await db.query(`UPDATE enrollments SET lesson_count = 0 WHERE id = $1`, [intent.metadata.enrollment_id]);
    }
    res.json({ received: true });
};

// ============================================================
// GOLDENPAY (Azerbaijan)
// ============================================================
exports.createGoldenPayOrder = async (req, res) => {
    const { enrollment_id, amount } = req.body;
    const token = process.env.GOLDENPAY_TOKEN;

    try {
        const response = await axios.post('https://rest.goldenpay.az/web/service/merchant/payment', {
            paymentKey: token,
            merchantName: 'SchoolSystem',
            amount: Math.round(amount * 100),
            description: `Lesson payment for enrollment ${enrollment_id}`,
            redirectUrl: `${process.env.FRONTEND_URL}/payment/success?enrollment_id=${enrollment_id}`,
            lang: 'az'
        });

        res.json({ success: true, paymentUrl: response.data.paymentUrl, orderId: response.data.orderId });
    } catch (err) {
        res.status(500).json({ success: false, message: 'GoldenPay error: ' + err.message });
    }
};

exports.goldenPayCallback = async (req, res) => {
    const { paymentKey, status, orderId, amount } = req.body;
    if (status === '1' && paymentKey === process.env.GOLDENPAY_TOKEN) {
        // Payment successful — find enrollment from orderId metadata
        // In real implementation, store order-to-enrollment mapping
        console.log('GoldenPay success:', orderId);
    }
    res.json({ status: 'ok' });
};

// ============================================================
// MILLION CARD (Azerbaijan)
// ============================================================
exports.createMillionOrder = async (req, res) => {
    const { enrollment_id, amount } = req.body;
    // MilliÖN API integration template
    // Docs: https://million.az/developers
    try {
        const payload = {
            merchant_id: process.env.MILLION_MERCHANT_ID,
            amount: amount,
            currency: 'AZN',
            order_id: `SCH-${enrollment_id}-${Date.now()}`,
            description: 'Lesson payment',
            return_url: `${process.env.FRONTEND_URL}/payment/success`
        };
        // Signature generation (per MilliÖN docs)
        const crypto = require('crypto');
        const signString = `${payload.merchant_id}${payload.amount}${payload.order_id}${process.env.MILLION_SECRET_KEY}`;
        payload.sign = crypto.createHash('md5').update(signString).digest('hex');

        // POST to MilliÖN API
        const resp = await axios.post('https://api.million.az/payment/create', payload);
        res.json({ success: true, paymentUrl: resp.data.payment_url });
    } catch (err) {
        res.status(500).json({ success: false, message: 'MilliÖN error: ' + err.message });
    }
};
