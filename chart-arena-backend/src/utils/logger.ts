type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
function ts(): string { return new Date().toISOString(); }
function shouldLog(level: LogLevel): boolean { return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]; }
export const logger = {
    debug(tag: string, msg: string, data?: unknown): void { if (shouldLog('debug')) console.log(`[${ts()}] DEBUG [${tag}] ${msg}`, data ?? ''); },
    info(tag: string, msg: string, data?: unknown): void { if (shouldLog('info')) console.log(`[${ts()}] INFO  [${tag}] ${msg}`, data ?? ''); },
    warn(tag: string, msg: string, data?: unknown): void { if (shouldLog('warn')) console.warn(`[${ts()}] WARN  [${tag}] ${msg}`, data ?? ''); },
    error(tag: string, msg: string, data?: unknown): void { if (shouldLog('error')) console.error(`[${ts()}] ERROR [${tag}] ${msg}`, data ?? ''); },
};
