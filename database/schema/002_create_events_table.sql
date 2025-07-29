-- Migration: 002_create_events_table
-- Description: Create events table with proper constraints and validation
-- Created: 2024-01-01

-- Create events table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL CHECK (LENGTH(TRIM(title)) > 0),
    description TEXT,
    date_time TIMESTAMP WITH TIME ZONE NOT NULL,
    location VARCHAR(500),
    capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 1000),
    current_registrations INTEGER DEFAULT 0 CHECK (current_registrations >= 0),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Business logic constraints
    CONSTRAINT events_title_length CHECK (LENGTH(title) BETWEEN 1 AND 500),
    CONSTRAINT events_location_length CHECK (LENGTH(location) <= 500),
    CONSTRAINT events_description_length CHECK (LENGTH(description) <= 10000),
    CONSTRAINT events_future_date CHECK (date_time > CURRENT_TIMESTAMP),
    CONSTRAINT events_capacity_registrations CHECK (current_registrations <= capacity),
    CONSTRAINT events_valid_capacity CHECK (capacity BETWEEN 1 AND 1000)
);

-- Create indexes for events table
CREATE INDEX idx_events_date_time ON events(date_time);
CREATE INDEX idx_events_created_by ON events(created_by);
CREATE INDEX idx_events_location ON events(location);
CREATE INDEX idx_events_active ON events(is_active);
CREATE INDEX idx_events_capacity ON events(capacity);
CREATE INDEX idx_events_created_at ON events(created_at);

-- Composite indexes for common queries
CREATE INDEX idx_events_active_date ON events(is_active, date_time) WHERE is_active = true;
CREATE INDEX idx_events_location_date ON events(location, date_time) WHERE location IS NOT NULL;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to validate event date is in the future (for updates)
CREATE OR REPLACE FUNCTION validate_event_date()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow updates to past events only for certain fields
    IF OLD.date_time <= CURRENT_TIMESTAMP AND NEW.date_time != OLD.date_time THEN
        RAISE EXCEPTION 'Cannot change date/time of past events';
    END IF;
    
    -- Ensure new events are in the future
    IF NEW.date_time <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Event date/time must be in the future';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for date validation
CREATE TRIGGER trigger_events_date_validation
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION validate_event_date();

-- Add comments for documentation
COMMENT ON TABLE events IS 'Events that users can register for';
COMMENT ON COLUMN events.id IS 'Primary key, auto-incrementing event ID';
COMMENT ON COLUMN events.title IS 'Event title/name';
COMMENT ON COLUMN events.description IS 'Detailed event description';
COMMENT ON COLUMN events.date_time IS 'When the event takes place';
COMMENT ON COLUMN events.location IS 'Where the event takes place';
COMMENT ON COLUMN events.capacity IS 'Maximum number of registrations allowed';
COMMENT ON COLUMN events.current_registrations IS 'Current number of registered users';
COMMENT ON COLUMN events.created_by IS 'User who created this event';
COMMENT ON COLUMN events.is_active IS 'Whether the event is active/visible';
