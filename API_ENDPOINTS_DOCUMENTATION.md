# Event Management API - Endpoint Documentation

## Overview
This document provides comprehensive documentation for all 6 implemented REST API endpoints with detailed request/response examples, validation rules, and error handling.

## Base URL
```
http://localhost:3000/api
```

## Authentication
All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

---

## 1. POST /api/events - Create Event

Creates a new event with capacity validation and business rule enforcement.

### Request
```http
POST /api/events
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Tech Conference 2024",
  "description": "Annual technology conference featuring the latest innovations",
  "date_time": "2024-08-15T09:00:00.000Z",
  "location": "Convention Center, Downtown",
  "capacity": 500
}
```

### Validation Rules
- **title**: 1-500 characters, alphanumeric with basic punctuation
- **description**: Optional, max 10,000 characters
- **date_time**: ISO 8601 format, must be 1+ hours in future, max 1 year ahead
- **location**: Optional, max 500 characters
- **capacity**: Integer between 1 and 10,000

### Success Response (201)
```json
{
  "success": true,
  "message": "Event created successfully",
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "description": "Annual technology conference...",
      "date_time": "2024-08-15T09:00:00.000Z",
      "location": "Convention Center, Downtown",
      "capacity": 500,
      "current_registrations": 0,
      "created_by": 1,
      "is_active": true,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "available_spots": 500,
      "is_full": false,
      "time_until_event": {
        "message": "213 days, 22 hours, 30 minutes",
        "days": 213,
        "hours": 22,
        "minutes": 30,
        "milliseconds": 18468600000
      }
    }
  }
}
```

### Error Responses
- **400**: Validation errors, past date, invalid capacity
- **401**: Authentication required
- **409**: Conflicting event (same user, overlapping time within 1 hour)

---

## 2. GET /api/events/:id - Get Event Details

Retrieves comprehensive event information with registered users (privacy-aware).

### Request
```http
GET /api/events/1
Authorization: Bearer <token> (optional)
```

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "description": "Annual technology conference...",
      "date_time": "2024-08-15T09:00:00.000Z",
      "location": "Convention Center, Downtown",
      "capacity": 500,
      "current_registrations": 25,
      "created_by": 1,
      "creator_name": "John Doe",
      "creator_email": "john@example.com",
      "available_spots": 475,
      "is_full": false,
      "time_until_event": { /* time calculation */ },
      "has_started": false,
      "user_permissions": {
        "can_edit": true,
        "can_register": false,
        "is_registered": false
      }
    },
    "registered_users": [
      {
        "id": 2,
        "name": "Jane Smith",
        "email": "jane@example.com",
        "registered_at": "2024-01-10T14:20:00.000Z",
        "status": "confirmed"
      }
    ],
    "statistics": {
      "confirmed_registrations": 25,
      "waitlist_registrations": 0,
      "cancelled_registrations": 3,
      "first_registration": "2024-01-05T09:15:00.000Z",
      "latest_registration": "2024-01-14T16:45:00.000Z",
      "average_registration_delay_hours": 48.5
    }
  }
}
```

### Privacy Rules
- **Public users**: See registration count only
- **Registered users**: See all registered users
- **Event owner**: See all registered users with full details

### Error Responses
- **404**: Event not found
- **400**: Invalid event ID format

---

## 3. POST /api/events/:id/register - Register for Event

Registers the authenticated user for an event with comprehensive validation and race condition prevention.

### Request
```http
POST /api/events/1/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": 2  // Optional: admin can register others
}
```

### Validation Steps
1. **Input validation**: Event ID format, user permissions
2. **Event existence**: Verify event exists and is active
3. **Date validation**: Ensure event is in the future
4. **Capacity check**: Verify available spots
5. **Duplicate prevention**: Check existing registration
6. **Concurrent handling**: Use database locking

### Success Response (201)
```json
{
  "success": true,
  "message": "Successfully registered for event",
  "data": {
    "registration": {
      "id": 15,
      "user_id": 2,
      "event_id": 1,
      "registered_at": "2024-01-15T11:30:00.000Z",
      "status": "confirmed"
    },
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "current_registrations": 26,
      "capacity": 500,
      "available_spots": 474
    }
  }
}
```

### Error Responses
- **400**: Past event, capacity exceeded, business logic violations
- **401**: Authentication required
- **404**: Event not found
- **409**: User already registered

---

## 4. DELETE /api/events/:id/register/:userId - Cancel Registration

Cancels a user's registration for an event with proper authorization checks.

### Request
```http
DELETE /api/events/1/register/2
Authorization: Bearer <token>
```

### Authorization Rules
- Users can only cancel their own registrations
- Admins can cancel any registration
- Cannot cancel for past events

### Success Response (200)
```json
{
  "success": true,
  "message": "Registration cancelled successfully",
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024"
    },
    "cancelled_at": "2024-01-15T12:00:00.000Z"
  }
}
```

### Error Responses
- **400**: Past event, permission denied
- **401**: Authentication required
- **404**: Registration not found

---

## 5. GET /api/events/upcoming - List Future Events

Retrieves paginated list of upcoming events with advanced filtering and sorting.

### Request
```http
GET /api/events/upcoming?page=1&limit=10&sort_by=date_time&sort_order=ASC&search=tech&location=downtown&min_capacity=100&max_capacity=1000&date_from=2024-01-01&date_to=2024-12-31
```

### Query Parameters
- **page**: Page number (default: 1)
- **limit**: Items per page (1-100, default: 10)
- **sort_by**: Field to sort by (date_time, title, capacity, current_registrations, created_at)
- **sort_order**: ASC or DESC (default: ASC)
- **search**: Full-text search in title, description, location
- **location**: Filter by location (partial match)
- **min_capacity**: Minimum event capacity
- **max_capacity**: Maximum event capacity
- **date_from**: Events starting after this date
- **date_to**: Events starting before this date

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": 1,
        "title": "Tech Conference 2024",
        "description": "Annual technology conference...",
        "date_time": "2024-08-15T09:00:00.000Z",
        "location": "Convention Center, Downtown",
        "capacity": 500,
        "current_registrations": 25,
        "created_by": 1,
        "creator_name": "John Doe",
        "available_spots": 475,
        "is_full": false,
        "time_until_event": { /* time calculation */ }
      }
    ],
    "pagination": {
      "current_page": 1,
      "total_pages": 5,
      "total_items": 47,
      "items_per_page": 10,
      "has_next_page": true,
      "has_prev_page": false
    },
    "filters_applied": {
      "search": "tech",
      "location": "downtown",
      "min_capacity": 100,
      "max_capacity": 1000,
      "date_from": "2024-01-01",
      "date_to": "2024-12-31"
    }
  }
}
```

### Error Responses
- **400**: Invalid query parameters, invalid date ranges

---

## 6. GET /api/events/:id/stats - Get Event Statistics

Returns comprehensive registration statistics and analytics for an event.

### Request
```http
GET /api/events/1/stats
Authorization: Bearer <token> (optional)
```

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "date_time": "2024-08-15T09:00:00.000Z",
      "capacity": 500,
      "current_registrations": 25
    },
    "statistics": {
      "confirmed_registrations": 25,
      "waitlist_registrations": 0,
      "cancelled_registrations": 3,
      "first_registration": "2024-01-05T09:15:00.000Z",
      "latest_registration": "2024-01-14T16:45:00.000Z",
      "average_registration_delay_hours": 48.5,
      "registration_rate_percentage": 5.0,
      "is_event_soon": false,
      "time_until_event": { /* time calculation */ },
      "capacity_utilization": {
        "used": 25,
        "available": 475,
        "percentage_full": 5.0
      }
    },
    "registration_timeline": [
      {
        "hour": "2024-01-05T09:00:00.000Z",
        "registrations": 5
      },
      {
        "hour": "2024-01-05T10:00:00.000Z",
        "registrations": 3
      }
    ],
    "status_breakdown": [
      {
        "status": "confirmed",
        "count": 25,
        "percentage": 89.29
      },
      {
        "status": "cancelled",
        "count": 3,
        "percentage": 10.71
      }
    ],
    "recent_registrations": [
      {
        "name": "Jane Smith",
        "registered_at": "2024-01-14T16:45:00.000Z"
      }
    ],
    "generated_at": "2024-01-15T12:30:00.000Z"
  }
}
```

### Error Responses
- **404**: Event not found
- **400**: Invalid event ID format

---

## Error Handling

### Standard Error Response Format
```json
{
  "success": false,
  "message": "Detailed error description",
  "error_code": "VALIDATION_ERROR", // Optional
  "details": { /* Additional error context */ } // Optional
}
```

### HTTP Status Codes
- **200**: Success
- **201**: Created successfully
- **400**: Bad request (validation errors, business logic violations)
- **401**: Unauthorized (authentication required)
- **403**: Forbidden (insufficient permissions)
- **404**: Not found
- **409**: Conflict (duplicate registration, scheduling conflicts)
- **429**: Too many requests (rate limiting)
- **500**: Internal server error

### Rate Limiting
- General endpoints: 100 requests per 15 minutes per IP
- Authentication endpoints: 5 requests per 15 minutes per IP

## Testing

### Running Tests
```bash
# Run all endpoint tests
npm run test:endpoints

# Run edge case tests
npm run test:edge-cases

# Run complete workflow tests
npm run test:workflow

# Run all integration tests
npm run test:integration

# Run with coverage
npm run test:coverage
```

### Test Coverage
- ✅ All success scenarios
- ✅ All error conditions
- ✅ Edge cases and boundary values
- ✅ Concurrent operations
- ✅ Security validations
- ✅ Complete workflow integration
