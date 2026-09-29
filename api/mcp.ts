import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpProtocolHandler } from '@lovable.dev/mcp-js/protocols/mcp';
import mcp from '../src/lib/mcp/index.js';
import { sendWebResponse, toWebRequest } from '../src/lib/mcp/http.js';

const handleProtocol = createMcpProtocolHandler(mcp);

export default async function handler(request: IncomingMessage, response: ServerResponse) {
    try {
        await sendWebResponse(await handleProtocol(await toWebRequest(request)), response);
    } catch {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: 'Kryin Edu MCP is temporarily unavailable.' }));
    }
}
