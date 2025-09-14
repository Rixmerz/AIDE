/**
 * Simplified TypeScript Analysis Utilities for AIDE MCP Server
 */

// import { TypeScriptAnalysisError } from './errors.js';
import type { Logger } from './logger.js';

export interface CompilerError {
  file?: string;
  line?: number;
  column?: number;
  code: number;
  message: string;
  category: keyof ErrorCategories;
  severity: 'error' | 'warning' | 'suggestion';
}

export interface ErrorCategories {
  'unused-variables': CompilerError[];
  'unused-imports': CompilerError[];
  'missing-properties': CompilerError[];
  'null-checks': CompilerError[];
  'type-errors': CompilerError[];
  'syntax-errors': CompilerError[];
  'other': CompilerError[];
}

export interface ErrorDiff {
  resolved: CompilerError[];
  newErrors: CompilerError[];
  persistentErrors: CompilerError[];
  summary: {
    totalBefore: number;
    totalAfter: number;
    resolved: number;
    new: number;
    persistent: number;
  };
}

export class TypeScriptUtils {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  parseCompilerOutput(output: string): CompilerError[] {
    const errors: CompilerError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const error = this.parseErrorLine(line.trim());
      if (error) {
        errors.push(error);
      }
    }

    this.logger.debug(`Parsed ${errors.length} errors from compiler output`);
    return errors;
  }

  private parseErrorLine(line: string): CompilerError | null {
    // Match TypeScript error format: path(line,column): error TSxxxx: message
    const tsErrorRegex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/;
    const match = line.match(tsErrorRegex);

    if (match) {
      const [, file, lineStr, columnStr, severityStr, codeStr, message] = match;
      const code = parseInt(codeStr || '0', 10);
      return {
        file: file?.trim() || '',
        line: parseInt(lineStr || '0', 10),
        column: parseInt(columnStr || '0', 10),
        code,
        message: message?.trim() || '',
        category: this.categorizeErrorByCode(code),
        severity: severityStr === 'error' ? 'error' : 'warning',
      };
    }

    // Match simple error format: TSxxxx: message
    const simpleErrorRegex = /^TS(\d+):\s+(.+)$/;
    const simpleMatch = line.match(simpleErrorRegex);

    if (simpleMatch) {
      const [, codeStr, message] = simpleMatch;
      const code = parseInt(codeStr || '0', 10);
      return {
        code,
        message: message?.trim() || '',
        category: this.categorizeErrorByCode(code),
        severity: 'error',
      };
    }

    return null;
  }

  private categorizeErrorByCode(code: number): keyof ErrorCategories {
    // Common TypeScript error codes categorization
    const categories: Record<number, keyof ErrorCategories> = {
      // Unused variables/imports
      6133: 'unused-variables', // 'variable' is declared but its value is never read
      6196: 'unused-imports', // 'import' is declared but its value is never read
      6198: 'unused-imports', // All imports in import declaration are unused
      
      // Missing properties
      2339: 'missing-properties', // Property 'x' does not exist on type 'y'
      2345: 'missing-properties', // Argument of type 'x' is not assignable to parameter of type 'y'
      2741: 'missing-properties', // Property 'x' is missing in type 'y' but required in type 'z'
      
      // Null/undefined checks
      2322: 'null-checks', // Type 'undefined' is not assignable to type 'x'
      2531: 'null-checks', // Object is possibly 'null'
      2532: 'null-checks', // Object is possibly 'undefined'
      2533: 'null-checks', // Object is possibly 'null' or 'undefined'
      2722: 'null-checks', // Cannot invoke an object which is possibly 'undefined'
      
      // Syntax errors
      1005: 'syntax-errors', // ';' expected
      1109: 'syntax-errors', // Expression expected
      1128: 'syntax-errors', // Declaration or statement expected
      1002: 'syntax-errors', // Unterminated string literal
      
      // Type errors
      2304: 'type-errors', // Cannot find name 'x'
      2307: 'type-errors', // Cannot find module 'x'
      2352: 'type-errors', // Conversion of type 'x' to type 'y' may be a mistake
      2366: 'type-errors', // Function lacks ending return statement
    };

    return categories[code] || 'other';
  }

  categorizeErrors(errors: CompilerError[]): ErrorCategories {
    const categories: ErrorCategories = {
      'unused-variables': [],
      'unused-imports': [],
      'missing-properties': [],
      'null-checks': [],
      'type-errors': [],
      'syntax-errors': [],
      'other': [],
    };

    for (const error of errors) {
      if (error.category in categories) {
        categories[error.category].push(error);
      } else {
        categories['other'].push(error);
      }
    }

    return categories;
  }

  compareErrors(beforeErrors: CompilerError[], afterErrors: CompilerError[]): ErrorDiff {
    const beforeSet = new Set(beforeErrors.map(e => this.errorSignature(e)));
    const afterSet = new Set(afterErrors.map(e => this.errorSignature(e)));

    const resolved = beforeErrors.filter(e => !afterSet.has(this.errorSignature(e)));
    const newErrors = afterErrors.filter(e => !beforeSet.has(this.errorSignature(e)));
    const persistentErrors = beforeErrors.filter(e => afterSet.has(this.errorSignature(e)));

    return {
      resolved,
      newErrors,
      persistentErrors,
      summary: {
        totalBefore: beforeErrors.length,
        totalAfter: afterErrors.length,
        resolved: resolved.length,
        new: newErrors.length,
        persistent: persistentErrors.length,
      },
    };
  }

  private errorSignature(error: CompilerError): string {
    return `${error.file || 'unknown'}:${error.line || 0}:${error.column || 0}:${error.code}`;
  }

  generateErrorReport(errors: CompilerError[]): string {
    const categories = this.categorizeErrors(errors);
    let report = `TypeScript Error Report\n${'='.repeat(50)}\n\n`;

    report += `Total Errors: ${errors.length}\n\n`;

    for (const [category, categoryErrors] of Object.entries(categories)) {
      if (categoryErrors.length > 0) {
        report += `${category.toUpperCase().replace('-', ' ')} (${categoryErrors.length}):\n`;
        report += '-'.repeat(30) + '\n';
        
        categoryErrors.slice(0, 10).forEach((error: CompilerError) => {
          report += `  ${error.file || 'unknown'}:${error.line || '?'}:${error.column || '?'} - TS${error.code}: ${error.message}\n`;
        });

        if (categoryErrors.length > 10) {
          report += `  ... and ${categoryErrors.length - 10} more\n`;
        }
        
        report += '\n';
      }
    }

    return report;
  }

  generateErrorDiffReport(diff: ErrorDiff): string {
    let report = `TypeScript Error Diff Report\n${'='.repeat(50)}\n\n`;

    report += `Summary:\n`;
    report += `  Before: ${diff.summary.totalBefore} errors\n`;
    report += `  After:  ${diff.summary.totalAfter} errors\n`;
    report += `  Resolved: ${diff.summary.resolved} errors\n`;
    report += `  New: ${diff.summary.new} errors\n`;
    report += `  Persistent: ${diff.summary.persistent} errors\n\n`;

    if (diff.resolved.length > 0) {
      report += `✅ RESOLVED ERRORS (${diff.resolved.length}):\n`;
      report += '-'.repeat(30) + '\n';
      diff.resolved.slice(0, 10).forEach(error => {
        report += `  ${error.file || 'unknown'}:${error.line || '?'}:${error.column || '?'} - TS${error.code}: ${error.message}\n`;
      });
      if (diff.resolved.length > 10) {
        report += `  ... and ${diff.resolved.length - 10} more\n`;
      }
      report += '\n';
    }

    if (diff.newErrors.length > 0) {
      report += `🚨 NEW ERRORS (${diff.newErrors.length}):\n`;
      report += '-'.repeat(30) + '\n';
      diff.newErrors.slice(0, 10).forEach(error => {
        report += `  ${error.file || 'unknown'}:${error.line || '?'}:${error.column || '?'} - TS${error.code}: ${error.message}\n`;
      });
      if (diff.newErrors.length > 10) {
        report += `  ... and ${diff.newErrors.length - 10} more\n`;
      }
      report += '\n';
    }

    return report;
  }
}