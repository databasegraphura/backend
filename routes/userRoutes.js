// routes/userRoutes.js
const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth'); // Import the auth middleware

const router = express.Router();

// All routes after this middleware are protected
router.use(authMiddleware.protect);

// Route for a user to get their own profile
router
  .route('/getMe')
  .get(userController.getMe, userController.getUser);

// Create user (only manager and TL can access)
router.post(
  '/createUser',
  authMiddleware.restrictTo('manager', 'team_lead'),
  userController.createUser
);

// Get all users (Manager and TL only)
router
  .route('/')
  .get(
    authMiddleware.restrictTo('manager', 'team_lead'),
    userController.getAllUsers
  );

// Operations on specific user by ID
router
  .route('/:id')
  .get(userController.getUser) // Access logic handled inside controller
  .patch(userController.updateUser)
  .delete(
    authMiddleware.restrictTo('manager'),
    userController.deleteUser
  );

module.exports = router;
