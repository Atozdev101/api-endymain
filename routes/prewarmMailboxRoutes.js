const express = require('express');
const router = express.Router();
const { getUserPreWarmedMailboxes, exportOtherPlatforms, getAvailablePreWarmedMailboxes, purchaseDomainBasedPreWarmMailbox } = require('../controllers/prewarmMailboxController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/', authMiddleware, asyncHandler(getAvailablePreWarmedMailboxes));
router.get('/user', authMiddleware, asyncHandler(getUserPreWarmedMailboxes));
router.post('/export/other-platform', authMiddleware, asyncHandler(exportOtherPlatforms));
router.post('/purchase/domain-based', authMiddleware, asyncHandler(purchaseDomainBasedPreWarmMailbox));

module.exports = router;