const express = require('express');
const router = express.Router();
const {
    getInvoice,
    customerPortal,
    getAddonSubscription,
    getCurrentSubscription,
    changePlan,
    cancelStripeSubscription,
    getSubscriptionByWallet,
    createStripeSubscription,
} = require('../controllers/subscriptionController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/getAddon', authMiddleware, asyncHandler(getAddonSubscription));
router.get('/current', authMiddleware, asyncHandler(getCurrentSubscription));
router.get('/invoice', authMiddleware, asyncHandler(getInvoice));
router.post('/getSubscriptionByWallet', authMiddleware, asyncHandler(getSubscriptionByWallet));
router.post('/change-plan', authMiddleware, asyncHandler(changePlan));
router.post('/customer-portal', authMiddleware, asyncHandler(customerPortal));
router.post('/cancel', authMiddleware, asyncHandler(cancelStripeSubscription));
router.post('/create-subscription', authMiddleware, asyncHandler(createStripeSubscription));

module.exports = router;
