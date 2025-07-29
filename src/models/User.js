const { query } = require('../config/database');
const bcrypt = require('bcrypt');
const { ConflictError, NotFoundError } = require('../middleware/errorHandler');

class User {
  constructor(userData) {
    this.id = userData.id;
    this.username = userData.username;
    this.email = userData.email;
    this.password_hash = userData.password_hash;
    this.first_name = userData.first_name;
    this.last_name = userData.last_name;
    this.created_at = userData.created_at;
    this.updated_at = userData.updated_at;
  }

  // Create a new user
  static async create(userData) {
    const { username, email, password, first_name, last_name } = userData;
    
    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const sql = `
      INSERT INTO users (username, email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, email, first_name, last_name, created_at, updated_at
    `;
    
    const values = [username, email, password_hash, first_name, last_name];
    
    try {
      const result = await query(sql, values);
      return new User(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        if (error.constraint === 'users_email_key') {
          throw new ConflictError('Email address is already registered');
        }
        if (error.constraint === 'users_username_key') {
          throw new ConflictError('Username is already taken');
        }
      }
      throw error;
    }
  }

  // Find user by ID
  static async findById(id) {
    const sql = 'SELECT * FROM users WHERE id = $1';
    const result = await query(sql, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return new User(result.rows[0]);
  }

  // Find user by email
  static async findByEmail(email) {
    const sql = 'SELECT * FROM users WHERE email = $1';
    const result = await query(sql, [email]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return new User(result.rows[0]);
  }

  // Find user by username
  static async findByUsername(username) {
    const sql = 'SELECT * FROM users WHERE username = $1';
    const result = await query(sql, [username]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return new User(result.rows[0]);
  }

  // Verify password
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.password_hash);
  }

  // Update user profile
  async update(updateData) {
    const allowedFields = ['username', 'email', 'first_name', 'last_name'];
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
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, username, email, first_name, last_name, created_at, updated_at
    `;

    try {
      const result = await query(sql, values);
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      // Update current instance
      Object.assign(this, result.rows[0]);
      return this;
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        if (error.constraint === 'users_email_key') {
          throw new Error('Email already exists');
        }
        if (error.constraint === 'users_username_key') {
          throw new Error('Username already exists');
        }
      }
      throw error;
    }
  }

  // Update password
  async updatePassword(newPassword) {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(newPassword, saltRounds);

    const sql = 'UPDATE users SET password_hash = $1 WHERE id = $2';
    await query(sql, [password_hash, this.id]);
    
    this.password_hash = password_hash;
    return this;
  }

  // Delete user
  async delete() {
    const sql = 'DELETE FROM users WHERE id = $1';
    await query(sql, [this.id]);
  }

  // Get user's events
  async getEvents() {
    const sql = `
      SELECT e.* FROM events e
      WHERE e.created_by = $1
      ORDER BY e.start_date ASC
    `;
    const result = await query(sql, [this.id]);
    return result.rows;
  }

  // Get user's event registrations
  async getRegistrations() {
    const sql = `
      SELECT e.*, er.registered_at 
      FROM events e
      JOIN event_registrations er ON e.id = er.event_id
      WHERE er.user_id = $1
      ORDER BY e.start_date ASC
    `;
    const result = await query(sql, [this.id]);
    return result.rows;
  }

  // Convert to JSON (exclude sensitive data)
  toJSON() {
    const { password_hash, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }
}

module.exports = User;
