/**
 * Simplified TypeScript Auto-Fix Tool for AIDE MCP Server
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
// import { TypeScriptUtils } from '../utils/typescript-utils-simple.js';
import type { ToolContext } from './index.js';

const TypeScriptAutoFixSchema = z.object({
  errorType: z.enum(['unused-imports', 'unused-variables', 'missing-properties', 'null-checks', 'all']),
  files: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
});

interface FixResult {
  file: string;
  fixType: string;
  fixesApplied: number;
  success: boolean;
  error?: string;
}

export async function handleTypescriptAutoFix(args: any, context: ToolContext) {
  const validated = TypeScriptAutoFixSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting TypeScript auto-fix operation', {
      errorType: validated.errorType,
      filesCount: validated.files?.length || 'all',
      dryRun: validated.dryRun,
    });

    const fileOps = new FileOperations(logger);
    // const tsUtils = new TypeScriptUtils(logger);
    
    // Determine files to process
    let filesToProcess: string[];
    if (validated.files && validated.files.length > 0) {
      filesToProcess = validated.files;
    } else {
      // Find all TypeScript files in the project
      filesToProcess = await fileOps.findFiles('src/**/*.{ts,tsx}');
    }

    if (filesToProcess.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No TypeScript files found to process.',
          },
        ],
      };
    }

    logger.info(`Processing ${filesToProcess.length} TypeScript files`);

    let response = `# TypeScript Auto-Fix Operation\n\n`;
    response += `**Fix type:** ${validated.errorType}\n`;
    response += `**Files to process:** ${filesToProcess.length}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE FIX'}\n\n`;

    const fixResults: FixResult[] = [];
    const fileEdits: FileEdit[] = [];

    // Process each file
    for (const file of filesToProcess) {
      try {
        const originalContent = await fileOps.readFile(file);
        let fixedContent = originalContent;
        let fixesApplied = 0;

        // Apply fixes based on error type
        if (validated.errorType === 'unused-imports' || validated.errorType === 'all') {
          const { content, fixes } = removeUnusedImports(fixedContent);
          fixedContent = content;
          fixesApplied += fixes;
        }

        if (validated.errorType === 'unused-variables' || validated.errorType === 'all') {
          const { content, fixes } = removeUnusedVariables(fixedContent);
          fixedContent = content;
          fixesApplied += fixes;
        }

        if (validated.errorType === 'null-checks' || validated.errorType === 'all') {
          const { content, fixes } = addBasicNullChecks(fixedContent);
          fixedContent = content;
          fixesApplied += fixes;
        }

        const hasChanges = fixedContent !== originalContent;
        
        fixResults.push({
          file,
          fixType: validated.errorType,
          fixesApplied,
          success: true,
        });

        if (hasChanges) {
          fileEdits.push({
            filePath: file,
            oldContent: originalContent,
            newContent: fixedContent,
          });
        }

      } catch (error) {
        fixResults.push({
          file,
          fixType: validated.errorType,
          fixesApplied: 0,
          success: false,
          error: String(error),
        });
        logger.warn(`Failed to process file ${file}:`, error);
      }
    }

    const successfulFixes = fixResults.filter(r => r.success);
    const failedFixes = fixResults.filter(r => !r.success);
    const totalFixes = successfulFixes.reduce((sum, r) => sum + r.fixesApplied, 0);

    response += `**Results:**\n`;
    response += `- Files processed: ${successfulFixes.length}/${filesToProcess.length}\n`;
    response += `- Files with changes: ${fileEdits.length}\n`;
    response += `- Total fixes applied: ${totalFixes}\n`;
    response += `- Failed files: ${failedFixes.length}\n\n`;

    if (validated.dryRun) {
      response += `## Preview of Fixes\n\n`;
      
      for (const result of successfulFixes.slice(0, 10)) {
        if (result.fixesApplied > 0) {
          response += `### ${result.file}\n`;
          response += `- **Fix type:** ${result.fixType}\n`;
          response += `- **Fixes applied:** ${result.fixesApplied}\n\n`;
        }
      }

      response += `## Summary\n`;
      response += `To apply these fixes, run the same command with \`dryRun: false\`\n`;
      
    } else {
      if (fileEdits.length > 0) {
        await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
        
        response += `## ✅ Auto-Fix Operation Successful\n\n`;
        response += `**Files modified:** ${fileEdits.length}\n`;
        response += `**Total fixes applied:** ${totalFixes}\n`;
        
        logger.info('TypeScript auto-fix operation completed successfully', {
          filesModified: fileEdits.length,
          totalFixes,
        });
      } else {
        response += `## ℹ️ No Fixes Applied\n\n`;
        response += `No files required fixes of type "${validated.errorType}".\n`;
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
    logger.error('Error in typescript_auto_fix tool:', error);
    throw error;
  }
}

// Helper functions for specific fix types
function removeUnusedImports(content: string): { content: string; fixes: number } {
  let fixes = 0;
  const lines = content.split('\n');
  const modifiedLines: string[] = [];

  for (const line of lines) {
    // Simple regex to detect unused imports - very basic implementation
    if (line.match(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/) && 
        !isImportUsed(line, content)) {
      // Skip this line (remove the import)
      fixes++;
    } else {
      modifiedLines.push(line);
    }
  }

  return { content: modifiedLines.join('\n'), fixes };
}

function removeUnusedVariables(content: string): { content: string; fixes: number } {
  let fixes = 0;
  const lines = content.split('\n');
  const modifiedLines: string[] = [];

  for (const line of lines) {
    // Very basic unused variable detection
    if (line.match(/^\s*(?:const|let|var)\s+\w+\s*=.*;\s*$/) && 
        !isVariableUsed(line, content)) {
      // Skip this line (remove the variable)
      fixes++;
    } else {
      modifiedLines.push(line);
    }
  }

  return { content: modifiedLines.join('\n'), fixes };
}

function addBasicNullChecks(content: string): { content: string; fixes: number } {
  let fixes = 0;
  let modifiedContent = content;

  // Very basic null check additions - replace obj.prop with obj?.prop
  const nullCheckRegex = /(\w+)\.(\w+)/g;
  modifiedContent = modifiedContent.replace(nullCheckRegex, (match, obj, prop) => {
    // Only add null check if not already present and not in certain contexts
    if (!content.includes(`${obj}?.${prop}`) && 
        !content.includes(`${obj} &&`) &&
        !match.includes('this.') &&
        !match.includes('console.')) {
      fixes++;
      return `${obj}?.${prop}`;
    }
    return match;
  });

  return { content: modifiedContent, fixes };
}

// Helper functions to check if imports/variables are used
function isImportUsed(importLine: string, content: string): boolean {
  // Extract import names - very basic implementation
  const match = importLine.match(/\{\s*([^}]+)\s*\}/);
  if (!match) return true; // If we can't parse, assume it's used
  
  const imports = match[1]?.split(',').map(imp => imp.trim());
  return imports?.some(imp => {
    const name = imp.split(' as ')[0]?.trim();
    return name ? content.includes(name) : false;
  }) || false;
}

function isVariableUsed(variableLine: string, content: string): boolean {
  // Extract variable name - very basic implementation
  const match = variableLine.match(/(?:const|let|var)\s+(\w+)/);
  if (!match) return true; // If we can't parse, assume it's used
  
  const varName = match[1];
  if (!varName) return true;
  // Check if variable is used elsewhere in content
  const varUsageRegex = new RegExp(`\\b${varName}\\b`, 'g');
  const matches = content.match(varUsageRegex) || [];
  return matches.length > 1; // More than just the declaration
}