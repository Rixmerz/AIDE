/**
 * Code Formatter Tool for AIDE MCP Server
 * 
 * Integrates Prettier and ESLint for comprehensive code formatting
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { PrettierUtils } from '../utils/prettier-utils-simple.js';
import { ESLintUtils } from '../utils/eslint-utils-simple.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const CodeFormatterSchema = z.object({
  operation: z.enum(['format-prettier', 'fix-eslint', 'format-and-fix', 'check-formatting']),
  files: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
  
  // Prettier options
  prettierConfig: z.object({
    printWidth: z.number().optional(),
    tabWidth: z.number().optional(),
    useTabs: z.boolean().optional(),
    semi: z.boolean().optional(),
    singleQuote: z.boolean().optional(),
    trailingComma: z.enum(['none', 'es5', 'all']).optional(),
    bracketSpacing: z.boolean().optional(),
    arrowParens: z.enum(['avoid', 'always']).optional(),
  }).optional(),

  // ESLint options  
  eslintRules: z.record(z.union([z.string(), z.number(), z.array(z.any())])).optional(),
  
  // File filtering
  includeGlob: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  excludeGlob: z.string().optional(),
  
  // Batch processing
  parallel: z.boolean().optional().default(true),
  maxConcurrency: z.number().min(1).max(10).optional().default(5),
});

interface FormattingResult {
  file: string;
  success: boolean;
  prettierApplied: boolean;
  eslintApplied: boolean;
  prettierChanges: number;
  eslintChanges: number;
  error?: string;
  details?: {
    originalSize: number;
    formattedSize: number;
    lintIssuesFixed: number;
  };
  analysis?: {
    fileType: string;
    lineCount: number;
    characterCount: number;
    indentationStyle: 'tabs' | 'spaces' | 'mixed';
    averageLineLength: number;
    longestLine: number;
    codeComplexity: 'low' | 'medium' | 'high';
    formattingQuality: 'excellent' | 'good' | 'needs-improvement' | 'poor';
    issues: {
      inconsistentIndentation: number;
      longLines: number;
      trailingWhitespace: number;
      missingNewlines: number;
    };
    suggestions: string[];
  };
}

export async function handleCodeFormatter(args: any, context: ToolContext) {
  const validated = CodeFormatterSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting code formatting operation', {
      operation: validated.operation,
      filesCount: validated.files?.length || 'pattern-based',
      dryRun: validated.dryRun,
    });

    const fileOps = new FileOperations(logger);
    const prettierUtils = new PrettierUtils(logger, validated.prettierConfig || undefined);
    const eslintUtils = new ESLintUtils(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    // Determine files to process
    let filesToProcess: string[];
    if (validated.files && validated.files.length > 0) {
      filesToProcess = validated.files;
    } else {
      const allFiles = await fileOps.findFiles(validated.includeGlob);
      if (validated.excludeGlob) {
        const excludedFiles = await fileOps.findFiles(validated.excludeGlob);
        const excludedSet = new Set(excludedFiles);
        filesToProcess = allFiles.filter(file => !excludedSet.has(file));
      } else {
        filesToProcess = allFiles;
      }
    }

    if (filesToProcess.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No files found to format.',
          },
        ],
      };
    }

    let response = `# Code Formatting Operation\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files to process:** ${filesToProcess.length}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE FORMAT'}\n`;
    if (validated.parallel) {
      response += `**Processing:** Parallel (max ${validated.maxConcurrency} concurrent)\n`;
    }
    response += '\n';

    // Process files
    const results: FormattingResult[] = [];
    const fileEdits: FileEdit[] = [];
    const fileSnapshots: FileSnapshot[] = [];

    if (validated.parallel && validated.maxConcurrency > 1) {
      // Process files in parallel batches
      const batches = chunkArray(filesToProcess, validated.maxConcurrency);
      
      for (const batch of batches) {
        const batchPromises = batch.map(file => 
          processFileFormatting(file, validated, prettierUtils, eslintUtils, fileOps, logger)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
    } else {
      // Process files sequentially
      for (const file of filesToProcess) {
        const result = await processFileFormatting(
          file, 
          validated, 
          prettierUtils, 
          eslintUtils, 
          fileOps, 
          logger
        );
        results.push(result);
      }
    }

    // Prepare edits for successful formatting
    for (const result of results) {
      if (result.success && (result.prettierApplied || result.eslintApplied)) {
        const originalContent = await fileOps.readFile(result.file);
        let formattedContent = originalContent;

        // Apply formatting based on operation
        if (validated.operation === 'format-prettier' || validated.operation === 'format-and-fix') {
          if (result.prettierApplied) {
            const prettierResult = await prettierUtils.formatFile(result.file);
            if (prettierResult.formatted) {
              formattedContent = prettierResult.formattedContent;
            }
          }
        }

        if (validated.operation === 'fix-eslint' || validated.operation === 'format-and-fix') {
          if (result.eslintApplied) {
            const eslintResult = await eslintUtils.fixFile(result.file);
            if (eslintResult.fixed) {
              formattedContent = eslintResult.output;
            }
          }
        }

        if (formattedContent !== originalContent) {
          fileEdits.push({
            filePath: result.file,
            oldContent: originalContent,
            newContent: formattedContent,
          });

          fileSnapshots.push({
            filePath: result.file,
            contentBefore: originalContent,
            contentAfter: formattedContent,
          });
        }
      }
    }

    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    response += `**Processing Results:**\n`;
    response += `- Files processed successfully: ${successfulResults.length}\n`;
    response += `- Files with errors: ${failedResults.length}\n`;
    response += `- Files to modify: ${fileEdits.length}\n\n`;

    // Calculate statistics
    const stats = calculateFormattingStats(results);
    
    response += `**Formatting Statistics:**\n`;
    response += `- Files formatted by Prettier: ${stats.prettierFormatted}\n`;
    response += `- Files fixed by ESLint: ${stats.eslintFixed}\n`;
    response += `- Total formatting changes: ${stats.totalFormattingChanges}\n`;
    response += `- Total lint fixes: ${stats.totalLintFixes}\n\n`;

    if (validated.operation === 'check-formatting') {
      // Enhanced check formatting mode with detailed analysis
      const unformattedFiles = results.filter(r => 
        r.success && (r.prettierChanges > 0 || r.eslintChanges > 0)
      );
      const wellFormattedFiles = results.filter(r => 
        r.success && r.prettierChanges === 0 && r.eslintChanges === 0
      );
      
      response += `## 📋 Comprehensive Formatting Analysis\n\n`;
      
      // Overall summary
      response += `### 📊 Summary\n`;
      response += `- **Total files analyzed:** ${results.length}\n`;
      response += `- **Well-formatted files:** ${wellFormattedFiles.length}\n`;
      response += `- **Files needing formatting:** ${unformattedFiles.length}\n`;
      response += `- **Failed to analyze:** ${results.filter(r => !r.success).length}\n\n`;
      
      // Detailed analysis for all files (not just those needing changes)
      if (wellFormattedFiles.length > 0) {
        response += `### ✅ Well-Formatted Files (${wellFormattedFiles.length})\n\n`;
        const sampleWellFormatted = wellFormattedFiles.slice(0, 5);
        
        for (const result of sampleWellFormatted) {
          response += `#### ${result.file}\n`;
          
          if (result.analysis) {
            response += `- **Quality:** ${result.analysis.formattingQuality.charAt(0).toUpperCase() + result.analysis.formattingQuality.slice(1)} \u2705\n`;
            response += `- **Lines:** ${result.analysis.lineCount}\n`;
            response += `- **Indentation:** ${result.analysis.indentationStyle}\n`;
            response += `- **Avg line length:** ${result.analysis.averageLineLength} characters\n`;
            
            if (result.analysis.issues.longLines > 0 || 
                result.analysis.issues.trailingWhitespace > 0 || 
                result.analysis.issues.inconsistentIndentation > 0) {
              response += `- **Minor issues:** `;
              const minorIssues = [];
              if (result.analysis.issues.longLines > 0) minorIssues.push(`${result.analysis.issues.longLines} long lines`);
              if (result.analysis.issues.trailingWhitespace > 0) minorIssues.push(`${result.analysis.issues.trailingWhitespace} trailing spaces`);
              if (result.analysis.issues.inconsistentIndentation > 0) minorIssues.push(`${result.analysis.issues.inconsistentIndentation} indent inconsistencies`);
              response += minorIssues.join(', ') + '\n';
            } else {
              response += `- **Issues:** None detected \u2705\n`;
            }
            
            if (result.analysis.suggestions.length > 0) {
              response += `- **Suggestions:** ${result.analysis.suggestions.slice(0, 2).join(', ')}\n`;
            }
          } else {
            response += `- **Status:** No formatting changes needed \u2705\n`;
          }
          response += '\n';
        }
        
        if (wellFormattedFiles.length > 5) {
          response += `*... and ${wellFormattedFiles.length - 5} more well-formatted files*\n\n`;
        }
      }
      
      if (unformattedFiles.length > 0) {
        response += `### ❌ Files Needing Formatting (${unformattedFiles.length})\n\n`;
        for (const result of unformattedFiles.slice(0, 10)) {
          response += `#### ${result.file}\n`;
          
          if (result.prettierChanges > 0) {
            response += `- **Prettier changes needed:** ${result.prettierChanges}\n`;
          }
          if (result.eslintChanges > 0) {
            response += `- **ESLint fixes needed:** ${result.eslintChanges}\n`;
          }
          
          if (result.analysis) {
            response += `- **Current quality:** ${result.analysis.formattingQuality}\n`;
            response += `- **Primary issues:** `;
            const issues = [];
            if (result.analysis.issues.inconsistentIndentation > 0) issues.push('inconsistent indentation');
            if (result.analysis.issues.longLines > 0) issues.push('long lines');
            if (result.analysis.issues.trailingWhitespace > 0) issues.push('trailing whitespace');
            if (result.analysis.issues.missingNewlines > 0) issues.push('missing newlines');
            response += issues.length > 0 ? issues.join(', ') : 'formatting style' + '\n';
            
            if (result.analysis.suggestions.length > 0) {
              response += `- **Recommended:** ${result.analysis.suggestions[0]}\n`;
            }
          }
          response += '\n';
        }
        
        if (unformattedFiles.length > 10) {
          response += `*... and ${unformattedFiles.length - 10} more files needing formatting*\n\n`;
        }
        
        response += `### 🛠️ Quick Fix\n`;
        response += `To format all files, run:\n`;
        response += `\`\`\`bash\n`;
        response += `# Format with Prettier and ESLint\n`;
        response += `code_formatter operation:format-and-fix\n`;
        response += `\`\`\`\n\n`;
      }
      
      // Codebase health metrics
      if (results.length > 0) {
        const totalLines = results.reduce((sum, r) => sum + (r.analysis?.lineCount || 0), 0);
        const avgComplexity = results.filter(r => r.analysis).map(r => r.analysis!.codeComplexity);
        const complexityDistribution = {
          low: avgComplexity.filter(c => c === 'low').length,
          medium: avgComplexity.filter(c => c === 'medium').length,
          high: avgComplexity.filter(c => c === 'high').length
        };
        
        response += `### 📈 Codebase Health Metrics\n`;
        response += `- **Total lines of code:** ${totalLines.toLocaleString()}\n`;
        response += `- **Formatting compliance:** ${Math.round((wellFormattedFiles.length / results.length) * 100)}%\n`;
        response += `- **Code complexity distribution:**\n`;
        response += `  - Low: ${complexityDistribution.low} files\n`;
        response += `  - Medium: ${complexityDistribution.medium} files\n`;
        response += `  - High: ${complexityDistribution.high} files\n`;
        response += '\n';
      }
      
    } else if (validated.dryRun) {
      // Dry run mode - show preview
      response += `## 🔍 Preview of Formatting Changes\n\n`;
      
      const filesToShow = results.filter(r => r.success && (r.prettierChanges > 0 || r.eslintChanges > 0));
      
      for (const result of filesToShow.slice(0, 10)) {
        response += `### ${result.file}\n`;
        if (result.details) {
          response += `- **Size:** ${result.details.originalSize} → ${result.details.formattedSize} bytes\n`;
        }
        if (result.prettierChanges > 0) {
          response += `- **Prettier:** ${result.prettierChanges} formatting changes\n`;
        }
        if (result.eslintChanges > 0) {
          response += `- **ESLint:** ${result.eslintChanges} lint fixes\n`;
        }
        response += '\n';
      }
      
      if (filesToShow.length > 10) {
        response += `... and ${filesToShow.length - 10} more files with changes\n\n`;
      }

      response += `## Summary\n`;
      response += `To apply formatting, run the same command with \`dryRun: false\`\n`;
      
    } else {
      // Live mode - apply formatting
      if (fileEdits.length > 0) {
        logger.info(`Applying formatting to ${fileEdits.length} files`);
        
        try {
          const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
          
          // Record in history
          const historyId = await historyManager.recordOperation(
            'code_formatter',
            `Code Formatting: ${validated.operation}`,
            `Applied ${validated.operation} to ${fileEdits.length} files`,
            fileSnapshots,
            {
              operation: validated.operation,
              filesModified: fileEdits.length,
              stats,
              backupsCreated: backups.length,
            }
          );
          
          response += `## ✅ Code Formatting Successful\n\n`;
          response += `**Files formatted:** ${fileEdits.length}\n`;
          response += `**Operation ID:** ${historyId}\n\n`;
          
          if (validated.createBackups && backups.length > 0) {
            response += `**Backups created:** ${backups.length}\n\n`;
          }
          
          response += `### Formatting Summary\n`;
          response += `- **Prettier formatting applied:** ${stats.prettierFormatted} files\n`;
          response += `- **ESLint fixes applied:** ${stats.eslintFixed} files\n`;
          response += `- **Total changes:** ${stats.totalFormattingChanges + stats.totalLintFixes}\n\n`;
          
          response += `### Top Formatted Files\n`;
          const topFiles = results
            .filter(r => r.success && (r.prettierChanges > 0 || r.eslintChanges > 0))
            .sort((a, b) => (b.prettierChanges + b.eslintChanges) - (a.prettierChanges + a.eslintChanges))
            .slice(0, 10);
            
          for (const result of topFiles) {
            const totalChanges = result.prettierChanges + result.eslintChanges;
            response += `- **${result.file}**: ${totalChanges} changes`;
            if (result.prettierChanges > 0 && result.eslintChanges > 0) {
              response += ` (${result.prettierChanges} format, ${result.eslintChanges} lint)`;
            }
            response += '\n';
          }
          response += '\n';
          
          response += `## Next Steps\n`;
          response += `- Review formatted code in your editor\n`;
          response += `- Run tests to ensure functionality is preserved\n`;
          response += `- Consider updating your IDE format-on-save settings\n`;
          response += `- Use operation ID ${historyId} to rollback if needed\n`;
          
          logger.info('Code formatting completed successfully', {
            filesFormatted: fileEdits.length,
            stats,
            historyId,
          });
          
        } catch (error) {
          response += `## ❌ Code Formatting Failed\n\n`;
          response += `**Error:** ${error}\n\n`;
          response += `All changes have been rolled back.\n`;
          
          logger.error('Code formatting failed', error);
          throw error;
        }
      } else {
        response += `## ℹ️ No Formatting Needed\n\n`;
        response += `All files are already properly formatted.\n`;
      }

      if (failedResults.length > 0) {
        response += `\n### Files That Could Not Be Formatted\n`;
        for (const result of failedResults) {
          response += `- **${result.file}**: ${result.error}\n`;
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: response,
        },
      ],
    };
  } catch (error) {
    logger.error('Error in code_formatter tool:', error);
    throw error;
  }
}

async function processFileFormatting(
  filePath: string,
  config: z.infer<typeof CodeFormatterSchema>,
  prettierUtils: PrettierUtils,
  eslintUtils: ESLintUtils,
  fileOps: FileOperations,
  _logger: any
): Promise<FormattingResult> {
  try {
    const originalContent = await fileOps.readFile(filePath);
    const originalSize = originalContent.length;
    
    let prettierApplied = false;
    let eslintApplied = false;
    let prettierChanges = 0;
    let eslintChanges = 0;
    let lintIssuesFixed = 0;

    // Check/apply Prettier formatting
    if (config.operation === 'format-prettier' || 
        config.operation === 'format-and-fix' ||
        config.operation === 'check-formatting') {
      
      const prettierResult = await prettierUtils.formatFile(filePath);
      if (prettierResult.formatted) {
        prettierApplied = true;
        prettierChanges = prettierResult.changes;
      }
    }

    // Check/apply ESLint fixes
    if (config.operation === 'fix-eslint' || 
        config.operation === 'format-and-fix' ||
        config.operation === 'check-formatting') {
      
      const eslintResult = await eslintUtils.fixFile(filePath);
      if (eslintResult.fixed) {
        eslintApplied = true;
        eslintChanges = eslintResult.fixCount;
        lintIssuesFixed = eslintResult.fixCount;
      }
    }

    const formattedSize = prettierApplied || eslintApplied ? 
      (await prettierUtils.formatFile(filePath)).formattedContent.length : 
      originalSize;
      
    // Generate comprehensive file analysis
    const analysis = await generateFileAnalysis(filePath, originalContent, config.operation === 'check-formatting');

    return {
      file: filePath,
      success: true,
      prettierApplied,
      eslintApplied,
      prettierChanges,
      eslintChanges,
      details: {
        originalSize,
        formattedSize,
        lintIssuesFixed,
      },
      analysis,
    };
  } catch (error) {
    return {
      file: filePath,
      success: false,
      prettierApplied: false,
      eslintApplied: false,
      prettierChanges: 0,
      eslintChanges: 0,
      error: String(error),
    };
  }
}

// Generate comprehensive file analysis for enhanced reporting
async function generateFileAnalysis(
  filePath: string, 
  content: string, 
  includeDetailedAnalysis: boolean = false
): Promise<FormattingResult['analysis']> {
  try {
    const lines = content.split('\n');
    const lineCount = lines.length;
    const characterCount = content.length;
    
    // Detect file type
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const fileType = {
      'ts': 'TypeScript',
      'tsx': 'TypeScript React',
      'js': 'JavaScript', 
      'jsx': 'JavaScript React',
      'json': 'JSON',
      'css': 'CSS',
      'scss': 'SCSS',
      'less': 'LESS'
    }[extension] || 'Unknown';
    
    // Analyze indentation
    let tabCount = 0;
    let spaceCount = 0;
    let mixedIndentLines = 0;
    
    lines.forEach(line => {
      if (line.startsWith('\t')) tabCount++;
      else if (line.match(/^\s+/)) {
        spaceCount++;
        // Check for mixed indentation
        if (line.includes('\t')) mixedIndentLines++;
      }
    });
    
    const indentationStyle: 'tabs' | 'spaces' | 'mixed' = 
      mixedIndentLines > 0 ? 'mixed' : 
      tabCount > spaceCount ? 'tabs' : 'spaces';
    
    // Calculate line length statistics
    const lineLengths = lines.map(line => line.length);
    const averageLineLength = Math.round(lineLengths.reduce((sum, len) => sum + len, 0) / lineCount);
    const longestLine = Math.max(...lineLengths);
    
    // Analyze code complexity (basic heuristics)
    const complexityIndicators = {
      functions: (content.match(/\bfunction\b|=>/g) || []).length,
      conditionals: (content.match(/\b(if|switch|\?|&&|\|\|)\b/g) || []).length,
      loops: (content.match(/\b(for|while|do)\b/g) || []).length,
      classes: (content.match(/\bclass\s+/g) || []).length,
      imports: (content.match(/^import\s/gm) || []).length
    };
    
    const totalComplexityScore = 
      complexityIndicators.functions * 2 +
      complexityIndicators.conditionals * 1.5 +
      complexityIndicators.loops * 2 +
      complexityIndicators.classes * 3;
    
    const codeComplexity: 'low' | 'medium' | 'high' = 
      totalComplexityScore < 10 ? 'low' :
      totalComplexityScore < 30 ? 'medium' : 'high';
    
    // Detect formatting issues
    const issues = {
      inconsistentIndentation: mixedIndentLines,
      longLines: lineLengths.filter(len => len > 120).length,
      trailingWhitespace: lines.filter(line => line.match(/\s+$/)).length,
      missingNewlines: content.endsWith('\n') ? 0 : 1
    };
    
    // Determine overall formatting quality
    const totalIssues = Object.values(issues).reduce((sum, count) => sum + count, 0);
    const issueRatio = totalIssues / lineCount;
    
    const formattingQuality: 'excellent' | 'good' | 'needs-improvement' | 'poor' = 
      issueRatio === 0 ? 'excellent' :
      issueRatio < 0.05 ? 'good' :
      issueRatio < 0.15 ? 'needs-improvement' : 'poor';
    
    // Generate contextual suggestions
    const suggestions: string[] = [];
    
    if (issues.inconsistentIndentation > 0) {
      suggestions.push(`Standardize indentation (use ${tabCount > spaceCount ? 'tabs' : 'spaces'} consistently)`);
    }
    
    if (issues.longLines > 0) {
      suggestions.push(`Break long lines (${issues.longLines} lines exceed 120 characters)`);
    }
    
    if (issues.trailingWhitespace > 0) {
      suggestions.push(`Remove trailing whitespace from ${issues.trailingWhitespace} lines`);
    }
    
    if (averageLineLength > 80) {
      suggestions.push('Consider shorter, more readable lines');
    }
    
    if (codeComplexity === 'high') {
      suggestions.push('Consider refactoring complex functions for better maintainability');
    }
    
    if (complexityIndicators.imports > 20) {
      suggestions.push('Consider organizing imports into groups');
    }
    
    // Add positive feedback for well-formatted files
    if (formattingQuality === 'excellent') {
      suggestions.push('Code formatting is excellent! ✨');
    } else if (formattingQuality === 'good' && suggestions.length === 0) {
      suggestions.push('Code formatting looks good with minor issues');
    }
    
    return {
      fileType,
      lineCount,
      characterCount,
      indentationStyle,
      averageLineLength,
      longestLine,
      codeComplexity,
      formattingQuality,
      issues,
      suggestions: suggestions.slice(0, 3) // Limit to top 3 suggestions
    };
    
  } catch (error) {
    // Return basic analysis if detailed analysis fails
    return {
      fileType: 'Unknown',
      lineCount: content.split('\n').length,
      characterCount: content.length,
      indentationStyle: 'spaces',
      averageLineLength: 0,
      longestLine: 0,
      codeComplexity: 'low',
      formattingQuality: 'needs-improvement',
      issues: {
        inconsistentIndentation: 0,
        longLines: 0,
        trailingWhitespace: 0,
        missingNewlines: 0
      },
      suggestions: ['Analysis failed - run formatter to check for issues']
    };
  }
}

function calculateFormattingStats(results: FormattingResult[]): {
  prettierFormatted: number;
  eslintFixed: number;
  totalFormattingChanges: number;
  totalLintFixes: number;
} {
  return results.reduce((acc, result) => ({
    prettierFormatted: acc.prettierFormatted + (result.prettierApplied ? 1 : 0),
    eslintFixed: acc.eslintFixed + (result.eslintApplied ? 1 : 0),
    totalFormattingChanges: acc.totalFormattingChanges + result.prettierChanges,
    totalLintFixes: acc.totalLintFixes + result.eslintChanges,
  }), {
    prettierFormatted: 0,
    eslintFixed: 0,
    totalFormattingChanges: 0,
    totalLintFixes: 0,
  });
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}