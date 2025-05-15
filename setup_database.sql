-- Create the database if it doesn't exist
CREATE DATABASE IF NOT EXISTS signals_dashboard;

-- Create a dedicated user for the application
CREATE USER IF NOT EXISTS 'signals_user'@'localhost' IDENTIFIED BY 'signals_password';

-- Grant privileges to the user
GRANT ALL PRIVILEGES ON signals_dashboard.* TO 'signals_user'@'localhost';

-- Apply the privileges
FLUSH PRIVILEGES; 