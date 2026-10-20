-- PostgreSQL initialization script for FanVIP
-- This script runs only once when the database container is first created

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Create additional schemas if needed
-- CREATE SCHEMA IF NOT EXISTS analytics;
-- CREATE SCHEMA IF NOT EXISTS audit;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE ofm_db TO ofm_user;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'FanVIP Database initialized successfully';
END $$;
