# Platform settings and activity history

`/settings` is restricted to active superadmins. The controls use saved database configuration and real service checks.

| Section | Available actions |
| --- | --- |
| General | Save maintenance mode, the message shown to school users, support contact, and the metric age threshold. Refresh platform metrics and inspect the actual database schedule. |
| Health console | Poll live database, school counts, storage catalogs, app request measurements, host resource snapshots, cache and temporary storage. View capacity percentages and inspect school row data. Clear unused app/download caches, remove expired request measurements and rebuild dashboard metrics. |
| Email Service | Check the Brevo mailer without sending an email. Open the existing Supabase function secrets console to configure the sender and provider credentials. |
| Security | Open the existing user/role management workflows, activity history, and Supabase authentication settings. |
| Backups | Read actual application backup records. Open Supabase-managed backups and restore tools. Empty application history does not imply that managed backups are absent. |
| API Access | Enable or disable school AI access. Disabling it revokes existing school grants. Each user manages their own client grants and sensitive approvals on `/ai-connections`. |

Maintenance defaults to off on a fresh installation. Its switch saves immediately; saving message/contact/threshold changes separately cannot accidentally overwrite the maintenance flag. The saved switch controls current availability. Availability is checked above all page guards, including public pages; school users and visitors see the maintenance dialog when enabled. Superadmins retain access with a visible banner. Administrator login, password recovery and OAuth consent remain reachable. Open tabs poll every ten seconds, on route changes and window focus, with same-origin tab notifications after saving. A status check failure blocks normal access and leaves superadmin settings accessible for recovery.

Enabling maintenance blocks authenticated school database changes immediately. The six school/user Edge Functions check the verified caller's availability before making Auth mutations. Trusted background services without a school actor continue running. MCP school access also checks saved maintenance state. Normal direct database reads and direct storage API permissions remain governed by existing RLS policies; this is an application access/write pause, not a network firewall.

## Live health sources

- Database: `pg_database_size`, `pg_stat_database`, `pg_stat_activity`, relation/index sizes and table statistics. Connection/lock readings are current. Transaction/deadlock counters, buffer hits and temporary query-file bytes are cumulative since statistics reset. Temporary query bytes are **not** current disk occupation. PostgreSQL row/dead-row estimates are labeled accordingly.
- Schools: current active profiles, capability roles for teachers, class/staff records, configured student limits, subscriptions, AI access, last activity, server sign-ins and errors. File attribution uses the school folder, linked announcement, then uploader school. The school inspector scans tenant-owned tables only when requested and refreshes once a minute while visible. Its logical row-byte total excludes physical index allocation/free space.
- Storage: read-only Supabase object/bucket metadata, known bytes, files with unknown size, unattributed files, private/public buckets, per-file upload limits and in-progress multipart uploads. No storage catalog records are modified. Zero files is a real empty catalog; unavailable permission/data remains unavailable.
- Requests: signed-in app browsers measure API/Edge/storage response time and HTTP/network failures, then report numeric aggregates every 30 seconds. The authenticated reporting RPC derives user/school. It stores no URL, body, password or token; measurements are explicitly browser-reported, not authoritative global traffic. Auth, monitoring, external clients and closed/offline browser batches are outside these totals. Aggregates retain seven days via Supabase Cron.
- Browser: this origin's StorageManager estimate/quota, estimated local/session storage bytes, Cache API entries and in-memory React Query entries. No storage values are displayed.
- Host: sanitized CPU counter deltas, memory available/used/cache/buffers, load, root/data volume gauges and coarse service health from the read-only [Supabase Management monitoring endpoint](https://supabase.com/docs/reference/api/v1-scrape-project-metrics). No service-role key is retrieved or copied into the frontend.

The host collector runs locally every minute in `monitoring/collect-platform-health.mjs`, reading the existing `SUPABASE_ACCESS_TOKEN_KRYINEPHOR` process variable. It writes only sanitized snapshots to a protected singleton table. Host CPU needs two samples; a missing snapshot is unavailable, and snapshots older than 150 seconds are marked stale. If this computer sleeps or the process stops, PostgreSQL and school readings continue but host readings become stale. For continuous hosted monitoring, run the collector on an always-on host or schedule its `--once` mode there with server-side credentials. No credentials are committed and no hosted schedule has been silently provisioned.

Windows local restart:

```powershell
$env:SUPABASE_ACCESS_TOKEN_KRYINEPHOR = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN_KRYINEPHOR', 'User')
node monitoring/collect-platform-health.mjs
```

Provider-wide request/bandwidth reports, CDN cache occupancy, historical infrastructure uptime and physical per-school database allocations are not inferred from these measurements. The console links to provider reports where appropriate.

Usage meters display the actual percentage against a known denominator: RAM/disk/connection capacity, configured school student allowance, browser origin quota, and CPU utilization. Database bytes are labeled as their share of the data volume capacity; total volume occupation is measured separately. Table/cache sizes and request failures show explicitly labeled shares of database data or measured requests. Unknown capacity and zero sample counts do not produce a fabricated 0%. Supabase object-storage plan quotas and per-school file quotas are unavailable; the console links to provider usage and never treats a per-file upload limit as a total storage quota. Cumulative query spill bytes are historical activity, not occupied storage.

Cleanup keeps session tokens, local/session storage, preferences, uploaded files, school records and audit history. App-cache cleanup removes only inactive, idle React Query entries and preserves critical availability/settings queries. Download-cache cleanup discards this origin's Cache API entries, which can be downloaded again. Both local actions report their numeric outcomes to activity history as browser reports. The active-superadmin `fn_cleanup_request_metrics` RPC removes only rows older than the existing seven-day retention, records the authenticated actor and removed count, and leaves recent measurements intact. PostgreSQL reuses freed row space; DELETE does not immediately shrink the database file. Dashboard cache rebuilding recalculates saved metrics and reconciles stale alerts. Temporary query files are automatically managed by PostgreSQL, and incomplete uploads are reviewed through the provider, with no direct storage-table deletions.

The two managed platform alerts are checked against saved maintenance state and the oldest global metric timestamp. Active and resolved alerts have separate views. Metrics refresh every five minutes when the named Supabase Cron job is active. The UI reports an unavailable schedule explicitly.

## What gets recorded

- Changes to business tables, including announcements, schools, classes, profiles, role definitions, capabilities, enrollment, attendance, assessment and fee records. Triggers capture committed inserts, updates, hard deletions, and soft deletion transitions.
- Existing canonical security audit records, activity records, and MCP tool call outcomes, including denied or failed AI operations. Their older records are included in the history.
- Server authentication session creation and deletion/revocation, independently of browser telemetry. A session ending is labeled as ending or revocation; it is not assumed to be a voluntary logout.
- Explicit browser lifecycle events, application runtime failures, application command responses, and failed application writes. Browser reports are labeled separately from authoritative database changes.

Events contain timestamp, actor ID/name/role, school ID/name, action, status, source, target identity and changed fields where available. Old/new record details are redacted recursively for credential fields. Actor and school snapshots have no deletion-cascading foreign keys. App accounts cannot update or delete the new history or existing log evidence.

New activity records also snapshot the actor's email and actual `profiles.login_id` as username/login ID. The actor-context trigger derives these from the authenticated actor profile, ignoring identity fields in browser telemetry. Historical events recover them only from surviving profiles and explicitly mark this as a profile backfill, rather than claiming to have captured historical values. Older legacy logs label current-profile lookups. Search includes names, usernames and email within the existing administrator/tenant scope.

The Alerts page and superadmin dashboard share the same keyboard-accessible native activity dialog. It shows readable browser, reported version, device category, operating system, IP, identity and timestamp; raw user-agent/JSON evidence is collapsed under Technical details. Labels follow recognizable [user-agent tokens](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent). Missing values remain Not captured, ambiguous clients remain Unknown, and server runtimes are labeled as API clients. No browser fingerprint, external IP lookup, or exact physical device model is inferred.

IP fallback uses only the JWT's matching `auth.sessions` record for that event's actor and is labeled as the IP at session sign-in. It never uses another user's session, the latest unrelated login, or an unverified proxy/IP header. The six school/user Edge Functions forward the original browser agent and a session ID belonging to the already verified bearer-token subject. The database accepts these context headers only for a verified service-role actor; direct browser attempts to provide the same headers cannot override their own request context.

School admins can read their own school's history through the guarded RPC. Superadmins can read platform history. Direct browser inserts cannot choose another actor or tenant: the reporting RPC derives both from the caller's authenticated profile.

The six school/user Edge Functions send the caller ID only after validating their bearer token. The database trusts this header only on requests using the service credential. An ordinary app account cannot impersonate another actor with the same header.

## Limits

Unsubmitted text typed in browser DevTools cannot be captured reliably. Successful backend changes are captured regardless of whether the app's browser logger ran. Raw SQL statement text, read-only SQL console commands, database schema changes, and failed statements inside rolled-back transactions belong in Supabase Postgres logs/pgAudit. A shared database credential identifies a database role, not necessarily the human operating the SQL console.

Historical actions with missing actor identities cannot be reconstructed reliably; the UI labels those actors as unknown. Secrets pasted into arbitrary free-text content are outside field-based redaction. Infrastructure uptime history and traffic outside the instrumented app require additional provider monitoring; the settings page does not invent those values.

## Monitoring recommendation

Keep the application's audit history and school/business metrics here. A CRM is useful for admissions leads, follow-up and support, but it does not provide infrastructure monitoring. Grafana with Loki suits infrastructure logs and metrics; PostHog suits feature usage and funnels. Evaluate a specific GitHub repository for license, maintenance, tenant isolation, deployment needs and credential handling before integrating it.

## Deployment and checks

The targeted deployed migrations are `20260930120000_mcp_connections.sql`, `20261010120000_platform_operations.sql`, `20261010123000_auth_session_activity.sql`, `20261010124500_activity_outcomes.sql`, `20261010130000_maintenance_health.sql`, `20261010133000_maintenance_edge_guard.sql`, `20261010140000_cache_cleanup.sql`, and `20261010150000_activity_context.sql`. They are registered in the Supabase migration history. Unrelated pending migrations were not applied.

The six updated school/user Edge Functions are deployed through Supabase CLI. Frontend and MCP API source changes must be included in the web application's next deployment.

The isolated PostgreSQL test in `tests/operations-db.test.mjs` covers authorization, spoofed actor headers, field redaction, deletion survival, maintenance enforcement, authentication session events and metric cache uniqueness. It runs with a temporary PGlite installation identified by `PGLITE_TEST_MODULE`, without adding a production dependency. `tests/activity-transport.test.mjs` checks credential/payload omission and recursive/rate-limited reporting. MCP protocol tests cover maintenance denial along with the existing token/role restrictions.

`tests/health-usage.test.mjs` verifies honest percentage handling for unknown/zero/over-capacity values and protects active/in-flight/session queries during cleanup. The PostgreSQL test also covers cleanup permissions, expiry boundaries, recent-row preservation, repeat cleanup and authoritative cleanup activity records. The cleanup migration was validated against the live schema inside a rolled-back transaction before deployment.

`tests/activity-client.test.mjs` covers browser-token precedence, mobile variants, unavailable/ambiguous/server agents and allowlisted Edge context headers. PostgreSQL checks also verify identity snapshots survive profile changes/deletion, a session must belong to the recorded actor, browser-provided identity/context cannot impersonate someone else, and email searches retain tenant isolation. The activity-context migration was validated in a rolled-back live-schema transaction before deployment.
