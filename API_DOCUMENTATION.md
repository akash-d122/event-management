# Event Management API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Response Format
All API responses follow this format:
```json
{
  "status": "success" | "error",
  "message": "Optional message",
  "data": {
    // Response data
  },
  "pagination": {
    // Pagination info (for paginated endpoints)
  }
}
```

## Error Codes
- `400` - Bad Request (validation errors, invalid data)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limiting)
- `500` - Internal Server Error

## Endpoints

### Authentication

#### Register User
```http
POST /auth/register
```

**Request Body:**
```json
{
  "username": "string (3-50 chars, alphanumeric + underscore)",
  "email": "string (valid email)",
  "password": "string (min 8 chars, must contain uppercase, lowercase, number)",
  "first_name": "string (optional, 1-100 chars)",
  "last_name": "string (optional, 1-100 chars)"
}
```

**Response:**
```json
{
  "status": "success",
  "token": "jwt-token",
  "data": {
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "first_name": "Test",
      "last_name": "User",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### Login User
```http
POST /auth/login
```

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

#### Get Profile
```http
GET /auth/profile
```
*Requires authentication*

#### Update Profile
```http
PUT /auth/profile
```
*Requires authentication*

**Request Body:**
```json
{
  "username": "string (optional)",
  "email": "string (optional)",
  "first_name": "string (optional)",
  "last_name": "string (optional)"
}
```

#### Update Password
```http
PUT /auth/update-password
```
*Requires authentication*

**Request Body:**
```json
{
  "currentPassword": "string",
  "newPassword": "string"
}
```

### Events

#### Get All Events
```http
GET /events
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10, max: 100)
- `sortBy` - Sort field (start_date, end_date, title, capacity, current_registrations, created_at)
- `sortOrder` - Sort order (ASC, DESC)
- `search` - Search in title and description
- `startDate` - Filter events starting after this date (ISO 8601)
- `endDate` - Filter events ending before this date (ISO 8601)
- `location` - Filter by location (partial match)

**Response:**
```json
{
  "status": "success",
  "results": 10,
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 50,
    "itemsPerPage": 10,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "data": {
    "events": [
      {
        "id": 1,
        "title": "Event Title",
        "description": "Event description",
        "location": "Event location",
        "start_date": "2024-01-01T10:00:00.000Z",
        "end_date": "2024-01-01T12:00:00.000Z",
        "capacity": 100,
        "current_registrations": 25,
        "created_by": 1,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### Get Single Event
```http
GET /events/:id
```

**Response includes additional fields when authenticated:**
- `isUserRegistered` - Boolean indicating if current user is registered
- `isOwner` - Boolean indicating if current user owns the event

#### Create Event
```http
POST /events
```
*Requires authentication*

**Request Body:**
```json
{
  "title": "string (required, max 255 chars)",
  "description": "string (optional, max 5000 chars)",
  "location": "string (optional, max 255 chars)",
  "start_date": "string (required, ISO 8601, must be in future)",
  "end_date": "string (required, ISO 8601, must be after start_date)",
  "capacity": "number (required, 1-10000)"
}
```

#### Update Event
```http
PUT /events/:id
```
*Requires authentication and ownership*

**Request Body:** Same as create event, all fields optional

#### Delete Event
```http
DELETE /events/:id
```
*Requires authentication and ownership*

#### Register for Event
```http
POST /events/:id/register
```
*Requires authentication*

#### Unregister from Event
```http
DELETE /events/:id/unregister
```
*Requires authentication*

#### Get Event Registrations
```http
GET /events/:id/registrations
```
*Requires authentication and ownership*

**Response:**
```json
{
  "status": "success",
  "results": 5,
  "data": {
    "event": {
      "id": 1,
      "title": "Event Title",
      "capacity": 100,
      "current_registrations": 5
    },
    "registrations": [
      {
        "id": 1,
        "username": "user1",
        "email": "user1@example.com",
        "first_name": "User",
        "last_name": "One",
        "registered_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Users

#### Get User Profile
```http
GET /users/profile
```
*Requires authentication*

#### Update User Profile
```http
PUT /users/profile
```
*Requires authentication*

#### Delete User Account
```http
DELETE /users/account
```
*Requires authentication*

#### Get User's Events
```http
GET /users/events
```
*Requires authentication*

#### Get User's Registrations
```http
GET /users/registrations
```
*Requires authentication*

## Rate Limiting

- General API endpoints: 100 requests per 15 minutes per IP
- Authentication endpoints: 5 requests per 15 minutes per IP

## CORS

The API supports CORS for the following origins (configurable via environment):
- http://localhost:3000
- http://localhost:3001

## Security Features

- JWT authentication
- Password hashing with bcrypt
- Rate limiting
- CORS protection
- Security headers (Helmet.js)
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
