/**
 * TypeScript Analyzer for AIDE MCP Server
 * 
 * Advanced TypeScript error analysis and pattern detection
 */

import { TypeScriptUtils, type CompilerError, type ErrorCategories } from '../utils/typescript-utils-simple.js';
import type { Logger } from '../utils/logger.js';

export interface ErrorPattern {
  pattern: string;
  description: string;
  category: keyof ErrorCategories;
  frequency: number;
  suggestedFix: string;
  examples: string[];
}

export interface AutoFix {
  description: string;
  confidence: 'high' | 'medium' | 'low';
  riskLevel: 'safe' | 'moderate' | 'risky';
  implementation: string;
  dependencies?: string[];
}

export class TypeScriptAnalyzer {
  private tsUtils: TypeScriptUtils;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.tsUtils = new TypeScriptUtils(logger);
  }

  async analyzeErrors(errors: CompilerError[]): Promise<{
    categories: ErrorCategories;
    patterns: ErrorPattern[];
    suggestions: AutoFix[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> {
    this.logger.info('Starting comprehensive TypeScript error analysis', {
      errorCount: errors.length,
    });

    const categories = this.tsUtils.categorizeErrors(errors);
    const patterns = this.detectErrorPatterns(errors);
    const suggestions = this.generateAutoFixSuggestions(categories, patterns);
    const severity = this.assessSeverity(categories);

    return {
      categories,
      patterns,
      suggestions,
      severity,
    };
  }

  private detectErrorPatterns(errors: CompilerError[]): ErrorPattern[] {
    const patterns: ErrorPattern[] = [];
    const messageGroups = new Map<string, CompilerError[]>();

    // Group errors by similar messages
    for (const error of errors) {
      const normalizedMessage = this.normalizeErrorMessage(error.message);
      if (!messageGroups.has(normalizedMessage)) {
        messageGroups.set(normalizedMessage, []);
      }
      messageGroups.get(normalizedMessage)!.push(error);
    }

    // Identify patterns with frequency > 1
    for (const [normalizedMessage, groupedErrors] of messageGroups) {
      if (groupedErrors.length > 1) {
        const pattern = this.createErrorPattern(normalizedMessage, groupedErrors);
        patterns.push(pattern);
      }
    }

    // Sort by frequency (most common first)
    patterns.sort((a, b) => b.frequency - a.frequency);

    this.logger.debug(`Detected ${patterns.length} error patterns`);
    return patterns.slice(0, 10); // Return top 10 patterns
  }

  private normalizeErrorMessage(message: string): string {
    // Normalize error messages to detect patterns
    return message
      .replace(/'[^']+'/g, "'<identifier>'") // Replace quoted identifiers
      .replace(/\d+/g, '<number>') // Replace numbers
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private createErrorPattern(normalizedMessage: string, errors: CompilerError[]): ErrorPattern {
    const firstError = errors[0]!;
    const category = firstError.category;
    
    return {
      pattern: normalizedMessage,
      description: this.getPatternDescription(normalizedMessage, category),
      category,
      frequency: errors.length,
      suggestedFix: this.getSuggestedFix(normalizedMessage, category),
      examples: errors.slice(0, 3).map(e => e.message),
    };
  }

  private getPatternDescription(normalizedMessage: string, category: keyof ErrorCategories): string {
    const descriptions: Record<string, string> = {
      "Property '<identifier>' does not exist on type '<identifier>'": "Missing properties on type definitions",
      "Cannot find name '<identifier>'": "Undefined variables or missing imports",
      "Object is possibly 'null' or 'undefined'": "Missing null/undefined checks",
      "Argument of type '<identifier>' is not assignable to parameter of type '<identifier>'": "Type mismatch in function calls",
      "'<identifier>' is declared but its value is never read": "Unused variable declarations",
    };

    return descriptions[normalizedMessage] || `Recurring ${category} error`;
  }

  private getSuggestedFix(normalizedMessage: string, category: keyof ErrorCategories): string {
    const fixes: Record<string, string> = {
      "Property '<identifier>' does not exist on type '<identifier>'": "Add missing property to type definition or use optional chaining",
      "Cannot find name '<identifier>'": "Add import statement or declare the variable",
      "Object is possibly 'null' or 'undefined'": "Add null check or use optional chaining operator (?.)",
      "Argument of type '<identifier>' is not assignable to parameter of type '<identifier>'": "Update type annotation or cast the argument",
      "'<identifier>' is declared but its value is never read": "Remove unused variable or add underscore prefix to indicate intentional",
    };

    return fixes[normalizedMessage] || `Review and fix ${category} issues manually`;
  }

  private generateAutoFixSuggestions(categories: ErrorCategories, patterns: ErrorPattern[]): AutoFix[] {
    const suggestions: AutoFix[] = [];

    // Unused imports fix
    if (categories['unused-imports'].length > 0) {
      suggestions.push({
        description: `Remove ${categories['unused-imports'].length} unused import statements`,
        confidence: 'high',
        riskLevel: 'safe',
        implementation: 'Use typescript_auto_fix tool with errorType: "unused-imports"',
      });
    }

    // Unused variables fix
    if (categories['unused-variables'].length > 0) {
      suggestions.push({
        description: `Clean up ${categories['unused-variables'].length} unused variables`,
        confidence: 'medium',
        riskLevel: 'moderate',
        implementation: 'Use typescript_auto_fix tool with errorType: "unused-variables"',
      });
    }

    // Null checks fix
    if (categories['null-checks'].length > 0) {
      suggestions.push({
        description: `Add null/undefined checks for ${categories['null-checks'].length} potential null pointer errors`,
        confidence: 'medium',
        riskLevel: 'moderate',
        implementation: 'Use typescript_auto_fix tool with errorType: "null-checks"',
        dependencies: ['Verify business logic after adding null checks'],
      });
    }

    // Pattern-based suggestions
    for (const pattern of patterns) {
      if (pattern.frequency >= 5) {
        suggestions.push({
          description: `Address recurring pattern: ${pattern.description} (${pattern.frequency} occurrences)`,
          confidence: 'medium',
          riskLevel: 'moderate',
          implementation: pattern.suggestedFix,
        });
      }
    }

    return suggestions;
  }

  private assessSeverity(categories: ErrorCategories): 'low' | 'medium' | 'high' | 'critical' {
    const syntaxErrors = categories['syntax-errors'].length;
    const typeErrors = categories['type-errors'].length;
    const totalErrors = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

    if (syntaxErrors > 0) {
      return 'critical'; // Syntax errors prevent compilation
    }

    if (typeErrors > 20 || totalErrors > 100) {
      return 'high';
    }

    if (typeErrors > 5 || totalErrors > 30) {
      return 'medium';
    }

    return 'low';
  }

  generateAnalysisReport(analysis: {
    categories: ErrorCategories;
    patterns: ErrorPattern[];
    suggestions: AutoFix[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }): string {
    let report = `# TypeScript Error Analysis Report\n\n`;

    // Severity assessment
    const severityEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };

    report += `## Overall Severity: ${severityEmoji[analysis.severity]} ${analysis.severity.toUpperCase()}\n\n`;

    // Error breakdown by category
    report += `## Error Breakdown\n\n`;
    const totalErrors = Object.values(analysis.categories).reduce((sum, arr) => sum + arr.length, 0);
    report += `**Total Errors:** ${totalErrors}\n\n`;

    for (const [category, errors] of Object.entries(analysis.categories)) {
      if (errors.length > 0) {
        const percentage = ((errors.length / totalErrors) * 100).toFixed(1);
        report += `- **${category.replace('-', ' ').toUpperCase()}:** ${errors.length} (${percentage}%)\n`;
      }
    }
    report += '\n';

    // Common patterns
    if (analysis.patterns.length > 0) {
      report += `## Common Error Patterns\n\n`;
      for (const pattern of analysis.patterns.slice(0, 5)) {
        report += `### ${pattern.description}\n`;
        report += `- **Frequency:** ${pattern.frequency} occurrences\n`;
        report += `- **Category:** ${pattern.category}\n`;
        report += `- **Suggested Fix:** ${pattern.suggestedFix}\n\n`;
      }
    }

    // Auto-fix suggestions
    if (analysis.suggestions.length > 0) {
      report += `## Recommended Actions\n\n`;
      
      // Group by risk level
      const safeActions = analysis.suggestions.filter(s => s.riskLevel === 'safe');
      const moderateActions = analysis.suggestions.filter(s => s.riskLevel === 'moderate');
      const riskyActions = analysis.suggestions.filter(s => s.riskLevel === 'risky');

      if (safeActions.length > 0) {
        report += `### ✅ Safe Actions (Low Risk)\n`;
        for (const action of safeActions) {
          report += `- ${action.description}\n`;
          report += `  - **Implementation:** ${action.implementation}\n`;
          report += `  - **Confidence:** ${action.confidence}\n\n`;
        }
      }

      if (moderateActions.length > 0) {
        report += `### ⚠️ Moderate Actions (Review Required)\n`;
        for (const action of moderateActions) {
          report += `- ${action.description}\n`;
          report += `  - **Implementation:** ${action.implementation}\n`;
          report += `  - **Confidence:** ${action.confidence}\n`;
          if (action.dependencies) {
            report += `  - **Dependencies:** ${action.dependencies.join(', ')}\n`;
          }
          report += '\n';
        }
      }

      if (riskyActions.length > 0) {
        report += `### 🚨 High-Risk Actions (Manual Review Required)\n`;
        for (const action of riskyActions) {
          report += `- ${action.description}\n`;
          report += `  - **Implementation:** ${action.implementation}\n`;
          report += `  - **Confidence:** ${action.confidence}\n`;
          if (action.dependencies) {
            report += `  - **Dependencies:** ${action.dependencies.join(', ')}\n`;
          }
          report += '\n';
        }
      }
    }

    // Priority recommendations
    report += `## Priority Recommendations\n\n`;
    if (analysis.severity === 'critical') {
      report += `1. **URGENT:** Fix syntax errors first - they prevent compilation\n`;
      report += `2. Address type errors in order of frequency\n`;
      report += `3. Clean up unused imports and variables\n`;
    } else if (analysis.severity === 'high') {
      report += `1. Focus on type errors first\n`;
      report += `2. Use auto-fix tools for safe cleanup tasks\n`;
      report += `3. Address recurring patterns\n`;
    } else {
      report += `1. Use auto-fix tools to clean up minor issues\n`;
      report += `2. Focus on code quality improvements\n`;
      report += `3. Consider stricter TypeScript settings\n`;
    }

    return report;
  }
}