-- Migration: 004_race_condition_prevention
-- Description: Add functions and procedures for handling concurrent operations safely
-- Created: 2024-01-01

-- Function to safely register user for event with proper locking
CREATE OR REPLACE FUNCTION safe_event_registration(
    p_user_id INTEGER,
    p_event_id INTEGER
) RETURNS JSON AS $$
DECLARE
    event_record RECORD;
    registration_id INTEGER;
    result JSON;
BEGIN
    -- Start with advisory lock to prevent concurrent registrations for same event
    PERFORM pg_advisory_xact_lock(p_event_id);
    
    -- Lock the event row for update to prevent concurrent modifications
    SELECT id, title, date_time, capacity, current_registrations, is_active
    INTO event_record
    FROM events 
    WHERE id = p_event_id AND is_active = true
    FOR UPDATE;
    
    -- Check if event exists
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found or inactive' USING ERRCODE = 'P0001';
    END IF;
    
    -- Check if event is in the future
    IF event_record.date_time <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Cannot register for past events' USING ERRCODE = 'P0002';
    END IF;
    
    -- Check if user is already registered
    IF EXISTS (
        SELECT 1 FROM registrations 
        WHERE user_id = p_user_id AND event_id = p_event_id
    ) THEN
        RAISE EXCEPTION 'User already registered for this event' USING ERRCODE = 'P0003';
    END IF;
    
    -- Check capacity
    IF event_record.current_registrations >= event_record.capacity THEN
        RAISE EXCEPTION 'Event has reached maximum capacity' USING ERRCODE = 'P0004';
    END IF;
    
    -- Insert registration
    INSERT INTO registrations (user_id, event_id, status)
    VALUES (p_user_id, p_event_id, 'confirmed')
    RETURNING id INTO registration_id;
    
    -- Return success result
    result := json_build_object(
        'success', true,
        'registration_id', registration_id,
        'event_id', p_event_id,
        'user_id', p_user_id,
        'registered_at', CURRENT_TIMESTAMP,
        'message', 'Successfully registered for event'
    );
    
    RETURN result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error result
        result := json_build_object(
            'success', false,
            'error_code', SQLSTATE,
            'error_message', SQLERRM
        );
        RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to safely unregister user from event
CREATE OR REPLACE FUNCTION safe_event_unregistration(
    p_user_id INTEGER,
    p_event_id INTEGER
) RETURNS JSON AS $$
DECLARE
    event_record RECORD;
    registration_record RECORD;
    result JSON;
BEGIN
    -- Start with advisory lock
    PERFORM pg_advisory_xact_lock(p_event_id);
    
    -- Lock the event row
    SELECT id, title, date_time, is_active
    INTO event_record
    FROM events 
    WHERE id = p_event_id AND is_active = true
    FOR UPDATE;
    
    -- Check if event exists
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found or inactive' USING ERRCODE = 'P0001';
    END IF;
    
    -- Check if event is in the future (allow unregistration up to event time)
    IF event_record.date_time <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Cannot unregister from past events' USING ERRCODE = 'P0002';
    END IF;
    
    -- Check if user is registered
    SELECT id, registered_at INTO registration_record
    FROM registrations 
    WHERE user_id = p_user_id AND event_id = p_event_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not registered for this event' USING ERRCODE = 'P0005';
    END IF;
    
    -- Delete registration
    DELETE FROM registrations 
    WHERE user_id = p_user_id AND event_id = p_event_id;
    
    -- Return success result
    result := json_build_object(
        'success', true,
        'event_id', p_event_id,
        'user_id', p_user_id,
        'unregistered_at', CURRENT_TIMESTAMP,
        'message', 'Successfully unregistered from event'
    );
    
    RETURN result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error result
        result := json_build_object(
            'success', false,
            'error_code', SQLSTATE,
            'error_message', SQLERRM
        );
        RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to get event registration statistics with locking
CREATE OR REPLACE FUNCTION get_event_registration_stats(p_event_id INTEGER)
RETURNS JSON AS $$
DECLARE
    event_record RECORD;
    stats_record RECORD;
    result JSON;
BEGIN
    -- Get event details with shared lock
    SELECT id, title, date_time, capacity, current_registrations, is_active
    INTO event_record
    FROM events 
    WHERE id = p_event_id
    FOR SHARE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0001';
    END IF;
    
    -- Get detailed registration statistics
    SELECT 
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
        COUNT(*) FILTER (WHERE status = 'waitlist') as waitlist_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
        COUNT(*) as total_registrations
    INTO stats_record
    FROM registrations 
    WHERE event_id = p_event_id;
    
    -- Build result
    result := json_build_object(
        'event_id', event_record.id,
        'title', event_record.title,
        'date_time', event_record.date_time,
        'capacity', event_record.capacity,
        'current_registrations', event_record.current_registrations,
        'confirmed_registrations', stats_record.confirmed_count,
        'waitlist_registrations', stats_record.waitlist_count,
        'cancelled_registrations', stats_record.cancelled_count,
        'total_registrations', stats_record.total_registrations,
        'available_spots', event_record.capacity - stats_record.confirmed_count,
        'is_full', stats_record.confirmed_count >= event_record.capacity,
        'is_active', event_record.is_active
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to batch register multiple users (useful for admin operations)
CREATE OR REPLACE FUNCTION batch_event_registration(
    p_user_ids INTEGER[],
    p_event_id INTEGER
) RETURNS JSON AS $$
DECLARE
    user_id INTEGER;
    success_count INTEGER := 0;
    error_count INTEGER := 0;
    results JSON[] := '{}';
    single_result JSON;
BEGIN
    -- Process each user registration
    FOREACH user_id IN ARRAY p_user_ids
    LOOP
        -- Call the safe registration function
        SELECT safe_event_registration(user_id, p_event_id) INTO single_result;
        
        -- Add to results array
        results := array_append(results, single_result);
        
        -- Count successes and errors
        IF (single_result->>'success')::boolean THEN
            success_count := success_count + 1;
        ELSE
            error_count := error_count + 1;
        END IF;
    END LOOP;
    
    -- Return summary
    RETURN json_build_object(
        'total_processed', array_length(p_user_ids, 1),
        'successful_registrations', success_count,
        'failed_registrations', error_count,
        'details', array_to_json(results)
    );
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION safe_event_registration(INTEGER, INTEGER) IS 'Safely register user for event with proper locking and validation';
COMMENT ON FUNCTION safe_event_unregistration(INTEGER, INTEGER) IS 'Safely unregister user from event with proper locking';
COMMENT ON FUNCTION get_event_registration_stats(INTEGER) IS 'Get comprehensive registration statistics for an event';
COMMENT ON FUNCTION batch_event_registration(INTEGER[], INTEGER) IS 'Register multiple users for an event in a single transaction';
