const express = require('express');
const router = express.Router();
const { getWallet } = require('../controllers/walletController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/getWallet',authMiddleware,asyncHandler(getWallet));

module.exports = router;
