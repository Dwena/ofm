#!/bin/bash

# Database Backup Script for OFM Platform
# This script creates automated backups of the PostgreSQL database

set -e  # Exit on error

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ofm-database}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE=$(date +"%Y-%m-%d")

# Parse DATABASE_URL to extract connection details
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    exit 1
fi

# Extract database connection details from DATABASE_URL
# Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Backup filename
BACKUP_FILE="$BACKUP_DIR/ofm-backup-$TIMESTAMP.sql"
BACKUP_FILE_COMPRESSED="$BACKUP_FILE.gz"

echo "🗄️  Starting database backup..."
echo "📅 Date: $DATE $TIMESTAMP"
echo "💾 Database: $DB_NAME"
echo "📁 Backup directory: $BACKUP_DIR"

# Set password for pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Create the backup
echo "⏳ Creating backup..."
pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --format=plain \
    --file="$BACKUP_FILE"

# Check if backup was successful
if [ $? -eq 0 ]; then
    echo "✅ Backup created successfully"

    # Compress the backup
    echo "🗜️  Compressing backup..."
    gzip "$BACKUP_FILE"

    if [ $? -eq 0 ]; then
        echo "✅ Backup compressed successfully"
        echo "📦 Compressed file: $BACKUP_FILE_COMPRESSED"

        # Get file size
        FILE_SIZE=$(du -h "$BACKUP_FILE_COMPRESSED" | cut -f1)
        echo "📊 Backup size: $FILE_SIZE"
    else
        echo "❌ Error: Failed to compress backup"
        exit 1
    fi
else
    echo "❌ Error: Failed to create backup"
    exit 1
fi

# Clean up old backups
echo "🧹 Cleaning up old backups (older than $RETENTION_DAYS days)..."
find "$BACKUP_DIR" -name "ofm-backup-*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete

REMAINING_BACKUPS=$(find "$BACKUP_DIR" -name "ofm-backup-*.sql.gz" -type f | wc -l)
echo "📁 Total backups remaining: $REMAINING_BACKUPS"

# Unset password
unset PGPASSWORD

echo "✅ Backup process completed successfully!"
echo ""
echo "To restore this backup, run:"
echo "  gunzip -c $BACKUP_FILE_COMPRESSED | psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
