/**
 * Error Handling Utilities for AIDE MCP Server
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import type { Logger } from './logger.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class TypeScriptAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TypeScriptAnalysisError';
  }
}

export class FileOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

export class ErrorHandler {
  constructor(private logger: Logger) {}

  handleToolError(error: unknown, toolName: string): { error: { code: number; message: string } } {
    this.logger.error(`Error in tool ${toolName}:`, { error: this.serializeError(error) });

    if (error instanceof ZodError) {
      return {
        error: {
          code: ErrorCode.InvalidParams,
          message: `Invalid parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        },
      };
    }

    if (error instanceof ValidationError) {
      return {
        error: {
          code: ErrorCode.InvalidParams,
          message: error.message,
        },
      };
    }

    if (error instanceof ResourceNotFoundError) {
      return {
        error: {
          code: ErrorCode.InvalidParams,
          message: error.message,
        },
      };
    }

    if (error instanceof ConfigurationError) {
      return {
        error: {
          code: ErrorCode.InternalError,
          message: error.message,
        },
      };
    }

    if (error instanceof TypeScriptAnalysisError) {
      return {
        error: {
          code: ErrorCode.InternalError,
          message: `TypeScript analysis failed: ${error.message}`,
        },
      };
    }

    if (error instanceof FileOperationError) {
      return {
        error: {
          code: ErrorCode.InternalError,
          message: `File operation failed: ${error.message}`,
        },
      };
    }

    if (error instanceof McpError) {
      return {
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    if (error instanceof Error) {
      return {
        error: {
          code: ErrorCode.InternalError,
          message: error.message,
        },
      };
    }

    return {
      error: {
        code: ErrorCode.InternalError,
        message: 'An unknown error occurred',
      },
    };
  }

  private serializeError(error: unknown): any {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return error;
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          break;
        }

        this.logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(delay);
        delay *= 2; // Exponential backoff
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}