import { supabase } from './supabase';

export type PlatformSettings = {
    maintenance_enabled: boolean;
    maintenance_message: string;
    support_email: string;
    metrics_stale_minutes: number;
    updated_at: string;
};
export type PlatformHealth = {
    checked_at: string; metrics_updated_at: string | null; scheduler_enabled: boolean;
    active_alerts: number; errors_last_hour: number; schools: number; users: number;
};
export type SchoolHealthSummary = {
    id: string; name: string; status: string; subscription_status: string | null; student_limit: number | null;
    ai_enabled: boolean; users: number; students: number; teachers: number; parents: number; admins: number; classes: number; staff: number;
    files: number | null; file_bytes: number | null; unknown_size_files: number | null;
    requests: number; request_failures: number; average_ms: number | null; reporting_users: number; last_report_at: string | null;
    changes_24h: number; errors_24h: number; logins_24h: number; last_activity_at: string | null;
};
export type HealthConsoleData = PlatformHealth & {
    database: { status: string; size_bytes: number; connections: number; max_connections: number; active_connections: number;
        idle_in_transaction: number; waiting_connections: number; cache_hit_percent: number | null; commits: number; rollbacks: number;
        deadlocks: number; temp_files: number; temp_bytes: number; temporary_relation_bytes: number; stats_reset_at: string | null; database_started_at: string };
    storage: { status: string; reason?: string; files: number; bytes: number; unknown_size_files: number; unassigned_files: number; unassigned_bytes: number;
        uploads: { count: number; bytes: number; oldest_at: string | null } | null;
        buckets: { id: string; name: string; public: boolean; files: number; bytes: number; unknown_size_files: number; file_size_limit: number | null; last_upload_at: string | null }[] };
    tables: { name: string; bytes: number; index_bytes: number; estimated_rows: number; estimated_dead_rows: number; last_autovacuum: string | null; last_autoanalyze: string | null }[];
    school_details: SchoolHealthSummary[];
    requests: { requests: number; failures: number; average_ms: number | null; reporting_users: number; last_report_at: string | null; window_minutes: number };
    cache: { metric_rows: number; metric_bytes: number; request_metric_bytes: number; request_retention_days: number };
    infrastructure: { measured_at: string; fresh: boolean; collector: string; cpu_percent: number | null;
        memory_total_bytes: number | null; memory_used_bytes: number | null; memory_available_bytes: number | null; memory_cache_bytes: number | null;
        memory_buffers_bytes: number | null; swap_total_bytes: number | null; swap_free_bytes: number | null; load_1m: number | null;
        filesystems: { mount: string; size_bytes: number | null; available_bytes: number | null }[];
        services?: { name: string; status: string }[] } | null;
    recent_errors: { action: string; message: string; school_name: string | null; created_at: string }[];
};
export type SchoolHealthDetail = { school_id: string; checked_at: string; logical_bytes: number; tables: { name: string; rows: number; logical_bytes: number }[] };
export type ActivityEvent = {
    id: string; action: string; message: string; level: string; category: string;
    details: Record<string, unknown>; created_at: string; ip_address: string | null;
    user_id: string | null; user_agent: string | null; user_name: string;
    user_email: string | null; user_username: string | null; identity_source: string | null;
    ip_address_source: string | null; user_agent_source: string | null;
    actor_role: string; status: string; school_id: string | null; school_name: string | null;
};

export async function fetchSystemActivity(options: { limit?: number; offset?: number; search?: string; level?: string } = {}) {
    const { data, error } = await supabase.rpc('fn_get_system_activity', {
        p_limit: options.limit ?? 100, p_offset: options.offset ?? 0,
        p_search: options.search ?? '', p_level: options.level ?? '',
    });
    if (error) throw error;
    return (data ?? []) as ActivityEvent[];
}

export async function reconcileAlerts() {
    const { error } = await supabase.rpc('fn_reconcile_system_alerts');
    if (error) throw error;
}
