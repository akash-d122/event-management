const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const {
  validateUserRegistration,
  validateUserLogin,
  validateUserUpdate
} = require('../middleware/validation');

const router = express.Router();

// Public routes
router.post('/register', validateUserRegistration, authController.register);
router.post('/login', validateUserLogin, authController.login);

// Protected routes (require authentication)
router.use(protect); // All routes after this middleware are protected

router.get('/profile', authController.getProfile);
router.put('/profile', validateUserUpdate, authController.updateProfile);
router.put('/update-password', authController.updatePassword);
router.get('/my-events', authController.getUserEvents);
router.get('/my-registrations', authController.getUserRegistrations);

module.exports = router;
