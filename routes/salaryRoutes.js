// routes/salaryRoutes.js
const express = require('express');
const salaryController = require('../controllers/salaryController');
const authMiddleware = require('../middleware/auth');
const ROLES = require('../config/roles');

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Only Managers can access salary information
router.use(authMiddleware.restrictTo(ROLES.MANAGER));

// Route to get all payout records
router.get('/', salaryController.getAllPayouts);

// Route to get a specific payout record (optional)
router.get('/:id', salaryController.getPayout);

// Route to create a payout record (if manually entered by manager)
router.post('/', salaryController.createPayout);

// Route to update a payout record (if corrections are needed)
router.patch('/:id', salaryController.updatePayout);

// Route to delete a payout record (if mistake, usually restricted)
router.delete('/:id', salaryController.deletePayout);


module.exports = router;