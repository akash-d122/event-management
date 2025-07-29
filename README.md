# Event Management REST API

A comprehensive Event Management REST API built with Node.js, Express, and PostgreSQL. Features user registration, event creation and management, capacity limits, and custom sorting capabilities.

## Features

- **User Management**: Registration, authentication, and profile management
- **Event Management**: Create, read, update, and delete events
- **Capacity Management**: Set and enforce event capacity limits
- **Authentication**: JWT-based authentication system
- **Security**: Rate limiting, CORS, security headers, input validation
- **Testing**: Comprehensive test suite with Jest and Supertest
- **Logging**: Structured logging with Winston

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Authentication**: JWT, bcrypt
- **Testing**: Jest, Supertest
- **Security**: Helmet, CORS, express-rate-limit
- **Validation**: express-validator
- **Logging**: Winston, Morgan

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd event-management
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your PostgreSQL configuration
```

4. Set up PostgreSQL database:
```bash
# Create database
createdb event_management

# Initialize database tables
npm run setup-db
```

5. Run the application:
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The API will be available at `http://localhost:3000`

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## API Documentation

For detailed API documentation including request/response formats, authentication, and examples, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

### Quick Reference

**Base URL:** `http://localhost:3000/api`

**Authentication Endpoints:**
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get user profile (authenticated)
- `PUT /api/auth/profile` - Update user profile (authenticated)

**Event Endpoints:**
- `GET /api/events` - Get all events (with pagination and sorting)
- `GET /api/events/:id` - Get specific event
- `POST /api/events` - Create new event (authenticated)
- `PUT /api/events/:id` - Update event (authenticated, owner only)
- `DELETE /api/events/:id` - Delete event (authenticated, owner only)
- `POST /api/events/:id/register` - Register for event (authenticated)
- `DELETE /api/events/:id/unregister` - Unregister from event (authenticated)

**User Endpoints:**
- `GET /api/users/profile` - Get user profile (authenticated)
- `PUT /api/users/profile` - Update user profile (authenticated)
- `GET /api/users/events` - Get user's created events (authenticated)
- `GET /api/users/registrations` - Get user's event registrations (authenticated)

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Route controllers
├── middleware/      # Custom middleware
├── models/          # Database models
├── routes/          # API routes
├── utils/           # Utility functions
└── app.js          # Application entry point
tests/              # Test files
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

ISC
