# Event Management API

A REST API for managing events and user registrations. Built this to handle event creation, user registration, and capacity management with PostgreSQL as the backend.

## Features

- Create and manage events with capacity limits (max 1000 per event)
- User registration system with duplicate prevention
- Event capacity enforcement to prevent overbooking
- List upcoming events with custom sorting (by date, then location)
- Event statistics and analytics
- Business logic constraints for registration rules

## Tech Stack

- Node.js & Express.js
- PostgreSQL database
- JWT authentication
- Jest for testing

## API Endpoints

The API provides 6 main endpoints as required:

1. **POST /api/events** - Create a new event
2. **GET /api/events/:id** - Get event details with registered users
3. **POST /api/events/:id/register** - Register user for an event
4. **DELETE /api/events/:id/register/:userId** - Cancel user registration
5. **GET /api/events/upcoming** - List future events (sorted by date, then location)
6. **GET /api/events/:id/stats** - Get event statistics

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 13+

### Installation

1. Clone and install dependencies:
```bash
git clone <repository-url>
cd event-management-api
npm install
```

2. Create `.env` file:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=event_management
DB_USER=your_username
DB_PASSWORD=your_password
PORT=3000
JWT_SECRET=your-secret-key
```

3. Setup database:
```bash
npm run setup-db
npm run migrate:up
```

4. Start the server:
```bash
npm run dev  # development
npm start    # production
```

Server runs at `http://localhost:3000`

## Database Schema

The system uses three main tables:

**Users** - Basic user information
- id, name, email, password_hash, created_at

**Events** - Event details with capacity limits
- id, title, description, date_time, location, capacity (max 1000), created_by

**Registrations** - Many-to-many relationship between users and events
- user_id, event_id, registered_at, status

## Business Logic

Key constraints implemented:
- Events have capacity limits (1-1000 users)
- No duplicate registrations allowed
- Can't register for past events
- Custom sorting: upcoming events by date ascending, then location alphabetically
- Registration/cancellation only for future events

## Testing

```bash
npm test  # Run basic tests
```

## Project Structure

```
src/
├── controllers/     # API endpoint logic
├── middleware/      # Validation and auth
├── routes/          # Route definitions
├── config/          # Database config
└── app.js          # Main application
database/
├── schema/          # SQL table definitions
└── config/          # DB connection setup
```
