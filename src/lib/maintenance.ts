export function maintenanceView({ enabled, superadmin, path }: { enabled: boolean; superadmin: boolean; path: string }) {
    if (!enabled) return 'open';
    if (superadmin || path === '/reset-password' || path === '/oauth/consent') return 'banner';
    return 'blocked';
}

export function announceMaintenanceChange() {
    // Refetch the saved value; never trust a browser message as authoritative status.
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('platform-availability');
    channel?.postMessage('settings-saved');
    channel?.close();
}
