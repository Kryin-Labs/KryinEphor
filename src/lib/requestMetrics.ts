/** Aggregate measured app requests. No URLs, request bodies or credentials are stored. */
export function requestMetricsFetch(baseFetch: typeof fetch, projectUrl: string,
    schedule: (flush: () => Promise<void>) => void = flush => { setTimeout(() => void flush(), 30_000); }): typeof fetch {
    const batches = new Map<string, { headers: Headers; requests: number; failures: number; duration: number }>();
    let scheduled = false;
    const flush = async () => {
        const pending = Array.from(batches.values()); batches.clear(); scheduled = false;
        await Promise.allSettled(pending.map(batch => baseFetch(`${projectUrl}/rest/v1/rpc/fn_record_request_metrics`, {
            method: 'POST', headers: batch.headers,
            body: JSON.stringify({ p_requests: batch.requests, p_failures: batch.failures, p_duration_ms: Math.round(batch.duration) }),
        })));
    };
    return async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        const token = headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        const name = url.pathname.split('/').pop() ?? '';
        const track = url.origin === new URL(projectUrl).origin && token && token !== headers.get('apikey')
            && /^\/(rest|functions|storage)\/v1\//.test(url.pathname)
            && !/^(fn_record_|fn_platform_|fn_get_platform_settings|fn_get_system_activity|fn_school_health|fn_reconcile_system_alerts)/.test(name);
        const start = performance.now();
        let failed = true;
        try { const response = await baseFetch(input, init); failed = !response.ok; return response; }
        finally {
            if (track) {
                let batch = batches.get(token);
                if (!batch && batches.size < 16) {
                    headers.set('content-type', 'application/json');
                    batch = { headers, requests: 0, failures: 0, duration: 0 }; batches.set(token, batch);
                }
                if (batch && batch.requests < 1000) { batch.requests++; batch.failures += failed ? 1 : 0; batch.duration += Math.min(performance.now() - start, 120_000); }
                if (!scheduled) { scheduled = true; schedule(flush); }
            }
        }
    };
}
