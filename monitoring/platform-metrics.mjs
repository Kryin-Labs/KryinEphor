/** Parse only numeric resource measurements; discard labels, query text and credentials. */
export function parsePlatformMetrics(text, previous) {
    const values = new Map(), filesystems = new Map();
    let cpuTotal = 0, cpuIdle = 0, hasCpu = false;
    for (const line of text.split('\n')) {
        const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([-+\d.eE]+)(?:\s|$)/);
        if (!match) continue;
        const [, name, labels = '', raw] = match, value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || (labels.includes('service_type=') && !labels.includes('service_type="db"'))) continue;
        if (name === 'node_cpu_seconds_total') {
            hasCpu = true; cpuTotal += value;
            if (labels.includes('mode="idle"')) cpuIdle += value;
        }
        if (/^node_(memory_(MemTotal|MemAvailable|Cached|Buffers|SwapTotal|SwapFree)_bytes|load1)$/.test(name)) values.set(name, value);
        if (/^node_filesystem_(size|avail)_bytes$/.test(name)) {
            const mount = labels.match(/mountpoint="([^"]+)"/)?.[1];
            if (mount !== '/' && mount !== '/data') continue;
            const fs = filesystems.get(mount) ?? { mount, size_bytes: null, available_bytes: null };
            fs[name.endsWith('size_bytes') ? 'size_bytes' : 'available_bytes'] = value; filesystems.set(mount, fs);
        }
    }
    const cpuPercent = hasCpu && previous && cpuTotal > previous.total && cpuIdle >= previous.idle
        ? Math.max(0, Math.min(100, 100 * (1 - (cpuIdle - previous.idle) / (cpuTotal - previous.total)))) : null;
    const total = values.get('node_memory_MemTotal_bytes') ?? null;
    const available = values.get('node_memory_MemAvailable_bytes') ?? null;
    return { counters: hasCpu ? { total: cpuTotal, idle: cpuIdle } : null,
        snapshot: { source: 'supabase_management_metrics', collector: 'local', cpu_percent: cpuPercent === null ? null : Math.round(cpuPercent * 100) / 100,
            memory_total_bytes: total, memory_available_bytes: available,
            memory_used_bytes: total !== null && available !== null ? Math.max(0, total - available) : null,
            memory_cache_bytes: values.get('node_memory_Cached_bytes') ?? null,
            memory_buffers_bytes: values.get('node_memory_Buffers_bytes') ?? null,
            swap_total_bytes: values.get('node_memory_SwapTotal_bytes') ?? null,
            swap_free_bytes: values.get('node_memory_SwapFree_bytes') ?? null,
            load_1m: values.get('node_load1') ?? null, filesystems: [...filesystems.values()] },
    };
}
