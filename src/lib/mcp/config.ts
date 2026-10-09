export const serverEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const configuredUrl = serverEnv.MCP_PUBLIC_URL;
if (!configuredUrl) throw new Error('MCP_PUBLIC_URL must be configured for this deployment.');
const origin = new URL(configuredUrl);
if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('MCP_PUBLIC_URL must be an HTTPS origin (or localhost for development).');
}
export const mcpPublicUrl = origin.origin;
