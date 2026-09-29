import type { IncomingMessage, ServerResponse } from 'node:http';

const readBody = async (request: IncomingMessage) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    return chunks.length ? Buffer.concat(chunks) : undefined;
};

export const toWebRequest = async (request: IncomingMessage) => {
    const headers = new Headers();
    Object.entries(request.headers).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value) headers.set(key, value);
    });
    const scheme = (request.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
    const host = request.headers.host ?? 'kryin-space.vercel.app';
    const method = request.method ?? 'GET';
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(request);
    return new Request(`${scheme}://${host}${request.url ?? '/'}`, { method, headers, body });
};

export const sendWebResponse = async (response: Response, target: ServerResponse) => {
    target.statusCode = response.status;
    response.headers.forEach((value, key) => target.setHeader(key, value));
    if (!response.body) return target.end();
    const reader = response.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        target.write(value);
    }
    target.end();
};
