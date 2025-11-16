const express = require('express');
const router = express.Router(); 
const { getMyProfile,getRecentActivity,userUpdate,loginWithEmail,createUser} = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/profile', authMiddleware, asyncHandler(getMyProfile));
router.put('/update',authMiddleware,asyncHandler(userUpdate));
router.get('/recent_activity',authMiddleware,asyncHandler(getRecentActivity));
router.post('/loginWithEmail',asyncHandler(loginWithEmail));
router.post('/createUser',asyncHandler(createUser));
module.exports = router; 
