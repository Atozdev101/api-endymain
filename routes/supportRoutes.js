const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

// Create new support ticket
router.post('/newTk', authMiddleware, asyncHandler(supportController.createSupportTicket));

// Get user's support tickets
router.get('/tickets/:user_id', authMiddleware, asyncHandler(supportController.getUserTickets));

// Get specific ticket with messages
router.get('/ticket/:ticket_id', authMiddleware, asyncHandler(supportController.getTicketWithMessages));

// Add message to ticket
router.post('/message', authMiddleware, asyncHandler(supportController.addTicketMessage));

module.exports = router; 
