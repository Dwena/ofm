#!/bin/bash

# Database Restore Script for OFM Platform
# This script restores a PostgreSQL database backup

set -e  # Exit on error

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ofm-database}"

# Parse DATABASE_URL to extract connection details
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    exit 1
fi

# Extract database connection details from DATABASE_URL
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "🗄️  OFM Database Restore Utility"
echo "=================================="
echo ""

# List available backups
echo "📁 Available backups in $BACKUP_DIR:"
echo ""

if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR/*.sql.gz 2>/dev/null)" ]; then
    echo "❌ No backups found in $BACKUP_DIR"
    exit 1
fi

# Display backups with numbers
BACKUPS=($(ls -t $BACKUP_DIR/ofm-backup-*.sql.gz))
for i in "${!BACKUPS[@]}"; do
    BACKUP_FILE="${BACKUPS[$i]}"
    FILE_NAME=$(basename "$BACKUP_FILE")
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    FILE_DATE=$(echo "$FILE_NAME" | sed 's/ofm-backup-\([0-9]\{8\}\)_\([0-9]\{6\}\).*/\1 \2/' | sed 's/\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)/\1-\2-\3/' | sed 's/\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)/\1:\2:\3/')
    echo "  $((i+1))) $FILE_NAME"
    echo "     Date: $FILE_DATE | Size: $FILE_SIZE"
    echo ""
done

# Select backup
read -p "Select a backup to restore (1-${#BACKUPS[@]}) or 'q' to quit: " selection

if [[ $selection == "q" ]]; then
    echo "❌ Restore cancelled"
    exit 0
fi

if [[ ! $selection =~ ^[0-9]+$ ]] || [ $selection -lt 1 ] || [ $selection -gt ${#BACKUPS[@]} ]; then
    echo "❌ Invalid selection"
    exit 1
fi

SELECTED_BACKUP="${BACKUPS[$((selection-1))]}"

echo ""
echo "⚠️  WARNING: This will:"
echo "   1. DROP all existing tables in database '$DB_NAME'"
echo "   2. Restore data from: $(basename $SELECTED_BACKUP)"
echo "   3. All current data will be LOST"
echo ""
read -p "Are you sure you want to continue? Type 'yes' to confirm: " confirmation

if [[ $confirmation != "yes" ]]; then
    echo "❌ Restore cancelled"
    exit 0
fi

# Set password for psql
export PGPASSWORD="$DB_PASSWORD"

echo ""
echo "🔄 Starting database restore..."
echo "📦 Backup file: $(basename $SELECTED_BACKUP)"
echo "💾 Database: $DB_NAME"
echo ""

# Decompress and restore
echo "⏳ Decompressing and restoring..."
gunzip -c "$SELECTED_BACKUP" | psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --quiet

if [ $? -eq 0 ]; then
    echo "✅ Database restored successfully!"
    echo ""
    echo "🎉 Restore completed!"
else
    echo "❌ Error: Failed to restore database"
    exit 1
fi

# Unset password
unset PGPASSWORD

echo ""
echo "📊 Database statistics:"
psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --command="SELECT schemaname, tablename, n_live_tup as rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"

echo ""
echo "✅ Restore process completed!"
