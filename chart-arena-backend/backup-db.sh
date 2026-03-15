#!/bin/bash
# Chart Arena — Daily SQLite Backup
# Install: crontab -e → 0 3 * * * ~/chart-arena/chart-arena-backend/backup-db.sh >> ~/chart-arena/chart-arena-backend/data/backups/backup.log 2>&1
set -euo pipefail
DB_PATH="$(cd "$(dirname "$0")" && pwd)/data/chart-arena.db"
BACKUP_DIR="$(cd "$(dirname "$0")" && pwd)/data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/chart-arena-${DATE}.db"
mkdir -p "$BACKUP_DIR"
[ -f "$DB_PATH" ] || { echo "ERROR: DB not found at $DB_PATH"; exit 1; }
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
gzip "$BACKUP_FILE"
find "$BACKUP_DIR" -name "chart-arena-*.db.gz" -mtime +7 -delete
echo "[$(date)] Backup OK: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
