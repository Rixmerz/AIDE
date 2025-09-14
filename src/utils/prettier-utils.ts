/**
 * Prettier Utilities for AIDE MCP Server
 * 
 * Provides Prettier integration for code formatting
 */

import prettier from 'prettier';
import type { Logger } from './logger.js';
import { ConfigurationError, FileOperationError } from './errors.js';

export interface PrettierConfig {
  printWidth?: number;
  tabWidth?: number;
  useTabs?: boolean;
  semi?: boolean;
  singleQuote?: boolean;
  quoteProps?: 'as-needed' | 'consistent' | 'preserve';
  jsxSingleQuote?: boolean;
  trailingComma?: 'none' | 'es5' | 'all';
  bracketSpacing?: boolean;
  bracketSameLine?: boolean;
  arrowParens?: 'avoid' | 'always';
  endOfLine?: 'lf' | 'crlf' | 'cr' | 'auto';
  embeddedLanguageFormatting?: 'auto' | 'off';
  singleAttributePerLine?: boolean;
}

export interface FormatResult {
  filePath: string;
  formatted: boolean;
  originalContent: string;
  formattedContent: string;
  changes: number;
  error?: string;
}

export class PrettierUtils {
  private config: PrettierConfig;
  private logger: Logger;

  constructor(logger: Logger, config?: PrettierConfig) {
    this.logger = logger;
    
    this.config = {
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: true,
      quoteProps: 'as-needed',
      jsxSingleQuote: true,
      trailingComma: 'es5',
      bracketSpacing: true,
      bracketSameLine: false,
      arrowParens: 'avoid',
      endOfLine: 'lf',
      embeddedLanguageFormatting: 'auto',
      singleAttributePerLine: false,
      ...config,
    };
  }

  async formatFile(filePath: string, content?: string): Promise<FormatResult> {
    try {
      this.logger.debug(`Formatting file: ${filePath}`);

      let originalContent = content;
      
      if (!originalContent) {
        const fs = await import('fs/promises');
        originalContent = await fs.readFile(filePath, 'utf-8');
      }

      const fileInfo = await prettier.getFileInfo(filePath);
      
      if (!fileInfo.inferredParser) {
        return {
          filePath,
          formatted: false,
          originalContent,
          formattedContent: originalContent,
          changes: 0,
          error: 'No parser could be inferred for file',
        };
      }

      const options = await this.resolveConfig(filePath);
      const formattedContent = await prettier.format(originalContent, {
        ...options,
        filepath: filePath,
      });

      const changes = this.countChanges(originalContent, formattedContent);

      return {
        filePath,
        formatted: changes > 0,
        originalContent,
        formattedContent,
        changes,
      };
    } catch (error) {
      return {
        filePath,
        formatted: false,
        originalContent: content || '',
        formattedContent: content || '',
        changes: 0,
        error: String(error),
      };
    }
  }

  async formatFiles(filePaths: string[]): Promise<FormatResult[]> {
    this.logger.debug(`Formatting ${filePaths.length} files`);
    
    const results: FormatResult[] = [];
    
    for (const filePath of filePaths) {
      const result = await this.formatFile(filePath);
      results.push(result);
    }
    
    return results;
  }

  async formatText(text: string, parser: string): Promise<string> {
    try {
      return await prettier.format(text, {
        ...this.config,
        parser,
      });
    } catch (error) {
      throw new ConfigurationError(`Failed to format text with parser ${parser}: ${error}`);
    }
  }

  async checkFile(filePath: string): Promise<boolean> {
    try {
      this.logger.debug(`Checking formatting for: ${filePath}`);
      
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      
      const options = await this.resolveConfig(filePath);
      const isFormatted = await prettier.check(content, {
        ...options,
        filepath: filePath,
      });
      
      return isFormatted;
    } catch (error) {
      this.logger.warn(`Failed to check file formatting: ${error}`);
      return false;
    }
  }

  async checkFiles(filePaths: string[]): Promise<{ filePath: string; isFormatted: boolean }[]> {
    this.logger.debug(`Checking formatting for ${filePaths.length} files`);
    
    const results: { filePath: string; isFormatted: boolean }[] = [];
    
    for (const filePath of filePaths) {
      const isFormatted = await this.checkFile(filePath);
      results.push({ filePath, isFormatted });
    }
    
    return results;
  }

  private async resolveConfig(filePath: string): Promise<PrettierConfig> {
    try {
      const resolvedConfig = await prettier.resolveConfig(filePath);
      return {
        ...this.config,
        ...resolvedConfig,
      };
    } catch (error) {
      this.logger.warn(`Failed to resolve Prettier config, using defaults: ${error}`);
      return this.config;
    }
  }

  private countChanges(original: string, formatted: string): number {
    if (original === formatted) return 0;
    
    const originalLines = original.split('\n');
    const formattedLines = formatted.split('\n');
    
    let changes = 0;
    const maxLines = Math.max(originalLines.length, formattedLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const originalLine = originalLines[i] || '';
      const formattedLine = formattedLines[i] || '';
      
      if (originalLine !== formattedLine) {
        changes++;
      }
    }
    
    return changes;
  }

  async getSupportedLanguages(): Promise<string[]> {
    try {
      const info = await prettier.getSupportInfo();
      return info.languages.map(lang => lang.name);
    } catch (error) {
      this.logger.warn(`Failed to get supported languages: ${error}`);
      return [];
    }
  }

  async createConfig(config: PrettierConfig): Promise<string> {
    const configContent = JSON.stringify(config, null, 2);
    return `// prettier.config.js
module.exports = ${configContent};
`;
  }

  generateReport(results: FormatResult[]): string {
    let report = '# Prettier Formatting Report\n\n';
    
    const formattedFiles = results.filter(r => r.formatted);
    const errorFiles = results.filter(r => r.error);
    const totalChanges = results.reduce((sum, r) => sum + r.changes, 0);
    
    report += `## Summary\n`;
    report += `- **Files processed:** ${results.length}\n`;
    report += `- **Files formatted:** ${formattedFiles.length}\n`;
    report += `- **Files with errors:** ${errorFiles.length}\n`;
    report += `- **Total changes:** ${totalChanges}\n\n`;
    
    if (formattedFiles.length > 0) {
      report += `## Formatted Files\n\n`;
      formattedFiles.forEach(result => {
        report += `### ${result.filePath}\n`;
        report += `- **Changes:** ${result.changes} lines modified\n\n`;
      });
    }
    
    if (errorFiles.length > 0) {
      report += `## Files with Errors\n\n`;
      errorFiles.forEach(result => {
        report += `### ${result.filePath}\n`;
        report += `- **Error:** ${result.error}\n\n`;
      });
    }
    
    if (formattedFiles.length === 0 && errorFiles.length === 0) {
      report += `✅ All files are already properly formatted!\n`;
    }
    
    return report;
  }

  async updateConfig(newConfig: Partial<PrettierConfig>): Promise<void> {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    
    this.logger.info('Prettier configuration updated');
  }

  getConfig(): PrettierConfig {
    return { ...this.config };
  }
}