const express = require('express');
const router = express.Router();
const { checkDomainAvailability,getUserDomains,walletPurchase,connectDomain,recheckConnectDomain,clearConnectDomain,checkConnectDomain,addDomainRedirect } = require('../controllers/domainController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/check',authMiddleware,asyncHandler(checkDomainAvailability));
router.get('/',authMiddleware,asyncHandler(getUserDomains));
router.post('/wallet-purchase',authMiddleware,asyncHandler(walletPurchase));
router.post('/getDomainsByWallet',authMiddleware,asyncHandler(walletPurchase));
router.post('/connect-domain',authMiddleware,asyncHandler(connectDomain));
router.post('/clear-connect-domain',authMiddleware,asyncHandler(clearConnectDomain));
router.post('/recheck-connect-domain',authMiddleware,asyncHandler(recheckConnectDomain));
router.get('/check-connect-domain',authMiddleware,asyncHandler(checkConnectDomain));
router.post('/add-redirect', authMiddleware, asyncHandler(addDomainRedirect));

module.exports = router;
