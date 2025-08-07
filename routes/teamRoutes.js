// routes/teamRoutes.js
const express = require('express');
const teamController = require('../controllers/teamController');
const authMiddleware = require('../middleware/auth');
const ROLES = require('../config/roles');

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Manager specific: Create new teams, Get all teams
router
    .route('/')
    .post(authMiddleware.restrictTo(ROLES.MANAGER), teamController.createTeam) // Only Manager can create a new team
    .get(authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), teamController.getAllTeams); // Manager sees all, TL sees their own

// Manager specific: Get, Update, Delete a specific team
router
    .route('/:id')
    .get(authMiddleware.restrictTo(ROLES.MANAGER, ROLES.TEAM_LEAD), teamController.getTeam) // Manager gets any, TL gets their own
    .patch(authMiddleware.restrictTo(ROLES.MANAGER), teamController.updateTeam) // Only Manager can update team details
    .delete(authMiddleware.restrictTo(ROLES.MANAGER), teamController.deleteTeam); // Only Manager can delete a team

module.exports = router;