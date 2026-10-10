/** Audit application command outcomes without copying request payloads or credentials. */
export function activityFetch(baseFetch: typeof fetch, projectUrl: string): typeof fetch {
    const lastError = new Map<string, number>();
    return async (input, init) => {
        const response = await baseFetch(input, init);
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.origin !== new URL(projectUrl).origin) return response;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const name = url.pathname.split('/').pop() ?? 'request';
        const isCommand = url.pathname.includes('/functions/v1/') || url.pathname.includes('/rest/v1/rpc/');
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
        const internal = /^(fn_get_|mcp_my_|fn_platform_|fn_reconcile_system_alerts|fn_record_client_event)/.test(name);
        if (!isWrite || internal || (!isCommand && response.ok) || url.pathname.includes('/auth/')) return response;
        const key = `${name}:${response.status}`;
        if (!response.ok && (lastError.get(key) ?? 0) > Date.now() - 60_000) return response;
        if (!response.ok) { if (lastError.size > 100) lastError.clear(); lastError.set(key, Date.now()); }
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        headers.set('content-type', 'application/json');
        // Use the same caller JWT; the database derives identity and tenant itself.
        // This is browser-reported transport status. Database triggers record committed changes.
        void baseFetch(`${projectUrl}/rest/v1/rpc/fn_record_client_event`, {
            method: 'POST', headers,
            body: JSON.stringify({ p_action: `${isCommand ? 'command' : 'request'}.${name}`,
                p_message: `${name}: HTTP ${response.status}`, p_category: 'command',
                p_level: response.ok ? 'info' : 'warn', p_status: response.ok ? 'completed' : 'failed',
                p_details: { method, http_status: response.status, path: url.pathname },
            }),
        }).catch(() => {});
        return response;
    };
}
