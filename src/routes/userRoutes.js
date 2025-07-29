const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { validateUserUpdate } = require('../middleware/validation');

const router = express.Router();

// All routes are protected (require authentication)
router.use(protect);

router.get('/profile', userController.getProfile);
router.put('/profile', validateUserUpdate, userController.updateProfile);
router.delete('/account', userController.deleteAccount);
router.get('/events', userController.getUserEvents);
router.get('/registrations', userController.getUserRegistrations);

module.exports = router;
