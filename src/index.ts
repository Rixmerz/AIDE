#!/usr/bin/env node

/**
 * AIDE MCP Server - Advanced TypeScript Development Tools
 * 
 * Provides powerful tools for TypeScript error analysis, intelligent editing,
 * pattern replacement, and automated fixes to enhance developer productivity.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { Logger } from './utils/logger.js';
import { ErrorHandler } from './utils/errors.js';

class AideMCPServer {
  private server: Server;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor() {
    this.server = new Server(
      {
        name: 'aide-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize with appropriate log level based on environment
    const logLevel = (process.env.LOG_LEVEL as any) || 'info';
    this.logger = new Logger(logLevel);
    this.errorHandler = new ErrorHandler(this.logger);
    this.setupErrorHandling();
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Starting AIDE MCP Server initialization...');

      // Register all AIDE tools
      this.logger.info('Registering AIDE MCP tools...');
      await registerTools(this.server, {
        logger: this.logger,
        errorHandler: this.errorHandler,
      });

      this.logger.info('AIDE MCP Server initialized successfully');
      this.logger.info('Available tools: error_diff, multi_file_edit, pattern_replace, typescript_auto_fix');
    } catch (error) {
      this.logger.error('Failed to initialize AIDE MCP Server:', error);
      throw error;
    }
  }

  private setupErrorHandling(): void {
    // Global error handlers for graceful failure handling
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception in AIDE MCP Server:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection in AIDE MCP Server:', { promise, reason });
      process.exit(1);
    });

    // Handle process signals gracefully
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down AIDE MCP Server gracefully...');
      this.shutdown().then(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down AIDE MCP Server gracefully...');
      this.shutdown().then(() => process.exit(0));
    });
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logger.info('AIDE MCP Server started and listening on stdio');
      this.logger.info('Ready to assist with TypeScript development tasks');
    } catch (error) {
      this.logger.error('Failed to start AIDE MCP Server:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down AIDE MCP Server...');
      
      // Cleanup resources here if needed
      // For example, close database connections, clear caches, etc.
      
      this.logger.info('AIDE MCP Server shutdown complete');
    } catch (error) {
      this.logger.error('Error during AIDE MCP Server shutdown:', error);
    }
  }
}

// Main execution function
async function main(): Promise<void> {
  const server = new AideMCPServer();
  
  try {
    await server.initialize();
    await server.start();
  } catch (error) {
    console.error('Failed to start AIDE MCP Server:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error in AIDE MCP Server main:', error);
    process.exit(1);
  });
}

export { AideMCPServer };