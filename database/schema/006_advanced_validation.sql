-- Migration: 006_advanced_validation
-- Description: Add advanced database-level validation and business rules
-- Created: 2024-01-01

-- Create domain types for better validation
CREATE DOMAIN email_address AS VARCHAR(320) 
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE DOMAIN positive_integer AS INTEGER 
    CHECK (VALUE > 0);

CREATE DOMAIN event_capacity AS INTEGER 
    CHECK (VALUE > 0 AND VALUE <= 10000);

CREATE DOMAIN registration_status AS VARCHAR(20) 
    CHECK (VALUE IN ('confirmed', 'cancelled', 'waitlist', 'pending'));

-- Function to validate user data
CREATE OR REPLACE FUNCTION validate_user_data()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate name is not just whitespace
    IF LENGTH(TRIM(NEW.name)) = 0 THEN
        RAISE EXCEPTION 'User name cannot be empty or just whitespace';
    END IF;
    
    -- Validate email format (additional check beyond domain)
    IF NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email format: %', NEW.email;
    END IF;
    
    -- Normalize email to lowercase
    NEW.email := LOWER(NEW.email);
    
    -- Validate password hash is not empty
    IF LENGTH(TRIM(NEW.password_hash)) = 0 THEN
        RAISE EXCEPTION 'Password hash cannot be empty';
    END IF;
    
    -- Ensure password hash looks like bcrypt
    IF NEW.password_hash !~ '^\$2[aby]?\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN
        RAISE EXCEPTION 'Invalid password hash format';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for user validation
CREATE TRIGGER trigger_validate_user_data
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION validate_user_data();

-- Function to validate event data
CREATE OR REPLACE FUNCTION validate_event_data()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate title is not just whitespace
    IF LENGTH(TRIM(NEW.title)) = 0 THEN
        RAISE EXCEPTION 'Event title cannot be empty or just whitespace';
    END IF;
    
    -- Validate date is in the future (for new events)
    IF TG_OP = 'INSERT' AND NEW.date_time <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Event date must be in the future';
    END IF;
    
    -- For updates, only allow date changes if event hasn't started
    IF TG_OP = 'UPDATE' AND OLD.date_time != NEW.date_time THEN
        IF OLD.date_time <= CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'Cannot change date of past events';
        END IF;
        
        IF NEW.date_time <= CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'New event date must be in the future';
        END IF;
    END IF;
    
    -- Validate capacity constraints
    IF NEW.capacity <= 0 OR NEW.capacity > 10000 THEN
        RAISE EXCEPTION 'Event capacity must be between 1 and 10000';
    END IF;
    
    -- Prevent reducing capacity below current registrations
    IF TG_OP = 'UPDATE' AND NEW.capacity < OLD.current_registrations THEN
        RAISE EXCEPTION 'Cannot reduce capacity below current registrations (%))', OLD.current_registrations;
    END IF;
    
    -- Validate current_registrations is not negative
    IF NEW.current_registrations < 0 THEN
        RAISE EXCEPTION 'Current registrations cannot be negative';
    END IF;
    
    -- Validate current_registrations doesn't exceed capacity
    IF NEW.current_registrations > NEW.capacity THEN
        RAISE EXCEPTION 'Current registrations (%) cannot exceed capacity (%)', 
            NEW.current_registrations, NEW.capacity;
    END IF;
    
    -- Validate location if provided
    IF NEW.location IS NOT NULL AND LENGTH(TRIM(NEW.location)) = 0 THEN
        NEW.location := NULL; -- Convert empty string to NULL
    END IF;
    
    -- Validate description if provided
    IF NEW.description IS NOT NULL AND LENGTH(TRIM(NEW.description)) = 0 THEN
        NEW.description := NULL; -- Convert empty string to NULL
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for event validation
CREATE TRIGGER trigger_validate_event_data
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION validate_event_data();

-- Function to validate registration data
CREATE OR REPLACE FUNCTION validate_registration_data()
RETURNS TRIGGER AS $$
DECLARE
    event_record RECORD;
    user_record RECORD;
BEGIN
    -- Get event details
    SELECT date_time, is_active, capacity, current_registrations
    INTO event_record
    FROM events 
    WHERE id = NEW.event_id;
    
    -- Check if event exists and is active
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event with ID % does not exist', NEW.event_id;
    END IF;
    
    IF NOT event_record.is_active THEN
        RAISE EXCEPTION 'Cannot register for inactive event';
    END IF;
    
    -- Check if user exists and is active
    SELECT is_active INTO user_record
    FROM users 
    WHERE id = NEW.user_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User with ID % does not exist', NEW.user_id;
    END IF;
    
    IF NOT user_record.is_active THEN
        RAISE EXCEPTION 'Cannot register inactive user';
    END IF;
    
    -- Check if event is in the future
    IF event_record.date_time <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Cannot register for past events';
    END IF;
    
    -- Check capacity for confirmed registrations
    IF NEW.status = 'confirmed' THEN
        IF event_record.current_registrations >= event_record.capacity THEN
            RAISE EXCEPTION 'Event has reached maximum capacity';
        END IF;
    END IF;
    
    -- Validate status
    IF NEW.status NOT IN ('confirmed', 'cancelled', 'waitlist', 'pending') THEN
        RAISE EXCEPTION 'Invalid registration status: %', NEW.status;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for registration validation
CREATE TRIGGER trigger_validate_registration_data
    BEFORE INSERT OR UPDATE ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION validate_registration_data();

-- Function to audit data changes
CREATE OR REPLACE FUNCTION audit_data_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Create audit table if it doesn't exist
    CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(50) NOT NULL,
        operation VARCHAR(10) NOT NULL,
        record_id INTEGER,
        old_values JSONB,
        new_values JSONB,
        changed_by VARCHAR(100),
        changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Log the change
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_values)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, row_to_json(OLD)::jsonb);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_values, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, record_id, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(NEW)::jsonb);
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers for all main tables
CREATE TRIGGER trigger_audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION audit_data_changes();

CREATE TRIGGER trigger_audit_events
    AFTER INSERT OR UPDATE OR DELETE ON events
    FOR EACH ROW
    EXECUTE FUNCTION audit_data_changes();

CREATE TRIGGER trigger_audit_registrations
    AFTER INSERT OR UPDATE OR DELETE ON registrations
    FOR EACH ROW
    EXECUTE FUNCTION audit_data_changes();

-- Function to clean up old audit logs
CREATE OR REPLACE FUNCTION cleanup_audit_logs(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_log 
    WHERE changed_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RAISE NOTICE 'Cleaned up % old audit log entries', deleted_count;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate business rules across tables
CREATE OR REPLACE FUNCTION validate_business_rules()
RETURNS TABLE(
    rule_name TEXT,
    violation_count BIGINT,
    details TEXT
) AS $$
BEGIN
    -- Check for events with invalid registration counts
    RETURN QUERY
    SELECT 
        'Invalid Registration Count'::TEXT,
        COUNT(*),
        'Events where current_registrations does not match actual count'::TEXT
    FROM events e
    WHERE e.current_registrations != (
        SELECT COUNT(*) 
        FROM registrations r 
        WHERE r.event_id = e.id AND r.status = 'confirmed'
    )
    HAVING COUNT(*) > 0;
    
    -- Check for registrations for past events
    RETURN QUERY
    SELECT 
        'Past Event Registrations'::TEXT,
        COUNT(*),
        'Registrations for events that have already occurred'::TEXT
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE e.date_time <= CURRENT_TIMESTAMP
    HAVING COUNT(*) > 0;
    
    -- Check for over-capacity events
    RETURN QUERY
    SELECT 
        'Over Capacity Events'::TEXT,
        COUNT(*),
        'Events with more confirmed registrations than capacity'::TEXT
    FROM events e
    WHERE e.current_registrations > e.capacity
    HAVING COUNT(*) > 0;
    
    -- Check for inactive users with active registrations
    RETURN QUERY
    SELECT 
        'Inactive User Registrations'::TEXT,
        COUNT(*),
        'Active registrations for inactive users'::TEXT
    FROM registrations r
    JOIN users u ON r.user_id = u.id
    WHERE NOT u.is_active AND r.status IN ('confirmed', 'waitlist', 'pending')
    HAVING COUNT(*) > 0;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION validate_user_data() IS 'Validates user data before insert/update';
COMMENT ON FUNCTION validate_event_data() IS 'Validates event data before insert/update';
COMMENT ON FUNCTION validate_registration_data() IS 'Validates registration data before insert/update';
COMMENT ON FUNCTION audit_data_changes() IS 'Logs all data changes for audit purposes';
COMMENT ON FUNCTION cleanup_audit_logs(INTEGER) IS 'Removes old audit log entries';
COMMENT ON FUNCTION validate_business_rules() IS 'Checks for business rule violations across tables';
