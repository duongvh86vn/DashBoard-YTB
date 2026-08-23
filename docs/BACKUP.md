# Backup, restore and retention

Backups are PostgreSQL custom-format dumps. The scripts copy the dump through the
running `postgres` container, print a SHA-256 checksum and refuse empty output.

```powershell
pwsh -NoProfile -File .\scripts\backup-db.ps1
pwsh -NoProfile -File .\scripts\restore-db.ps1 -InputPath .\backups\yt-monitor-YYYYMMDD-HHMMSS.dump -Force
```

Restore is deliberately destructive and requires `-Force`. Verify the checksum,
stop write-producing jobs if necessary, and keep the original backup immutable.
The restore script uses `pg_restore --clean --if-exists --no-owner` and removes
its temporary container file in a `finally` block.

There is no retention deletion job yet. This is intentional: deleting snapshots
before a rollup that satisfies weekly-ranking baselines would violate the
`TOP 10 WEEK = ROLLING 7-DAY VIEW GAIN` invariant. Any future retention job must
first prove that all required baseline rows are represented by a durable rollup,
then ship an isolated row-count/checksum test before enabling deletion.

## Reboot and recovery

The long-running Compose services use `restart: unless-stopped`; migration and
seed remain one-shot services. Run the policy assertion after every Compose-file
change:

```powershell
pwsh -NoProfile -File .\scripts\verify-restart-policy.ps1
```

An actual host reboot is an operator acceptance step because it changes the host
state. After reboot, run `corepack pnpm docker:health` and verify the login page,
database migration status and worker heartbeat before declaring recovery passed.
