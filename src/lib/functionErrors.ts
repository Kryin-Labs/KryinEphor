import {
    FunctionsFetchError,
    FunctionsHttpError,
    FunctionsRelayError,
} from '@supabase/supabase-js';

export interface FunctionErrorDetails {
    message: string;          // Friendly, user-facing message
    rawMessage?: string;      // Original technical message (for logs/support)
    correlationId?: string;
    status?: number;
    kind: 'http' | 'network' | 'relay' | 'unknown';
}

/**
 * Map technical/database errors to short, human-friendly messages.
 * Order matters: most specific patterns first.
 */
function toFriendlyMessage(raw: string, fallback: string): string {
    if (!raw) return fallback;
    const msg = raw.toLowerCase();

    // ── Auth / permissions ─────────────────────────────────────────────
    if (msg.includes('missing authorization') || msg.includes('invalid or expired token') || msg.includes('jwt'))
        return 'Your session has expired. Please sign in again.';
    if (msg.includes('forbidden') || msg.includes('not allowed') || msg.includes('permission denied'))
        return "You don't have permission to do that.";

    // ── Duplicates (Postgres 23505) ────────────────────────────────────
    if (msg.includes('duplicate key') || msg.includes('already exists') || msg.includes('unique constraint')) {
        if (msg.includes('email')) return 'This email is already in use. Contact support if you think this is a mistake.';
        if (msg.includes('subdomain')) return 'This subdomain is already taken. Please choose another.';
        if (msg.includes('username')) return 'This username is already taken.';
        if (msg.includes('phone')) return 'This phone number is already in use.';
        return 'This value is already in use. Please choose another.';
    }

    // ── NOT NULL (Postgres 23502) ──────────────────────────────────────
    if (msg.includes('null value') || msg.includes('not-null') || msg.includes('violates not null')) {
        const m = raw.match(/column ["']?(\w+)["']?/i);
        const col = m?.[1];
        if (col === 'role') return 'A role is required for this user. Please select one and try again.';
        if (col) return `The "${col.replace(/_/g, ' ')}" field is required.`;
        return 'A required field is missing.';
    }

    // ── Foreign key / invalid reference ────────────────────────────────
    if (msg.includes('foreign key') || msg.includes('violates foreign key'))
        return 'A related record was not found. Please refresh and try again.';
    if (msg.includes('does not exist') && msg.includes('school'))
        return 'That school no longer exists. Please refresh and try again.';

    // ── Validation ─────────────────────────────────────────────────────
    if (msg.includes('invalid email')) return 'Please enter a valid email address.';
    if (msg.includes('password') && (msg.includes('weak') || msg.includes('short') || msg.includes('6 characters')))
        return 'Password is too weak. Use at least 8 characters.';
    if (msg.includes('reserved'))
        return 'That name is reserved. Please choose another.';
    if (msg.includes('invalid') && msg.includes('subdomain'))
        return 'Subdomain can only contain lowercase letters, numbers, and hyphens.';

    // ── Rate limits / quotas ───────────────────────────────────────────
    if (msg.includes('rate limit') || msg.includes('too many requests'))
        return 'Too many attempts. Please wait a moment and try again.';
    if (msg.includes('quota') || msg.includes('exceeded'))
        return "You've reached the limit for this action.";

    // ── Network ────────────────────────────────────────────────────────
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('connection'))
        return 'Could not reach the server. Please check your connection and try again.';
    if (msg.includes('timeout') || msg.includes('timed out'))
        return 'The request took too long. Please try again.';

    // ── Mailer (Brevo) ─────────────────────────────────────────────────
    if (msg.includes('mailer is not configured') || msg.includes('missing_brevo') || msg.includes('missing sender'))
        return 'Email service is not configured yet. Please contact an administrator.';
    if (msg.includes('brevo') || msg.includes('mailer network') || msg.includes('smtp'))
        return "Couldn't send the email right now. Please try again in a moment.";

    // ── Server ─────────────────────────────────────────────────────────
    if (msg.includes('misconfiguration') || msg.includes('internal server error') || msg.includes('500'))
        return 'Something went wrong on our end. Please try again in a moment.';
    if (msg.includes('non-2xx status code') || msg.includes('edge function returned'))
        return 'The server rejected the request. Please try again.';

    // ── handle_new_user trigger ────────────────────────────────────────
    if (msg.includes('handle_new_user') && msg.includes('role'))
        return 'Could not create the user account due to a role configuration issue. Please contact support.';

    // ── Strip noisy prefixes like "Profile update failed: ..." ─────────
    const stripped = raw.replace(/^[A-Z][\w\s]+(failed|error)\s*[:-]\s*/i, '').trim();
    if (stripped && stripped.length < 140) return stripped.charAt(0).toUpperCase() + stripped.slice(1);

    return fallback;
}

export async function parseFunctionError(error: unknown, fallback: string): Promise<FunctionErrorDetails> {
    if (error instanceof FunctionsHttpError) {
        const status = error.context?.status;
        const correlationId = error.context?.headers?.get?.('x-correlation-id') ?? undefined;
        try {
            const body = await error.context.json();
            const raw = (typeof body?.error === 'string' && body.error.trim()) ? body.error
                       : (typeof body?.message === 'string' && body.message.trim()) ? body.message
                       : (error.message || fallback);
            return {
                message: toFriendlyMessage(raw, fallback),
                rawMessage: raw,
                correlationId: body?.correlation_id ?? correlationId,
                status,
                kind: 'http',
            };
        } catch {
            return {
                message: toFriendlyMessage(error.message, fallback),
                rawMessage: error.message,
                correlationId, status, kind: 'http',
            };
        }
    }
    if (error instanceof FunctionsFetchError) {
        return {
            message: 'Could not reach the server. Please check your connection and try again.',
            rawMessage: error.message,
            kind: 'network',
        };
    }
    if (error instanceof FunctionsRelayError) {
        return { message: toFriendlyMessage(error.message, fallback), rawMessage: error.message, kind: 'relay' };
    }
    if (error instanceof Error) {
        return { message: toFriendlyMessage(error.message, fallback), rawMessage: error.message, kind: 'unknown' };
    }
    return { message: fallback, kind: 'unknown' };
}

export function formatFunctionError(d: FunctionErrorDetails): string {
    return d.correlationId ? `${d.message} (Ref: ${d.correlationId})` : d.message;
}

// Back-compat wrapper used by existing pages
export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
    const d = await parseFunctionError(error, fallback);
    return formatFunctionError(d);
}
