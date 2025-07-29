-- Migration: 003_create_registrations_table
-- Description: Create registrations junction table with proper constraints
-- Created: 2024-01-01

-- Create registrations junction table
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'waitlist')),
    
    -- Ensure unique registration per user per event
    CONSTRAINT unique_user_event_registration UNIQUE (user_id, event_id)
);

-- Create indexes for registrations table
CREATE INDEX idx_registrations_user_id ON registrations(user_id);
CREATE INDEX idx_registrations_event_id ON registrations(event_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_registered_at ON registrations(registered_at);

-- Composite indexes for common queries
CREATE INDEX idx_registrations_user_status ON registrations(user_id, status);
CREATE INDEX idx_registrations_event_status ON registrations(event_id, status);
CREATE INDEX idx_registrations_event_registered_at ON registrations(event_id, registered_at);

-- Function to update event registration count
CREATE OR REPLACE FUNCTION update_event_registration_count()
RETURNS TRIGGER AS $$
DECLARE
    event_capacity INTEGER;
    current_count INTEGER;
BEGIN
    -- Handle INSERT
    IF TG_OP = 'INSERT' THEN
        -- Get event capacity
        SELECT capacity INTO event_capacity 
        FROM events 
        WHERE id = NEW.event_id;
        
        -- Get current confirmed registrations count
        SELECT COUNT(*) INTO current_count
        FROM registrations 
        WHERE event_id = NEW.event_id AND status = 'confirmed';
        
        -- Check capacity limit
        IF current_count >= event_capacity THEN
            RAISE EXCEPTION 'Event has reached maximum capacity of %', event_capacity;
        END IF;
        
        -- Update current_registrations count
        UPDATE events 
        SET current_registrations = current_count
        WHERE id = NEW.event_id;
        
        RETURN NEW;
    END IF;
    
    -- Handle UPDATE
    IF TG_OP = 'UPDATE' THEN
        -- Recalculate count for the event
        SELECT COUNT(*) INTO current_count
        FROM registrations 
        WHERE event_id = NEW.event_id AND status = 'confirmed';
        
        UPDATE events 
        SET current_registrations = current_count
        WHERE id = NEW.event_id;
        
        RETURN NEW;
    END IF;
    
    -- Handle DELETE
    IF TG_OP = 'DELETE' THEN
        -- Recalculate count for the event
        SELECT COUNT(*) INTO current_count
        FROM registrations 
        WHERE event_id = OLD.event_id AND status = 'confirmed';
        
        UPDATE events 
        SET current_registrations = current_count
        WHERE id = OLD.event_id;
        
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update registration count
CREATE TRIGGER trigger_registrations_count_insert
    AFTER INSERT ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_event_registration_count();

CREATE TRIGGER trigger_registrations_count_update
    AFTER UPDATE ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_event_registration_count();

CREATE TRIGGER trigger_registrations_count_delete
    AFTER DELETE ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_event_registration_count();

-- Function to prevent registration for past events
CREATE OR REPLACE FUNCTION validate_event_registration()
RETURNS TRIGGER AS $$
DECLARE
    event_datetime TIMESTAMP WITH TIME ZONE;
    event_active BOOLEAN;
BEGIN
    -- Get event details
    SELECT date_time, is_active INTO event_datetime, event_active
    FROM events 
    WHERE id = NEW.event_id;
    
    -- Check if event exists and is active
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event does not exist';
    END IF;
    
    IF NOT event_active THEN
        RAISE EXCEPTION 'Cannot register for inactive event';
    END IF;
    
    -- Check if event is in the future
    IF event_datetime <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Cannot register for past events';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for registration validation
CREATE TRIGGER trigger_registrations_validation
    BEFORE INSERT ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION validate_event_registration();

-- Add comments for documentation
COMMENT ON TABLE registrations IS 'Junction table linking users to events they are registered for';
COMMENT ON COLUMN registrations.id IS 'Primary key, auto-incrementing registration ID';
COMMENT ON COLUMN registrations.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN registrations.event_id IS 'Foreign key to events table';
COMMENT ON COLUMN registrations.registered_at IS 'Timestamp when user registered';
COMMENT ON COLUMN registrations.status IS 'Registration status (confirmed, cancelled, waitlist)';
