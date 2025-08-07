// routes/callLogRoutes.js
const express = require('express');
const callLogController = require('../controllers/callLogController');
const authMiddleware = require('../middleware/auth'); // Import auth middleware
const ROLES = require('../config/roles'); // Import ROLES

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Route to create a new call log
router.post('/', authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.SALES_EXECUTIVE), callLogController.createCallLog);

// Route to get all call logs (filtered by role)
router.get('/', callLogController.getAllCallLogs);

// Routes for specific call log actions (get one, update one)
router
    .route('/:id')
    .get(callLogController.getCallLog) // Access controlled inside controller
    .patch(callLogController.updateCallLog); // Access controlled inside controller


module.exports = router;