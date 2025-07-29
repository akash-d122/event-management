const { databaseManager } = require('../../database/config/database');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessLogicError,
  catchAsync
} = require('../middleware/errorHandler');
const logger = require('../utils/logger');

class EventController {
  constructor() {
    this.pool = null;
  }

  async initialize() {
    if (!this.pool) {
      await databaseManager.initialize();
      this.pool = databaseManager.getPool();
    }
  }

  // POST /api/events - Create event with capacity validation
  createEvent = catchAsync(async (req, res) => {
    await this.initialize();

    const { title, description, date_time, location, capacity } = req.body;
    const created_by = req.user.id; // From authentication middleware

    logger.logUserAction('create_event_attempt', created_by, {
      title,
      date_time,
      capacity,
      location
    });

    try {
      // Step 1: Validate input data (already done by middleware)

      // Step 2: Additional business logic validation
      const eventDate = new Date(date_time);
      const now = new Date();

      if (eventDate <= now) {
        throw new BusinessLogicError('Event date must be in the future');
      }

      // Step 3: Check for conflicting events (same user, overlapping time)
      const conflictCheckResult = await this.pool.query(`
        SELECT id, title, date_time
        FROM events
        WHERE created_by = $1
        AND is_active = true
        AND ABS(EXTRACT(EPOCH FROM (date_time - $2::timestamp))) < 3600
      `, [created_by, date_time]);

      if (conflictCheckResult.rows.length > 0) {
        const conflictingEvent = conflictCheckResult.rows[0];
        logger.logBusinessLogic('event_creation_conflict', {
          user_id: created_by,
          conflicting_event_id: conflictingEvent.id,
          conflicting_event_title: conflictingEvent.title
        });

        throw new ConflictError(
          `You have another event "${conflictingEvent.title}" scheduled within 1 hour of this time`
        );
      }

      // Step 4: Create the event using transaction
      const result = await this.pool.withTransaction(async (client) => {
        const insertResult = await client.query(`
          INSERT INTO events (title, description, date_time, location, capacity, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, title, description, date_time, location, capacity,
                   current_registrations, created_by, is_active, created_at, updated_at
        `, [title, description, date_time, location, capacity, created_by]);

        const event = insertResult.rows[0];

        // Log successful creation
        logger.logUserAction('create_event_success', created_by, {
          event_id: event.id,
          title: event.title,
          capacity: event.capacity,
          date_time: event.date_time
        });

        return event;
      });

      // Step 5: Return success response
      res.status(201).json({
        success: true,
        message: 'Event created successfully',
        data: {
          event: {
            ...result,
            available_spots: result.capacity - result.current_registrations,
            is_full: result.current_registrations >= result.capacity,
            time_until_event: this.calculateTimeUntilEvent(result.date_time)
          }
        }
      });

    } catch (error) {
      logger.logUserAction('create_event_error', created_by, {
        error: error.message,
        title,
        capacity
      });

      // Re-throw known errors, wrap unknown ones
      if (error instanceof ValidationError ||
          error instanceof ConflictError ||
          error instanceof BusinessLogicError) {
        throw error;
      }

      // Handle database constraint violations
      if (error.code === '23514') { // Check constraint violation
        if (error.constraint === 'events_valid_capacity') {
          throw new ValidationError('Capacity must be between 1 and 10000');
        }
        if (error.constraint === 'events_future_date') {
          throw new ValidationError('Event date must be in the future');
        }
      }

      logger.error('Unexpected error creating event:', error);
      throw new Error('Failed to create event. Please try again.');
    }
  });

  // GET /api/events/:id - Get event details with registered users
  getEventDetails = catchAsync(async (req, res) => {
    await this.initialize();

    const eventId = req.params.id;
    const requestingUserId = req.user?.id; // Optional authentication

    logger.logAPIRequest('GET', `/api/events/${eventId}`, null, null, requestingUserId);

    try {
      // Step 1: Validate event exists and get details
      const eventResult = await this.pool.query(`
        SELECT e.id, e.title, e.description, e.date_time, e.location, e.capacity,
               e.current_registrations, e.created_by, e.is_active, e.created_at, e.updated_at,
               u.name as creator_name, u.email as creator_email
        FROM events e
        JOIN users u ON e.created_by = u.id
        WHERE e.id = $1 AND e.is_active = true
      `, [eventId]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const event = eventResult.rows[0];

      // Step 2: Get registered users (with privacy considerations)
      let registeredUsers = [];
      const isOwner = requestingUserId === event.created_by;
      const isRegistered = requestingUserId ? await this.checkUserRegistration(eventId, requestingUserId) : false;

      if (isOwner || isRegistered) {
        // Full details for owner or registered users
        const usersResult = await this.pool.query(`
          SELECT u.id, u.name, u.email, r.registered_at, r.status
          FROM registrations r
          JOIN users u ON r.user_id = u.id
          WHERE r.event_id = $1 AND r.status = 'confirmed'
          ORDER BY r.registered_at ASC
        `, [eventId]);

        registeredUsers = usersResult.rows;
      } else {
        // Limited details for public view
        const countResult = await this.pool.query(`
          SELECT COUNT(*) as count
          FROM registrations
          WHERE event_id = $1 AND status = 'confirmed'
        `, [eventId]);

        registeredUsers = {
          count: parseInt(countResult.rows[0].count),
          details: 'Login to view registered users'
        };
      }

      // Step 3: Calculate additional metrics
      const eventStats = await this.calculateEventStats(eventId);

      // Step 4: Return comprehensive event details
      res.status(200).json({
        success: true,
        data: {
          event: {
            ...event,
            available_spots: event.capacity - event.current_registrations,
            is_full: event.current_registrations >= event.capacity,
            time_until_event: this.calculateTimeUntilEvent(event.date_time),
            has_started: new Date(event.date_time) <= new Date(),
            user_permissions: {
              can_edit: requestingUserId === event.created_by,
              can_register: requestingUserId && !isRegistered && !this.hasEventStarted(event.date_time),
              is_registered: isRegistered
            }
          },
          registered_users: registeredUsers,
          statistics: eventStats
        }
      });

    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error('Error getting event details:', error);
      throw new Error('Failed to retrieve event details');
    }
  });

  // POST /api/events/:id/register - Register user with all constraints
  registerForEvent = catchAsync(async (req, res) => {
    await this.initialize();

    const eventId = req.params.id;
    const userId = req.body.user_id || req.user.id; // Allow admin to register others
    const requestingUserId = req.user.id;

    logger.logUserAction('event_registration_attempt', requestingUserId, {
      event_id: eventId,
      target_user_id: userId
    });

    try {
      // Step 1: Validate input data (already done by middleware)

      // Step 2: Check if event exists and is not in the past
      const eventResult = await this.pool.query(`
        SELECT id, title, date_time, capacity, current_registrations, is_active, created_by
        FROM events
        WHERE id = $1 AND is_active = true
      `, [eventId]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const event = eventResult.rows[0];

      // Check if event is in the past
      if (new Date(event.date_time) <= new Date()) {
        throw new BusinessLogicError('Cannot register for past events');
      }

      // Step 3: Verify event capacity is not exceeded
      if (event.current_registrations >= event.capacity) {
        logger.logBusinessLogic('registration_capacity_exceeded', {
          event_id: eventId,
          user_id: userId,
          current_registrations: event.current_registrations,
          capacity: event.capacity
        });

        throw new BusinessLogicError('Event has reached maximum capacity');
      }

      // Step 4: Ensure user isn't already registered
      const existingRegistration = await this.pool.query(`
        SELECT id, status FROM registrations
        WHERE user_id = $1 AND event_id = $2
      `, [userId, eventId]);

      if (existingRegistration.rows.length > 0) {
        const registration = existingRegistration.rows[0];
        if (registration.status === 'confirmed') {
          throw new ConflictError('User is already registered for this event');
        } else if (registration.status === 'cancelled') {
          // Reactivate cancelled registration
          const reactivateResult = await this.pool.query(`
            UPDATE registrations
            SET status = 'confirmed', registered_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, registered_at
          `, [registration.id]);

          logger.logUserAction('event_registration_reactivated', requestingUserId, {
            event_id: eventId,
            user_id: userId,
            registration_id: registration.id
          });

          return res.status(200).json({
            success: true,
            message: 'Registration reactivated successfully',
            data: {
              registration: reactivateResult.rows[0],
              event: {
                id: event.id,
                title: event.title,
                available_spots: event.capacity - event.current_registrations - 1
              }
            }
          });
        }
      }

      // Step 5: Handle concurrent registration attempts using safe function
      const registrationResult = await this.pool.safeEventRegistration(userId, eventId);

      if (!registrationResult.success) {
        // Handle specific error cases
        if (registrationResult.error_code === 'P0003') {
          throw new ConflictError('User is already registered for this event');
        } else if (registrationResult.error_code === 'P0004') {
          throw new BusinessLogicError('Event has reached maximum capacity');
        } else if (registrationResult.error_code === 'P0002') {
          throw new BusinessLogicError('Cannot register for past events');
        } else {
          throw new Error(registrationResult.error_message || 'Registration failed');
        }
      }

      // Step 6: Log successful registration
      logger.logUserAction('event_registration_success', requestingUserId, {
        event_id: eventId,
        user_id: userId,
        registration_id: registrationResult.registration_id
      });

      // Step 7: Return appropriate response
      res.status(201).json({
        success: true,
        message: 'Successfully registered for event',
        data: {
          registration: {
            id: registrationResult.registration_id,
            user_id: userId,
            event_id: eventId,
            registered_at: registrationResult.registered_at,
            status: 'confirmed'
          },
          event: {
            id: event.id,
            title: event.title,
            current_registrations: event.current_registrations + 1,
            capacity: event.capacity,
            available_spots: event.capacity - event.current_registrations - 1
          }
        }
      });

    } catch (error) {
      logger.logUserAction('event_registration_error', requestingUserId, {
        event_id: eventId,
        user_id: userId,
        error: error.message
      });

      // Re-throw known errors
      if (error instanceof ValidationError ||
          error instanceof NotFoundError ||
          error instanceof ConflictError ||
          error instanceof BusinessLogicError) {
        throw error;
      }

      logger.error('Unexpected error during registration:', error);
      throw new Error('Registration failed. Please try again.');
    }
  });

  // DELETE /api/events/:id/register/:userId - Cancel registration
  cancelRegistration = catchAsync(async (req, res) => {
    await this.initialize();

    const eventId = req.params.id;
    const targetUserId = req.params.userId;
    const requestingUserId = req.user.id;

    logger.logUserAction('event_unregistration_attempt', requestingUserId, {
      event_id: eventId,
      target_user_id: targetUserId
    });

    try {
      // Step 1: Validate permissions (user can only cancel their own registration or admin)
      if (targetUserId != requestingUserId && !req.user.is_admin) {
        throw new BusinessLogicError('You can only cancel your own registration');
      }

      // Step 2: Check if event exists
      const eventResult = await this.pool.query(`
        SELECT id, title, date_time, is_active
        FROM events
        WHERE id = $1 AND is_active = true
      `, [eventId]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const event = eventResult.rows[0];

      // Step 3: Check if event is in the past
      if (new Date(event.date_time) <= new Date()) {
        throw new BusinessLogicError('Cannot cancel registration for past events');
      }

      // Step 4: Use safe unregistration function
      const unregistrationResult = await this.pool.safeEventUnregistration(targetUserId, eventId);

      if (!unregistrationResult.success) {
        if (unregistrationResult.error_code === 'P0005') {
          throw new NotFoundError('Registration not found');
        } else if (unregistrationResult.error_code === 'P0002') {
          throw new BusinessLogicError('Cannot cancel registration for past events');
        } else {
          throw new Error(unregistrationResult.error_message || 'Cancellation failed');
        }
      }

      // Step 5: Log successful cancellation
      logger.logUserAction('event_unregistration_success', requestingUserId, {
        event_id: eventId,
        target_user_id: targetUserId
      });

      // Step 6: Return success response
      res.status(200).json({
        success: true,
        message: 'Registration cancelled successfully',
        data: {
          event: {
            id: event.id,
            title: event.title
          },
          cancelled_at: unregistrationResult.unregistered_at
        }
      });

    } catch (error) {
      logger.logUserAction('event_unregistration_error', requestingUserId, {
        event_id: eventId,
        target_user_id: targetUserId,
        error: error.message
      });

      if (error instanceof ValidationError ||
          error instanceof NotFoundError ||
          error instanceof BusinessLogicError) {
        throw error;
      }

      logger.error('Unexpected error during unregistration:', error);
      throw new Error('Cancellation failed. Please try again.');
    }
  });

  // GET /api/events/upcoming - List future events with custom sorting
  getUpcomingEvents = catchAsync(async (req, res) => {
    await this.initialize();

    const {
      page = 1,
      limit = 10,
      search = '',
      location = '',
      min_capacity,
      max_capacity,
      date_from,
      date_to
    } = req.query;

    logger.logAPIRequest('GET', '/api/events/upcoming', null, null, req.user?.id);

    try {
      // Build dynamic WHERE clause
      const conditions = ['e.is_active = true', 'e.date_time > CURRENT_TIMESTAMP'];
      const values = [];
      let paramCount = 1;

      // Add search condition
      if (search) {
        conditions.push(`(
          to_tsvector('english', e.title || ' ' || COALESCE(e.description, '') || ' ' || COALESCE(e.location, ''))
          @@ plainto_tsquery('english', $${paramCount})
        )`);
        values.push(search);
        paramCount++;
      }

      // Add location filter
      if (location) {
        conditions.push(`e.location ILIKE $${paramCount}`);
        values.push(`%${location}%`);
        paramCount++;
      }

      // Add capacity filters
      if (min_capacity) {
        conditions.push(`e.capacity >= $${paramCount}`);
        values.push(min_capacity);
        paramCount++;
      }

      if (max_capacity) {
        conditions.push(`e.capacity <= $${paramCount}`);
        values.push(max_capacity);
        paramCount++;
      }

      // Add date range filters
      if (date_from) {
        conditions.push(`e.date_time >= $${paramCount}`);
        values.push(date_from);
        paramCount++;
      }

      if (date_to) {
        conditions.push(`e.date_time <= $${paramCount}`);
        values.push(date_to);
        paramCount++;
      }

      const whereClause = conditions.join(' AND ');

      // Calculate offset
      const offset = (page - 1) * limit;

      // Main query with pagination
      const eventsQuery = `
        SELECT e.id, e.title, e.description, e.date_time, e.location, e.capacity,
               e.current_registrations, e.created_by, e.created_at,
               u.name as creator_name,
               (e.capacity - e.current_registrations) as available_spots,
               (e.current_registrations >= e.capacity) as is_full
        FROM events e
        JOIN users u ON e.created_by = u.id
        WHERE ${whereClause}
        ORDER BY e.date_time ASC, e.location ASC NULLS LAST
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;

      values.push(limit, offset);

      // Count query for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM events e
        WHERE ${whereClause}
      `;

      const [eventsResult, countResult] = await Promise.all([
        this.pool.query(eventsQuery, values),
        this.pool.query(countQuery, values.slice(0, -2)) // Remove limit and offset
      ]);

      const events = eventsResult.rows.map(event => ({
        ...event,
        time_until_event: this.calculateTimeUntilEvent(event.date_time)
      }));

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          events,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_items: total,
            items_per_page: limit,
            has_next_page: page < totalPages,
            has_prev_page: page > 1
          },
          filters_applied: {
            search: search || null,
            location: location || null,
            min_capacity: min_capacity || null,
            max_capacity: max_capacity || null,
            date_from: date_from || null,
            date_to: date_to || null
          }
        }
      });

    } catch (error) {
      logger.error('Error getting upcoming events:', error);
      throw new Error('Failed to retrieve upcoming events');
    }
  });

  // GET /api/events/:id/stats - Return registration statistics
  getEventStats = catchAsync(async (req, res) => {
    await this.initialize();

    const eventId = req.params.id;
    const requestingUserId = req.user?.id;

    logger.logAPIRequest('GET', `/api/events/${eventId}/stats`, null, null, requestingUserId);

    try {
      // Step 1: Check if event exists
      const eventResult = await this.pool.query(`
        SELECT id, title, date_time, capacity, current_registrations, created_by, is_active
        FROM events
        WHERE id = $1 AND is_active = true
      `, [eventId]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const event = eventResult.rows[0];

      // Step 2: Get comprehensive statistics using database function
      const statsResult = await this.pool.getEventStats(eventId);

      // Step 3: Get registration timeline (hourly breakdown)
      const timelineResult = await this.pool.query(`
        SELECT
          DATE_TRUNC('hour', registered_at) as hour,
          COUNT(*) as registrations
        FROM registrations
        WHERE event_id = $1 AND status = 'confirmed'
        GROUP BY DATE_TRUNC('hour', registered_at)
        ORDER BY hour ASC
      `, [eventId]);

      // Step 4: Get registration status breakdown
      const statusBreakdownResult = await this.pool.query(`
        SELECT
          status,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
        FROM registrations
        WHERE event_id = $1
        GROUP BY status
        ORDER BY count DESC
      `, [eventId]);

      // Step 5: Calculate additional metrics
      const now = new Date();
      const eventDate = new Date(event.date_time);
      const timeUntilEvent = eventDate.getTime() - now.getTime();

      const registrationRate = event.current_registrations / event.capacity * 100;
      const isEventSoon = timeUntilEvent < 24 * 60 * 60 * 1000; // Less than 24 hours

      // Step 6: Get recent registrations (last 10)
      const recentRegistrationsResult = await this.pool.query(`
        SELECT u.name, r.registered_at
        FROM registrations r
        JOIN users u ON r.user_id = u.id
        WHERE r.event_id = $1 AND r.status = 'confirmed'
        ORDER BY r.registered_at DESC
        LIMIT 10
      `, [eventId]);

      // Step 7: Return comprehensive statistics
      res.status(200).json({
        success: true,
        data: {
          event: {
            id: event.id,
            title: event.title,
            date_time: event.date_time,
            capacity: event.capacity,
            current_registrations: event.current_registrations
          },
          statistics: {
            ...statsResult,
            registration_rate_percentage: Math.round(registrationRate * 100) / 100,
            is_event_soon: isEventSoon,
            time_until_event: this.calculateTimeUntilEvent(event.date_time),
            capacity_utilization: {
              used: event.current_registrations,
              available: event.capacity - event.current_registrations,
              percentage_full: registrationRate
            }
          },
          registration_timeline: timelineResult.rows,
          status_breakdown: statusBreakdownResult.rows,
          recent_registrations: recentRegistrationsResult.rows,
          generated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error('Error getting event statistics:', error);
      throw new Error('Failed to retrieve event statistics');
    }
  });

  // Helper method to check user registration
  async checkUserRegistration(eventId, userId) {
    const result = await this.pool.query(`
      SELECT 1 FROM registrations
      WHERE event_id = $1 AND user_id = $2 AND status = 'confirmed'
    `, [eventId, userId]);

    return result.rows.length > 0;
  }

  // Helper method to calculate event statistics
  async calculateEventStats(eventId) {
    const statsResult = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
        COUNT(*) FILTER (WHERE status = 'waitlist') as waitlist_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
        MIN(registered_at) as first_registration,
        MAX(registered_at) as latest_registration,
        AVG(EXTRACT(EPOCH FROM (registered_at - (SELECT created_at FROM events WHERE id = $1)))) as avg_registration_delay
      FROM registrations
      WHERE event_id = $1
    `, [eventId]);

    const stats = statsResult.rows[0];

    return {
      confirmed_registrations: parseInt(stats.confirmed_count) || 0,
      waitlist_registrations: parseInt(stats.waitlist_count) || 0,
      cancelled_registrations: parseInt(stats.cancelled_count) || 0,
      first_registration: stats.first_registration,
      latest_registration: stats.latest_registration,
      average_registration_delay_hours: stats.avg_registration_delay ?
        Math.round(stats.avg_registration_delay / 3600 * 100) / 100 : null
    };
  }

  // Helper method to calculate time until event
  calculateTimeUntilEvent(eventDateTime) {
    const now = new Date();
    const eventDate = new Date(eventDateTime);
    const diffMs = eventDate.getTime() - now.getTime();

    if (diffMs <= 0) {
      return { message: 'Event has started or passed', milliseconds: diffMs };
    }

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      message: `${days} days, ${hours} hours, ${minutes} minutes`,
      days,
      hours,
      minutes,
      milliseconds: diffMs
    };
  }

  // Helper method to check if event has started
  hasEventStarted(eventDateTime) {
    return new Date(eventDateTime) <= new Date();
  }
}

module.exports = new EventController();
