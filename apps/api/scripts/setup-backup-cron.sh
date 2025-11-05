#!/bin/bash

# Setup Automated Database Backups with Cron
# This script configures a cron job to run database backups automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-database.sh"

echo "🔧 Setting up automated database backups..."

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"
echo "✅ Backup script made executable"

# Check if cron is installed
if ! command -v crontab &> /dev/null; then
    echo "❌ Error: cron is not installed"
    echo "   Install it with: apt-get install cron (Ubuntu/Debian) or yum install cronie (CentOS/RHEL)"
    exit 1
fi

echo "📋 Available backup schedules:"
echo "  1) Every day at 2:00 AM"
echo "  2) Every day at 3:00 AM"
echo "  3) Every 12 hours (2:00 AM and 2:00 PM)"
echo "  4) Every 6 hours"
echo "  5) Every hour"
echo "  6) Custom cron expression"
echo ""

read -p "Select a schedule (1-6): " choice

case $choice in
    1)
        CRON_EXPRESSION="0 2 * * *"
        DESCRIPTION="Daily at 2:00 AM"
        ;;
    2)
        CRON_EXPRESSION="0 3 * * *"
        DESCRIPTION="Daily at 3:00 AM"
        ;;
    3)
        CRON_EXPRESSION="0 2,14 * * *"
        DESCRIPTION="Every 12 hours (2:00 AM and 2:00 PM)"
        ;;
    4)
        CRON_EXPRESSION="0 */6 * * *"
        DESCRIPTION="Every 6 hours"
        ;;
    5)
        CRON_EXPRESSION="0 * * * *"
        DESCRIPTION="Every hour"
        ;;
    6)
        read -p "Enter custom cron expression: " CRON_EXPRESSION
        DESCRIPTION="Custom schedule"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

# Create cron job
CRON_JOB="$CRON_EXPRESSION cd $SCRIPT_DIR && DATABASE_URL=\"\$DATABASE_URL\" BACKUP_DIR=\"/var/backups/ofm-database\" RETENTION_DAYS=7 $BACKUP_SCRIPT >> /var/log/ofm-backup.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "backup-database.sh"; then
    echo "⚠️  A backup cron job already exists"
    read -p "Do you want to replace it? (y/n): " replace
    if [[ $replace != "y" ]]; then
        echo "❌ Aborted"
        exit 0
    fi

    # Remove old cron job
    crontab -l 2>/dev/null | grep -v "backup-database.sh" | crontab -
    echo "🗑️  Old cron job removed"
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "# OFM Database Backup - $DESCRIPTION"; echo "$CRON_JOB") | crontab -

echo "✅ Cron job added successfully!"
echo ""
echo "📅 Schedule: $DESCRIPTION"
echo "📁 Backup directory: /var/backups/ofm-database"
echo "🗂️  Retention: 7 days"
echo "📝 Log file: /var/log/ofm-backup.log"
echo ""
echo "To view current cron jobs, run: crontab -l"
echo "To manually run a backup, execute: $BACKUP_SCRIPT"
echo ""
echo "⚠️  Important: Make sure the DATABASE_URL environment variable is set in your cron environment"
echo "   You can add it to /etc/environment or create a .env file"
