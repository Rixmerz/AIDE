/**
 * Simple ESLint utilities for AIDE MCP Server
 */

import type { Logger } from './logger.js';

export interface LintResult {
  fixed: boolean;
  fixCount: number;
  output: string;
}

export class ESLintUtils {
  constructor(private logger: Logger) {}

  async lintFile(_filePath: string): Promise<LintResult> {
    this.logger.info('ESLint linting not yet implemented');
    return {
      fixed: false,
      fixCount: 0,
      output: 'ESLint linting not yet implemented',
    };
  }

  async fixFile(_filePath: string): Promise<LintResult> {
    this.logger.info('ESLint fixing not yet implemented');
    return {
      fixed: false,
      fixCount: 0,
      output: 'ESLint fixing not yet implemented',
    };
  }
}