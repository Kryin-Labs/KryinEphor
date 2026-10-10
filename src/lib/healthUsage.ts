/** Unknown capacity is unavailable, including zero denominators and invalid gauges. */
export function capacityUsage(used: number | null | undefined, total: number | null | undefined) {
    if (used == null || total == null || !Number.isFinite(used) || !Number.isFinite(total) || used < 0 || total <= 0) return null;
    const percent = used / total * 100;
    if (!Number.isFinite(percent)) return null;
    return { percent, barPercent: Math.min(100, percent), remainingPercent: Math.max(0, 100 - percent), exceeded: percent > 100 };
}

export function filesystemUsed(total: number | null | undefined, available: number | null | undefined) {
    if (total == null || available == null || !Number.isFinite(total) || !Number.isFinite(available) || total <= 0 || available < 0 || available > total) return null;
    return total - available;
}

const protectedQueries = new Set(['auth', 'session', 'profile', 'user', 'platform-status', 'platform-settings', 'platform-health', 'platform-health-console', 'school-health', 'browser-storage-health', 'platform-cache-status']);

/** Only idle queries with no active screen observers are disposable. */
export function canClearQuery(query: { queryKey: readonly unknown[]; isActive(): boolean; state: { fetchStatus: string; data?: unknown; error?: unknown } }) {
    const hasCachedResult = query.state.data !== undefined || query.state.error != null;
    return hasCachedResult && !query.isActive() && query.state.fetchStatus === 'idle' && !protectedQueries.has(String(query.queryKey[0]));
}

/** Cache API downloads are distinct from local/session storage and authentication. */
export async function clearDownloadedCaches(storage: Pick<CacheStorage, 'keys' | 'open' | 'delete'>) {
    let removed = 0;
    for (const name of await storage.keys()) {
        const entries = (await (await storage.open(name)).keys()).length;
        if (await storage.delete(name)) removed += entries;
    }
    return removed;
}
