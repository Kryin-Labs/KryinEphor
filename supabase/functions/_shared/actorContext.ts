/** Call only after auth.getUser() has validated this request's bearer token. */
export function verifiedActorHeaders(request: Request, userId: string) {
    const headers: Record<string, string> = { 'x-kryin-actor-id': userId };
    const agent = request.headers.get('user-agent');
    if (agent) headers['x-kryin-user-agent'] = agent.slice(0, 2048);
    try {
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
        const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
        if (encoded) {
            const payload = JSON.parse(atob(encoded));
            if (payload.sub === userId && typeof payload.session_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.session_id)) headers['x-kryin-session-id'] = payload.session_id;
        }
    } catch { /* A token without session context must not block an authorized operation. */ }
    return headers;
}
