// routes/salesRoutes.js
const express = require('express');
const salesController = require('../controllers/salesController'); 
const authMiddleware = require('../middleware/auth'); // Import auth middleware
const ROLES = require('../config/roles'); // Import ROLES

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Routes for creating and listing sales
router
    .route('/')
    .post(authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.SALES_EXECUTIVE), salesController.createSale) // All roles who close can create
    .get(salesController.getAllSales); // Data will be filtered based on role inside controller

// Routes for specific sales actions (get one)
router
    .route('/:id')
    .get(salesController.getSale); // Access controlled inside controller

// For Manager and Team Lead to view aggregated sales reports
router.get('/', salesController.getAllSales);


module.exports = router;