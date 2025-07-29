-- Migration: 005_performance_indexes
-- Description: Add strategic indexes for query optimization and performance
-- Created: 2024-01-01

-- Additional performance indexes for users table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_name_gin ON users USING gin(to_tsvector('english', name));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_created ON users(is_active, created_at) WHERE is_active = true;

-- Additional performance indexes for events table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_title_gin ON events USING gin(to_tsvector('english', title));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_description_gin ON events USING gin(to_tsvector('english', description));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_location_gin ON events USING gin(to_tsvector('english', location));

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_active_future ON events(is_active, date_time) 
    WHERE is_active = true AND date_time > CURRENT_TIMESTAMP;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_capacity_available ON events(capacity - current_registrations) 
    WHERE is_active = true AND date_time > CURRENT_TIMESTAMP;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_created_by_active ON events(created_by, is_active, date_time);

-- Partial indexes for specific use cases
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_upcoming ON events(date_time) 
    WHERE is_active = true AND date_time > CURRENT_TIMESTAMP;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_past ON events(date_time) 
    WHERE date_time <= CURRENT_TIMESTAMP;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_full_capacity ON events(id) 
    WHERE current_registrations >= capacity;

-- Additional indexes for registrations table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_user_recent ON registrations(user_id, registered_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_event_recent ON registrations(event_id, registered_at DESC);

-- Composite indexes for registration queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_user_event_status ON registrations(user_id, event_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_status_registered ON registrations(status, registered_at) 
    WHERE status = 'confirmed';

-- Covering indexes for common queries (include frequently accessed columns)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_list_covering ON events(date_time, is_active) 
    INCLUDE (id, title, location, capacity, current_registrations);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_user_covering ON registrations(user_id, status) 
    INCLUDE (event_id, registered_at);

-- Function-based indexes for search functionality
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_search_combined ON events 
    USING gin((
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(location, '')), 'C')
    ));

-- Indexes for date range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_date_range ON events(date_time, created_at) 
    WHERE is_active = true;

-- Indexes for analytics and reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_analytics ON registrations(registered_at, status) 
    INCLUDE (user_id, event_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_analytics ON events(created_at, is_active) 
    INCLUDE (id, created_by, capacity, current_registrations);

-- Hash indexes for exact match queries (PostgreSQL 10+)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_hash ON users USING hash(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_user_event_hash ON registrations USING hash((user_id, event_id));

-- Partial unique indexes for business logic
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_unique_active ON registrations(user_id, event_id) 
    WHERE status IN ('confirmed', 'waitlist');

-- Statistics and maintenance
-- Update table statistics for better query planning
ANALYZE users;
ANALYZE events;
ANALYZE registrations;

-- Create function to maintain index statistics
CREATE OR REPLACE FUNCTION update_table_statistics()
RETURNS void AS $$
BEGIN
    -- Update statistics for all tables
    ANALYZE users;
    ANALYZE events;
    ANALYZE registrations;
    
    -- Log the update
    RAISE NOTICE 'Table statistics updated at %', CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Create function to get index usage statistics
CREATE OR REPLACE FUNCTION get_index_usage_stats()
RETURNS TABLE(
    schemaname text,
    tablename text,
    indexname text,
    idx_scan bigint,
    idx_tup_read bigint,
    idx_tup_fetch bigint,
    usage_ratio numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::text,
        s.tablename::text,
        s.indexrelname::text,
        s.idx_scan,
        s.idx_tup_read,
        s.idx_tup_fetch,
        CASE 
            WHEN s.idx_scan = 0 THEN 0
            ELSE ROUND((s.idx_tup_read::numeric / s.idx_scan), 2)
        END as usage_ratio
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.schemaname = 'public'
    AND s.tablename IN ('users', 'events', 'registrations')
    ORDER BY s.idx_scan DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to identify unused indexes
CREATE OR REPLACE FUNCTION get_unused_indexes()
RETURNS TABLE(
    schemaname text,
    tablename text,
    indexname text,
    index_size text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::text,
        s.tablename::text,
        s.indexrelname::text,
        pg_size_pretty(pg_relation_size(s.indexrelid))::text as index_size
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.schemaname = 'public'
    AND s.tablename IN ('users', 'events', 'registrations')
    AND s.idx_scan = 0
    AND NOT i.indisunique  -- Don't include unique indexes
    ORDER BY pg_relation_size(s.indexrelid) DESC;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION update_table_statistics() IS 'Update statistics for all main tables to improve query planning';
COMMENT ON FUNCTION get_index_usage_stats() IS 'Get usage statistics for all indexes on main tables';
COMMENT ON FUNCTION get_unused_indexes() IS 'Identify potentially unused indexes that could be dropped';
