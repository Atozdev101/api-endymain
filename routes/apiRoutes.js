const express = require('express');
const router = express.Router();
const apiKeyMiddleware = require('../middlewares/apiKeyMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const {
  purchaseDomains,
  purchaseMailboxes,
  assignMailboxes,
  deleteMailboxes
} = require('../controllers/apiController');

/**
 * REST API Routes with API Key Authentication
 * All routes require X-API-Key header or Authorization: Bearer <api_key>
 */

// Domain purchase
router.post('/domains/purchase', apiKeyMiddleware, asyncHandler(purchaseDomains));

// Mailbox purchase
router.post('/mailboxes/purchase', apiKeyMiddleware, asyncHandler(purchaseMailboxes));

// Assign mailboxes
router.post('/mailboxes/assign', apiKeyMiddleware, asyncHandler(assignMailboxes));

// Delete mailboxes (single or bulk)
router.delete('/mailboxes/:mailboxId', apiKeyMiddleware, asyncHandler(deleteMailboxes));
router.post('/mailboxes/delete', apiKeyMiddleware, asyncHandler(deleteMailboxes));

module.exports = router;

