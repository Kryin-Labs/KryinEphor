/** Call with the verified user's JWT before any Auth or business mutation. */
export async function maintenanceBlock(client: { rpc: (name: string) => PromiseLike<{ error: { message: string } | null }> }, corsHeaders: Record<string, string>) {
    const { error } = await client.rpc('fn_check_platform_access');
    if (!error) return null;
    return new Response(JSON.stringify({ error: error.message, code: 'PLATFORM_UNAVAILABLE' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
