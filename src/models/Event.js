const { query, getClient } = require('../config/database');
const { ConflictError, BusinessLogicError, NotFoundError } = require('../middleware/errorHandler');

class Event {
  constructor(eventData) {
    this.id = eventData.id;
    this.title = eventData.title;
    this.description = eventData.description;
    this.location = eventData.location;
    this.start_date = eventData.start_date;
    this.end_date = eventData.end_date;
    this.capacity = eventData.capacity;
    this.current_registrations = eventData.current_registrations;
    this.created_by = eventData.created_by;
    this.created_at = eventData.created_at;
    this.updated_at = eventData.updated_at;
  }

  // Create a new event
  static async create(eventData) {
    const { title, description, location, start_date, end_date, capacity, created_by } = eventData;

    const sql = `
      INSERT INTO events (title, description, location, start_date, end_date, capacity, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [title, description, location, start_date, end_date, capacity, created_by];
    
    try {
      const result = await query(sql, values);
      return new Event(result.rows[0]);
    } catch (error) {
      throw error;
    }
  }

  // Find event by ID
  static async findById(id) {
    const sql = 'SELECT * FROM events WHERE id = $1';
    const result = await query(sql, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return new Event(result.rows[0]);
  }

  // Find all events with pagination and sorting
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'start_date',
      sortOrder = 'ASC',
      search = '',
      startDate = null,
      endDate = null,
      location = null
    } = options;

    const offset = (page - 1) * limit;
    const allowedSortFields = ['start_date', 'end_date', 'title', 'capacity', 'current_registrations', 'created_at'];
    const allowedSortOrders = ['ASC', 'DESC'];

    // Validate sort parameters
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'start_date';
    const validSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    // Build WHERE clause
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (search) {
      conditions.push(`(title ILIKE $${paramCount} OR description ILIKE $${paramCount})`);
      values.push(`%${search}%`);
      paramCount++;
    }

    if (startDate) {
      conditions.push(`start_date >= $${paramCount}`);
      values.push(startDate);
      paramCount++;
    }

    if (endDate) {
      conditions.push(`end_date <= $${paramCount}`);
      values.push(endDate);
      paramCount++;
    }

    if (location) {
      conditions.push(`location ILIKE $${paramCount}`);
      values.push(`%${location}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Main query
    const sql = `
      SELECT * FROM events
      ${whereClause}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    values.push(limit, offset);

    // Count query for pagination
    const countSql = `
      SELECT COUNT(*) as total FROM events
      ${whereClause}
    `;

    try {
      const [eventsResult, countResult] = await Promise.all([
        query(sql, values),
        query(countSql, values.slice(0, -2)) // Remove limit and offset for count
      ]);

      const events = eventsResult.rows.map(row => new Event(row));
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        events,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Update event
  async update(updateData) {
    const allowedFields = ['title', 'description', 'location', 'start_date', 'end_date', 'capacity'];
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic update query
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updates.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(this.id);
    const sql = `
      UPDATE events 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    try {
      const result = await query(sql, values);
      if (result.rows.length === 0) {
        throw new Error('Event not found');
      }
      
      // Update current instance
      Object.assign(this, result.rows[0]);
      return this;
    } catch (error) {
      throw error;
    }
  }

  // Delete event
  async delete() {
    const sql = 'DELETE FROM events WHERE id = $1';
    await query(sql, [this.id]);
  }

  // Register user for event with proper concurrency handling
  async registerUser(userId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Lock the event row to prevent concurrent modifications
      const lockEventSql = `
        SELECT id, title, start_date, capacity, current_registrations
        FROM events
        WHERE id = $1
        FOR UPDATE
      `;

      const eventResult = await client.query(lockEventSql, [this.id]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const eventData = eventResult.rows[0];

      // Check if event has already started
      if (new Date(eventData.start_date) <= new Date()) {
        throw new BusinessLogicError('Cannot register for an event that has already started');
      }

      // Check if event is at capacity
      if (eventData.current_registrations >= eventData.capacity) {
        throw new BusinessLogicError('Event is at full capacity');
      }

      // Check if user is already registered
      const checkRegistrationSql = `
        SELECT 1 FROM event_registrations
        WHERE user_id = $1 AND event_id = $2
      `;

      const existingRegistration = await client.query(checkRegistrationSql, [userId, this.id]);

      if (existingRegistration.rows.length > 0) {
        throw new ConflictError('User is already registered for this event');
      }

      // Insert registration
      const insertSql = `
        INSERT INTO event_registrations (user_id, event_id)
        VALUES ($1, $2)
        RETURNING *
      `;

      const result = await client.query(insertSql, [userId, this.id]);

      await client.query('COMMIT');

      // Refresh event data to get updated registration count
      const updatedEvent = await Event.findById(this.id);
      Object.assign(this, updatedEvent);

      return result.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Unregister user from event with proper concurrency handling
  async unregisterUser(userId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Lock the event row to prevent concurrent modifications
      const lockEventSql = `
        SELECT id, title, start_date
        FROM events
        WHERE id = $1
        FOR UPDATE
      `;

      const eventResult = await client.query(lockEventSql, [this.id]);

      if (eventResult.rows.length === 0) {
        throw new NotFoundError('Event');
      }

      const eventData = eventResult.rows[0];

      // Check if event has already started
      if (new Date(eventData.start_date) <= new Date()) {
        throw new BusinessLogicError('Cannot unregister from an event that has already started');
      }

      // Delete registration
      const deleteSql = 'DELETE FROM event_registrations WHERE user_id = $1 AND event_id = $2 RETURNING *';
      const result = await client.query(deleteSql, [userId, this.id]);

      if (result.rows.length === 0) {
        throw new BusinessLogicError('User is not registered for this event');
      }

      await client.query('COMMIT');

      // Refresh event data to get updated registration count
      const updatedEvent = await Event.findById(this.id);
      Object.assign(this, updatedEvent);

      return result.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get registered users for event
  async getRegisteredUsers() {
    const sql = `
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, er.registered_at
      FROM users u
      JOIN event_registrations er ON u.id = er.user_id
      WHERE er.event_id = $1
      ORDER BY er.registered_at ASC
    `;
    
    const result = await query(sql, [this.id]);
    return result.rows;
  }

  // Check if user is registered for event
  async isUserRegistered(userId) {
    const sql = 'SELECT 1 FROM event_registrations WHERE user_id = $1 AND event_id = $2';
    const result = await query(sql, [userId, this.id]);
    return result.rows.length > 0;
  }

  // Get available spots
  get availableSpots() {
    return this.capacity - this.current_registrations;
  }

  // Check if event is full
  get isFull() {
    return this.current_registrations >= this.capacity;
  }

  // Check if event has started
  get hasStarted() {
    return new Date(this.start_date) <= new Date();
  }

  // Check if event has ended
  get hasEnded() {
    return new Date(this.end_date) <= new Date();
  }
}

module.exports = Event;
