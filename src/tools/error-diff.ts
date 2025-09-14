/**
 * Error Diff Tool for AIDE MCP Server
 * 
 * Compares TypeScript errors between builds and provides detailed analysis
 */

import { z } from 'zod';
import { TypeScriptUtils } from '../utils/typescript-utils-simple.js';
import type { ToolContext } from './index.js';

const ErrorDiffSchema = z.object({
  beforeBuild: z.string().min(1, 'beforeBuild output cannot be empty'),
  afterBuild: z.string().min(1, 'afterBuild output cannot be empty'),
  includeReport: z.boolean().optional().default(true),
});

export async function handleErrorDiff(args: any, context: ToolContext) {
  const validated = ErrorDiffSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting TypeScript error diff analysis');
    
    const tsUtils = new TypeScriptUtils(logger);
    
    // Parse errors from build outputs
    logger.debug('Parsing before build errors');
    const beforeErrors = tsUtils.parseCompilerOutput(validated.beforeBuild);
    
    logger.debug('Parsing after build errors');
    const afterErrors = tsUtils.parseCompilerOutput(validated.afterBuild);
    
    // Compare errors
    logger.debug('Comparing error sets');
    const errorDiff = tsUtils.compareErrors(beforeErrors, afterErrors);
    
    // Generate reports
    let response = `# TypeScript Error Diff Analysis\n\n`;
    
    // Summary
    response += `## Summary\n`;
    response += `- **Before:** ${errorDiff.summary.totalBefore} errors\n`;
    response += `- **After:** ${errorDiff.summary.totalAfter} errors\n`;
    response += `- **Resolved:** ${errorDiff.summary.resolved} errors ✅\n`;
    response += `- **New:** ${errorDiff.summary.new} errors 🚨\n`;
    response += `- **Persistent:** ${errorDiff.summary.persistent} errors 🔄\n\n`;
    
    // Progress indicator
    const netChange = errorDiff.summary.totalAfter - errorDiff.summary.totalBefore;
    if (netChange < 0) {
      response += `🎉 **Great progress!** You fixed ${Math.abs(netChange)} more errors than you introduced.\n\n`;
    } else if (netChange > 0) {
      response += `⚠️ **Attention needed:** ${netChange} more errors were introduced than fixed.\n\n`;
    } else {
      response += `➡️ **Status quo:** Same number of total errors, but composition may have changed.\n\n`;
    }
    
    if (validated.includeReport) {
      // Detailed diff report
      response += tsUtils.generateErrorDiffReport(errorDiff);
    }
    
    // Error categorization for resolved errors
    if (errorDiff.resolved.length > 0) {
      const resolvedCategories = tsUtils.categorizeErrors(errorDiff.resolved);
      response += `## Resolved Errors by Category\n`;
      for (const [category, errors] of Object.entries(resolvedCategories)) {
        if (errors.length > 0) {
          response += `- **${category.replace('-', ' ').toUpperCase()}:** ${errors.length} resolved\n`;
        }
      }
      response += '\n';
    }
    
    // Error categorization for new errors
    if (errorDiff.newErrors.length > 0) {
      const newCategories = tsUtils.categorizeErrors(errorDiff.newErrors);
      response += `## New Errors by Category\n`;
      for (const [category, errors] of Object.entries(newCategories)) {
        if (errors.length > 0) {
          response += `- **${category.replace('-', ' ').toUpperCase()}:** ${errors.length} new\n`;
        }
      }
      response += '\n';
    }
    
    // Recommendations
    response += `## Recommendations\n`;
    if (errorDiff.newErrors.length > 0) {
      const newCategories = tsUtils.categorizeErrors(errorDiff.newErrors);
      
      if (newCategories['unused-imports'].length > 0 || newCategories['unused-variables'].length > 0) {
        response += `- Use \`typescript_auto_fix\` tool to clean up unused imports and variables\n`;
      }
      
      if (newCategories['null-checks'].length > 0) {
        response += `- Use \`typescript_auto_fix\` tool with \`null-checks\` to add proper null/undefined handling\n`;
      }
      
      if (newCategories['missing-properties'].length > 0) {
        response += `- Review missing properties and update type definitions or add required properties\n`;
      }
      
      if (newCategories['syntax-errors'].length > 0) {
        response += `- Fix syntax errors first as they may be causing cascade errors\n`;
      }
    } else if (errorDiff.resolved.length > 0) {
      response += `- Great job! Keep up the good work fixing these TypeScript errors\n`;
    }
    
    if (errorDiff.persistentErrors.length > 0) {
      response += `- ${errorDiff.persistentErrors.length} errors persist and may need focused attention\n`;
    }

    logger.info('Error diff analysis completed successfully', {
      resolved: errorDiff.summary.resolved,
      new: errorDiff.summary.new,
      persistent: errorDiff.summary.persistent,
    });

    return {
      content: [
        {
          type: 'text',
          text: response,
        },
      ],
    };
  } catch (error) {
    logger.error('Error in error_diff tool:', error);
    throw error;
  }
}