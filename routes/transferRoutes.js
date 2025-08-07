// routes/transferRoutes.js
const express = require('express');
const transferController = require('../controllers/transferController');
const authMiddleware = require('../middleware/auth');
const ROLES = require('../config/roles');

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// --- Internal Data Transfer ---
// Managers and Team Leads can transfer data (e.g., prospects, specific sales)
router.post('/internal', authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), transferController.transferInternalData);

// Get internal data transfer history
router.get('/internal-history', authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), transferController.getInternalTransferHistory);

// --- Transfer Data to Finance ---
// Only Managers can transfer sales data to finance
router.post('/finance', authMiddleware.restrictTo(ROLES.MANAGER), transferController.transferToFinance);

// Get finance transfer history
router.get('/finance-history', authMiddleware.restrictTo(ROLES.MANAGER), transferController.getFinanceTransferHistory);

module.exports = router;