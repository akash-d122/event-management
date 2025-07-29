const express = require('express');
const eventController = require('../controllers/eventController');
const { protect, optionalAuth } = require('../middleware/auth');
const {
  validateCreateEvent,
  validateEventId,
  validateUserId,
  validateRegistration,
  validateUpcomingEventsQuery
} = require('../middleware/eventValidation');

const router = express.Router();

// Public routes
router.get('/upcoming', validateUpcomingEventsQuery, eventController.getUpcomingEvents);
router.get('/:id', validateEventId, optionalAuth, eventController.getEventDetails);
router.get('/:id/stats', validateEventId, optionalAuth, eventController.getEventStats);

// Protected routes (require authentication)
router.use(protect);

// Event management
router.post('/', validateCreateEvent, eventController.createEvent);

// Event registration
router.post('/:id/register', validateRegistration, eventController.registerForEvent);
router.delete('/:id/register/:userId', validateEventId, validateUserId, eventController.cancelRegistration);

module.exports = router;
