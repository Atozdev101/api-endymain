const express = require('express');
const router = express.Router();
const { assignMailboxes,
    assignExternalMailboxes,
    getUserMailbox,
    getMailboxPrice,
    purchaseMailbox,
    purchasePreWarmMailbox,
    getMailboxsByWallet,
    deleteMailbox,
    deleteMailboxes,
    bulkSetRecoveryEmail,
    exportOtherPlatform,
    exportMailboxes,
    editMailbox} = require('../controllers/mailboxController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');


router.get('/', authMiddleware, asyncHandler(getUserMailbox));
router.get('/pricing', asyncHandler(getMailboxPrice));
router.post('/assign',authMiddleware,asyncHandler(assignMailboxes));
router.post('/assignExternal', authMiddleware, asyncHandler(assignExternalMailboxes));
router.post('/purchase', authMiddleware, asyncHandler(purchaseMailbox));
router.post('/purchase-prewarmed', authMiddleware, asyncHandler(purchasePreWarmMailbox));
router.delete('/:mailboxId', authMiddleware, asyncHandler(deleteMailbox));
router.put('/:mailboxId', authMiddleware, asyncHandler(editMailbox));
router.post('/bulkDelete', authMiddleware, asyncHandler(deleteMailboxes));
router.post('/bulkSetRecoveryEmail', authMiddleware, asyncHandler(bulkSetRecoveryEmail));
router.post('/export/other-platform', authMiddleware, asyncHandler(exportOtherPlatform));
router.post('/export/csv', authMiddleware, asyncHandler(exportMailboxes));
router.post('/getMailboxsByWallet', authMiddleware, asyncHandler(getMailboxsByWallet));


module.exports = router;
