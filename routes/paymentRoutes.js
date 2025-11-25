const express = require('express');
const router = express.Router();
const {
  createDomainPaymentIntent,
  createtopUpWalletPaymentIntent,
  getTransactionBySessionId,
  attachPaymentMethod,
  getPaymentMethods,
  deletePaymentMethod
} = require('../controllers/paymentController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.post('/createPaymentIntent', authMiddleware, asyncHandler(createDomainPaymentIntent));
router.post('/createtopUpWalletPaymentIntent', authMiddleware, asyncHandler(createtopUpWalletPaymentIntent));
router.get('/success', asyncHandler(getTransactionBySessionId));

// Payment method management endpoints
router.post('/attach-payment-method', authMiddleware, asyncHandler(attachPaymentMethod));
router.get('/payment-methods', authMiddleware, asyncHandler(getPaymentMethods));
router.delete('/payment-methods/:payment_method_id', authMiddleware, asyncHandler(deletePaymentMethod));

module.exports = router;
