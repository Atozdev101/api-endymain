const express = require('express');
const router = express.Router();
const {
  createDomainPaymentIntent,
  createtopUpWalletPaymentIntent,
  getTransactionBySessionId
} = require('../controllers/paymentController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.post('/createPaymentIntent', authMiddleware, asyncHandler(createDomainPaymentIntent));
router.post('/createtopUpWalletPaymentIntent', authMiddleware, asyncHandler(createtopUpWalletPaymentIntent));
router.get('/success', asyncHandler(getTransactionBySessionId));

module.exports = router;
