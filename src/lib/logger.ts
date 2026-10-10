import { supabase } from './supabase';

type LogLevel = 'info' | 'warn' | 'error';
type LogCategory = 'auth' | 'tenant' | 'system' | 'database' | 'edge_function';

interface LogEntry {
    level: LogLevel;
    category: LogCategory;
    message: string;
    action?: string;
    status?: string;
    ip_address?: string;
    details?: Record<string, unknown>;
    userId?: string;
}

/**
 * Centralized logger for Kryin School.
 * Logs to console and the authenticated activity RPC in Supabase.
 */
class Logger {
    private async writeToDb(entry: LogEntry): Promise<void> {
        try {
            const { error } = await supabase.rpc('fn_record_client_event', {
                p_level: entry.level, p_category: entry.category, p_message: entry.message,
                p_action: entry.action || 'system_event', p_status: entry.status || 'success',
                p_details: entry.details || {},
            });
            if (error) throw error;
        } catch (dbError) {
            // ─────────────────────────────────────────────────────────────
            // 📝 Author: Narco / Arth
            // 🔗 GitHub: https://github.com/ArthOfficial
            // 🌐 Website: https://arth-hub.vercel.app
            // © 2026 Arth — All rights reserved.
            // ─────────────────────────────────────────────────────────────
            console.warn('[Logger] Failed to write log to DB:', dbError);
        }
    }

    private formatConsole(entry: LogEntry): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
    }

    async info(
        category: LogCategory,
        message: string,
        options: Partial<Omit<LogEntry, 'level' | 'category' | 'message'>> = {}
    ): Promise<void> {
        const entry: LogEntry = { level: 'info', category, message, ...options };
        console.log(this.formatConsole(entry), options.details || '');
        // Persist explicit lifecycle events, avoiding an insert for every debug message.
        if (options.action) await this.writeToDb(entry);
    }

    async warn(
        category: LogCategory,
        message: string,
        options: Partial<Omit<LogEntry, 'level' | 'category' | 'message'>> = {}
    ): Promise<void> {
        const entry: LogEntry = { level: 'warn', category, message, ...options };
        console.warn(this.formatConsole(entry), options.details || '');
        this.writeToDb(entry); // Non-blocking: Fire and forget
    }

    async error(
        category: LogCategory,
        message: string,
        options: Partial<Omit<LogEntry, 'level' | 'category' | 'message'>> = {}
    ): Promise<void> {
        const entry: LogEntry = { level: 'error', category, message, ...options };
        console.error(this.formatConsole(entry), options.details || '');
        this.writeToDb(entry); // Non-blocking: Fire and forget
    }
}

export const logger = new Logger();
