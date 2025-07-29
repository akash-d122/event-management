# Event Management API - Comprehensive Testing Guide

## Overview

This document provides a complete guide to the comprehensive testing suite for the Event Management API. The testing framework is designed to thoroughly validate business logic constraints, handle concurrent operations, and ensure data integrity.

## Testing Architecture

### Test Structure
```
tests/
├── setup/                    # Test configuration and setup
│   ├── globalSetup.js       # Database setup for all tests
│   ├── globalTeardown.js    # Cleanup after all tests
│   └── jest.setup.js        # Jest configuration and custom matchers
├── utils/                   # Test utilities and helpers
│   └── testHelpers.js       # Database helpers, user creation, validation
├── unit/                    # Unit tests for individual endpoints
│   └── eventController.test.js
├── integration/             # Integration tests for complete workflows
│   └── userRegistrationFlow.test.js
├── edge-cases/             # Edge cases and boundary value tests
│   └── businessLogicConstraints.test.js
├── concurrent/             # Concurrent operation tests
│   └── registrationConcurrency.test.js
└── coverage/               # Coverage reporting utilities
    └── coverageSetup.js
```

## Test Suites

### 1. Unit Tests (`tests/unit/`)
Tests individual API endpoints in isolation:

- **POST /api/events** - Event creation with validation
- **GET /api/events/:id** - Event details retrieval
- **POST /api/events/:id/register** - User registration
- **DELETE /api/events/:id/register/:userId** - Registration cancellation
- **GET /api/events/upcoming** - Event listing with filters
- **GET /api/events/:id/stats** - Event statistics

**Coverage:** Input validation, business logic, error handling, authentication

### 2. Integration Tests (`tests/integration/`)
Tests complete user workflows:

- **Complete Registration Workflow** - End-to-end event lifecycle
- **Cross-User Interactions** - Multi-user scenarios
- **Error Recovery** - Handling of partial failures
- **Data Consistency** - Verification across operations

**Coverage:** Multi-endpoint interactions, state management, user permissions

### 3. Edge Cases (`tests/edge-cases/`)
Tests boundary conditions and business constraints:

- **Full Event Scenarios** - Capacity limits (1, 10000, exact capacity)
- **Past Event Scenarios** - Time-based restrictions
- **Duplicate Registration** - Prevention and handling
- **Boundary Value Testing** - Min/max values for all fields
- **Data Consistency** - Database integrity under edge conditions

**Coverage:** Business rule enforcement, data validation, constraint handling

### 4. Concurrent Tests (`tests/concurrent/`)
Tests race conditions and concurrent operations:

- **Race Condition Prevention** - Multiple users, limited capacity
- **Deadlock Prevention** - Multi-event scenarios
- **Performance Under Load** - High-frequency operations
- **Data Integrity** - Consistency under concurrency

**Coverage:** Database locking, transaction handling, performance

## Running Tests

### Quick Start
```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:edge-cases
npm run test:concurrent
```

### Advanced Test Runner
```bash
# Use the comprehensive test runner
node scripts/run-tests.js --help

# Examples
node scripts/run-tests.js --suite unit --coverage
node scripts/run-tests.js --ci
node scripts/run-tests.js --watch --suite integration
```

### Test Runner Options
- `--suite <name>` - Run specific test suite
- `--coverage` - Generate coverage report
- `--watch` - Watch mode for development
- `--ci` - CI mode with JUnit output
- `--verbose` - Detailed output
- `--bail` - Stop on first failure
- `--parallel` - Parallel execution (use with caution for DB tests)

## Database Setup

### Test Database Configuration
Tests use a separate PostgreSQL database:

```bash
# Environment variables
TEST_DB_HOST=localhost
TEST_DB_PORT=5432
TEST_DB_USER=postgres
TEST_DB_PASSWORD=password
TEST_DB_NAME=event_management_test
```

### Automatic Setup
- Database is created/dropped automatically
- Migrations run before each test suite
- Data is cleaned between test files
- Transactions ensure isolation

## Coverage Reporting

### Coverage Thresholds
- **Statements:** 80% minimum, 90% target
- **Branches:** 80% minimum, 85% target for controllers
- **Functions:** 80% minimum, 90% target for controllers
- **Lines:** 80% minimum, 90% target for controllers

### Coverage Reports
- **HTML Report:** `coverage/html/index.html`
- **LCOV Report:** `coverage/lcov.info`
- **JSON Report:** `coverage/coverage-final.json`
- **Text Summary:** Console output

### Coverage Analysis
```bash
# Generate detailed coverage analysis
npm run test:coverage-report

# View HTML report
open coverage/html/index.html
```

## Business Logic Testing

### Key Constraints Tested

#### Event Creation
- ✅ Capacity limits (1-10,000)
- ✅ Date validation (1 hour to 1 year in future)
- ✅ Title length (1-500 characters)
- ✅ Description length (max 10,000 characters)
- ✅ Conflict prevention (same user, overlapping time)

#### Registration
- ✅ Capacity enforcement
- ✅ Duplicate prevention
- ✅ Past event restrictions
- ✅ User authentication
- ✅ Race condition handling

#### Cancellation
- ✅ Authorization (own registrations only)
- ✅ Past event restrictions
- ✅ Data consistency maintenance

### Concurrent Operation Testing

#### Race Conditions
- Multiple users registering for limited spots
- Simultaneous registration and cancellation
- High-frequency registration attempts
- Database connection pool limits

#### Data Integrity
- Referential integrity under concurrency
- Transaction isolation
- Deadlock prevention
- Consistency verification

## CI/CD Integration

### GitHub Actions Workflow
The CI/CD pipeline includes:

1. **Test Matrix** - Parallel execution of test suites
2. **Coverage Reporting** - Codecov integration
3. **Security Scanning** - Dependency audit, CodeQL
4. **Performance Testing** - Concurrent operation benchmarks
5. **Build Verification** - Production build testing

### Pipeline Stages
```yaml
test → coverage → security → performance → build → deploy
```

### Environment Setup
- PostgreSQL 15 service container
- Node.js 18.x
- Automatic database migration
- Environment variable configuration

## Test Utilities

### TestHelpers Class
Comprehensive utilities for test setup:

```javascript
// User management
await testHelpers.createTestUser(userData)
await testHelpers.createMultipleUsers(count)

// Event management
await testHelpers.createTestEvent(eventData, createdBy)
await testHelpers.createMultipleEvents(count, baseData)

// Registration management
await testHelpers.createRegistration(userId, eventId)
await testHelpers.fillEventToCapacity(eventId)

// Concurrent testing
await testHelpers.simulateConcurrentRegistrations(eventId, userCount)

// Validation helpers
testHelpers.expectValidEvent(event)
testHelpers.expectValidUser(user)
testHelpers.expectValidRegistration(registration)

// Database verification
await testHelpers.verifyDatabaseConsistency(eventId)
```

### Custom Jest Matchers
```javascript
expect(date).toBeValidDate()
expect(number).toBeWithinRange(min, max)
expect(pagination).toHaveValidPagination()
```

## Performance Benchmarks

### Target Performance Metrics
- **Single Registration:** < 100ms
- **Concurrent Registrations (10 users):** < 2 seconds
- **Event Listing (100 events):** < 200ms
- **Statistics Generation:** < 300ms

### Load Testing Scenarios
- 100 concurrent users registering for 50-capacity event
- 1000 users attempting registration for 1-capacity event
- Multiple events with simultaneous operations

## Debugging Tests

### Common Issues
1. **Database Connection Errors**
   - Check PostgreSQL is running
   - Verify connection parameters
   - Ensure test database exists

2. **Test Timeouts**
   - Increase Jest timeout (default: 30s)
   - Check for hanging database connections
   - Verify cleanup in afterEach/afterAll

3. **Race Condition Failures**
   - Tests may be order-dependent
   - Check database cleanup between tests
   - Verify transaction isolation

### Debug Commands
```bash
# Run single test file
npm test -- tests/unit/eventController.test.js

# Run with verbose output
npm test -- --verbose

# Run specific test
npm test -- --testNamePattern="should create event"

# Debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Contributing to Tests

### Adding New Tests
1. Follow existing test structure
2. Use testHelpers for setup
3. Include both success and error cases
4. Test edge cases and boundary values
5. Verify database consistency

### Test Naming Convention
```javascript
describe('Endpoint Name - Action', () => {
  it('should perform expected behavior with valid input', () => {})
  it('should reject invalid input with appropriate error', () => {})
  it('should handle edge case scenario', () => {})
})
```

### Best Practices
- ✅ Clean database state between tests
- ✅ Use descriptive test names
- ✅ Test both success and failure paths
- ✅ Verify database consistency
- ✅ Include performance considerations
- ✅ Mock external dependencies
- ✅ Use proper assertions

## Monitoring and Metrics

### Test Execution Metrics
- Test execution time
- Coverage percentages
- Failure rates
- Performance benchmarks

### Continuous Monitoring
- Daily automated test runs
- Coverage trend analysis
- Performance regression detection
- Security vulnerability scanning

---

## Quick Reference

### Essential Commands
```bash
# Development
npm run test:watch              # Watch mode
npm run test:unit              # Unit tests only
npm run test:coverage          # With coverage

# CI/CD
npm run test:ci                # CI mode
npm run security:audit         # Security scan
npm run lint                   # Code linting

# Analysis
npm run test:coverage-report   # Detailed coverage
node scripts/run-tests.js --help  # All options
```

### Key Files
- `jest.config.js` - Jest configuration
- `tests/setup/` - Test environment setup
- `tests/utils/testHelpers.js` - Test utilities
- `.github/workflows/ci.yml` - CI/CD pipeline
- `scripts/run-tests.js` - Advanced test runner

This comprehensive testing suite ensures the Event Management API is robust, reliable, and ready for production use.
