/**
 * Logger Utility for AIDE MCP Server
 * 
 * Provides structured logging to stderr to avoid interfering with stdio communication
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export class Logger {
  private logLevel: LogLevel;

  constructor(logLevel: LogLevel = 'info') {
    this.logLevel = logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
    
    return levels[level] <= levels[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      service: 'AIDE-MCP',
      ...(meta && { meta }),
    };

    // Use stderr to avoid interfering with stdio MCP communication
    console.error(JSON.stringify(logEntry));
  }

  error(message: string, meta?: any): void {
    this.formatMessage('error', message, meta);
  }

  warn(message: string, meta?: any): void {
    this.formatMessage('warn', message, meta);
  }

  info(message: string, meta?: any): void {
    this.formatMessage('info', message, meta);
  }

  debug(message: string, meta?: any): void {
    this.formatMessage('debug', message, meta);
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}