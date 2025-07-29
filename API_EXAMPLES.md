# API Usage Examples

## Authentication
First, you need to register and login to get a JWT token:

```bash
# Register a new user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com", "password": "password123"}'

# Login to get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com", "password": "password123"}'
```

## Event Management

### 1. Create Event
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Tech Conference 2024",
    "description": "Annual technology conference",
    "date_time": "2024-12-15T09:00:00Z",
    "location": "Convention Center",
    "capacity": 500
  }'
```

### 2. Get Event Details
```bash
curl http://localhost:3000/api/events/1
```

### 3. Register for Event
```bash
curl -X POST http://localhost:3000/api/events/1/register \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Cancel Registration
```bash
curl -X DELETE http://localhost:3000/api/events/1/register/123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. List Upcoming Events
```bash
curl http://localhost:3000/api/events/upcoming
```

### 6. Get Event Statistics
```bash
curl http://localhost:3000/api/events/1/stats
```

## Response Examples

### Event Creation Response
```json
{
  "success": true,
  "message": "Event created successfully",
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "description": "Annual technology conference",
      "date_time": "2024-12-15T09:00:00.000Z",
      "location": "Convention Center",
      "capacity": 500,
      "current_registrations": 0,
      "created_by": 1,
      "is_active": true,
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

### Event Statistics Response
```json
{
  "success": true,
  "data": {
    "event": {
      "id": 1,
      "title": "Tech Conference 2024",
      "capacity": 500,
      "current_registrations": 150
    },
    "statistics": {
      "total_registrations": 150,
      "remaining_capacity": 350,
      "percentage_used": 30.0
    }
  }
}
```

## Error Responses

### Validation Error
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "capacity",
      "message": "Capacity must be between 1 and 1000"
    }
  ]
}
```

### Business Logic Error
```json
{
  "success": false,
  "message": "Cannot register for past events"
}
```
