// routes/reportRoutes.js
const express = require('express');
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth'); // Import auth middleware
const ROLES = require('../config/roles'); // Import ROLES

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Main dashboard summary endpoint (dynamically serves data based on user role)
router.get('/dashboard-summary', reportController.getDashboardSummary);

// Performance report for executives, team leads, and managers
// This combines daily/monthly calls, prospects, untouched data, sales.
router.get('/performance', reportController.getPerformanceReport);

// Manager Report specific details (e.g., Call Logs with update history)
// This might overlap with CallLog.getAllCallLogs but with specific filters/aggregations
router.get('/manager-calls', authMiddleware.restrictTo(ROLES.MANAGER), reportController.getManagerCallReport);

// Manager specific Last Update section (activity logs)
router.get('/activity-logs', authMiddleware.restrictTo(ROLES.MANAGER), reportController.getActivityLogs);


module.exports = router;