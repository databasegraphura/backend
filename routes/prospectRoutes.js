// routes/prospectRoutes.js - CORRECTED ORDER

const express = require('express');
const prospectController = require('../controllers/prospectController');
const authMiddleware = require('../middleware/auth');
const ROLES = require('../config/roles');

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Specific route for untouched data (MUST BE BEFORE /:id)
router.get('/untouched', authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), prospectController.getUntouchedProspects);

// Routes for creating and listing prospects (general routes)
router
    .route('/')
    .post(authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), prospectController.createProspect)
    .get(prospectController.getAllProspects);

// Routes for specific prospect actions (get one, update one, delete one) - generic ID parameter
router
    .route('/:id') // This route should come AFTER all specific routes like /untouched
    .get(prospectController.getProspect)
    .patch(prospectController.updateProspect)
    .delete(authMiddleware.restrictTo(ROLES.MANAGER), prospectController.deleteProspect);

module.exports = router;