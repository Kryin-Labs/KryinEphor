import type { IncomingMessage, ServerResponse } from 'node:http';
import { createOAuthProtectedResourceMetadataHandler } from '@lovable.dev/mcp-js/protocols/oauth-metadata';
import mcp from '../src/lib/mcp/index.js';
import { sendWebResponse, toWebRequest } from '../src/lib/mcp/http.js';

const handleMetadata = createOAuthProtectedResourceMetadataHandler(mcp);

export default async function handler(request: IncomingMessage, response: ServerResponse) {
    await sendWebResponse(await handleMetadata(await toWebRequest(request)), response);
}
