/**
 * Advanced Multi-File Edit Tool for AIDE MCP Server
 * 
 * Enhanced version with conflict detection and line-based editing
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const LineRangeEditSchema = z.object({
  file: z.string().min(1, 'File path cannot be empty'),
  startLine: z.number().min(1),
  endLine: z.number().min(1),
  newContent: z.string(),
});

const StringEditSchema = z.object({
  file: z.string().min(1, 'File path cannot be empty'),
  old: z.string(),
  new: z.string(),
});

const AdvancedFileEditSchema = z.union([
  z.object({
    type: z.literal('string'),
    edit: StringEditSchema,
  }),
  z.object({
    type: z.literal('line-range'),
    edit: LineRangeEditSchema,
  }),
]);

const MultiFileEditAdvancedSchema = z.object({
  edits: z.array(AdvancedFileEditSchema).min(1, 'At least one edit must be provided'),
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
  validateConflicts: z.boolean().optional().default(true),
  showContext: z.number().min(0).max(10).optional().default(3),
});

interface EditConflict {
  file: string;
  conflicts: {
    type: 'overlapping-ranges' | 'missing-content' | 'file-changed';
    description: string;
    editIndex1: number;
    editIndex2?: number;
  }[];
}

interface AdvancedEditResult {
  file: string;
  success: boolean;
  applied: boolean;
  error?: string;
  errorDetails?: {
    type: 'file-not-found' | 'permission-denied' | 'content-mismatch' | 'line-range-error' | 'syntax-error' | 'encoding-error' | 'unknown';
    rootCause: string;
    suggestions: string[];
    affectedLines?: [number, number];
    expectedContent?: string;
    actualContent?: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
  context?: {
    before: string[];
    after: string[];
    lineRange?: [number, number];
  };
  warnings?: string[];
}

export async function handleMultiFileEditAdvanced(args: any, context: ToolContext) {
  const validated = MultiFileEditAdvancedSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting advanced multi-file edit operation', {
      editsCount: validated.edits.length,
      dryRun: validated.dryRun,
      validateConflicts: validated.validateConflicts,
    });

    const fileOps = new FileOperations(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    let response = `# Advanced Multi-File Edit Operation\n\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE EDIT'}\n`;
    response += `**Edits to apply:** ${validated.edits.length}\n`;
    response += `**Conflict validation:** ${validated.validateConflicts ? 'Enabled' : 'Disabled'}\n`;
    response += `**Backups:** ${validated.createBackups ? 'Enabled' : 'Disabled'}\n\n`;

    // Step 1: Validate conflicts if enabled
    let conflicts: EditConflict[] = [];
    if (validated.validateConflicts) {
      conflicts = await validateEditConflicts(validated.edits, fileOps, logger);
      
      if (conflicts.length > 0) {
        response += `## ⚠️ Edit Conflicts Detected\n\n`;
        for (const conflict of conflicts) {
          response += `### ${conflict.file}\n`;
          for (const conflictDetail of conflict.conflicts) {
            response += `- **${conflictDetail.type}**: ${conflictDetail.description}\n`;
          }
          response += '\n';
        }
        
        if (!validated.dryRun) {
          response += `**Operation aborted due to conflicts. Please resolve conflicts and try again.**\n`;
          return {
            content: [
              {
                type: 'text',
                text: response,
              },
            ],
          };
        }
      }
    }

    // Step 2: Prepare edits
    const fileEdits: FileEdit[] = [];
    const fileSnapshots: FileSnapshot[] = [];
    const editResults: AdvancedEditResult[] = [];

    for (let i = 0; i < validated.edits.length; i++) {
      const editRequest = validated.edits[i]!;
      
      try {
        const filePath = editRequest.edit.file;
        
        if (!await fileOps.fileExists(filePath)) {
          editResults.push({
            file: filePath,
            success: false,
            applied: false,
            error: 'File does not exist',
            errorDetails: {
              type: 'file-not-found',
              rootCause: `The file '${filePath}' could not be found in the filesystem.`,
              suggestions: [
                'Verify the file path is correct',
                'Check if the file was moved or deleted',
                'Ensure you have the correct working directory',
                'Create the file first if it should exist'
              ],
              severity: 'critical'
            }
          });
          continue;
        }

        const originalContent = await fileOps.readFile(filePath);
        let newContent: string;
        let lineRange: [number, number] | undefined;

        if (editRequest.type === 'string') {
          // String-based edit
          const { old, new: newText } = editRequest.edit;
          
          if (!originalContent.includes(old)) {
            const lines = originalContent.split('\n');
            const similarity = findMostSimilarContent(old, lines);
            
            editResults.push({
              file: filePath,
              success: false,
              applied: false,
              error: `Content to replace not found`,
              errorDetails: {
                type: 'content-mismatch',
                rootCause: `The specified content was not found in '${filePath}'. The file may have been modified since the edit was planned.`,
                suggestions: [
                  'Verify the content still exists in the file',
                  'Check if the file was modified by another process',
                  'Use line-range edit instead of string replacement',
                  similarity.line > 0 ? `Similar content found at line ${similarity.line}: "${similarity.content.slice(0, 50)}..."` : 'Check for whitespace or formatting differences'
                ],
                expectedContent: old.slice(0, 200) + (old.length > 200 ? '...' : ''),
                actualContent: `File has ${lines.length} lines, first few: ${lines.slice(0, 3).join('\\n')}`,
                severity: 'high'
              }
            });
            continue;
          }
          
          newContent = originalContent.replace(old, newText);
          
          // Find line range for context
          const lines = originalContent.split('\n');
          const oldLines = old.split('\n');
          for (let lineIndex = 0; lineIndex <= lines.length - oldLines.length; lineIndex++) {
            const linesSlice = lines.slice(lineIndex, lineIndex + oldLines.length);
            if (linesSlice.join('\n') === old) {
              lineRange = [lineIndex + 1, lineIndex + oldLines.length];
              break;
            }
          }
          
        } else {
          // Line-range based edit
          const { startLine, endLine, newContent: newText } = editRequest.edit;
          
          if (startLine > endLine) {
            editResults.push({
              file: filePath,
              success: false,
              applied: false,
              error: `Invalid line range: startLine > endLine`,
              errorDetails: {
                type: 'line-range-error',
                rootCause: `Invalid line range specified: startLine (${startLine}) is greater than endLine (${endLine}).`,
                suggestions: [
                  'Ensure startLine <= endLine',
                  `Try using startLine: ${endLine}, endLine: ${startLine}`,
                  'Check if line numbers are 1-indexed',
                  'Verify the line range makes sense for your edit'
                ],
                affectedLines: [startLine, endLine],
                severity: 'high'
              }
            });
            continue;
          }
          
          const lines = originalContent.split('\n');
          
          if (startLine < 1 || endLine > lines.length) {
            editResults.push({
              file: filePath,
              success: false,
              applied: false,
              error: `Line range out of bounds`,
              errorDetails: {
                type: 'line-range-error',
                rootCause: `Line range ${startLine}-${endLine} is outside the valid range for '${filePath}' which has ${lines.length} lines.`,
                suggestions: [
                  `Valid line range is 1-${lines.length}`,
                  startLine < 1 ? 'Line numbers start from 1, not 0' : `Maximum line number is ${lines.length}`,
                  'Check the file content to verify correct line numbers',
                  'Consider using string replacement instead of line ranges'
                ],
                affectedLines: [Math.max(1, startLine), Math.min(lines.length, endLine)],
                actualContent: `File has ${lines.length} lines. Last few lines: ${lines.slice(-3).map((line, i) => `${lines.length - 2 + i}: ${line}`).join('\\n')}`,
                severity: 'high'
              }
            });
            continue;
          }
          
          // Replace lines
          const beforeLines = lines.slice(0, startLine - 1);
          const afterLines = lines.slice(endLine);
          const newLines = newText.split('\n');
          
          newContent = [...beforeLines, ...newLines, ...afterLines].join('\n');
          lineRange = [startLine, endLine];
        }

        // Generate context for preview
        const context = generateContext(originalContent, newContent, lineRange, validated.showContext);
        
        editResults.push({
          file: filePath,
          success: true,
          applied: false,
          context,
        });

        // Prepare for application
        fileEdits.push({
          filePath,
          oldContent: originalContent,
          newContent,
        });

        fileSnapshots.push({
          filePath,
          contentBefore: originalContent,
          contentAfter: newContent,
        });

      } catch (error) {
        const errorDetails = analyzeError(error, editRequest.edit.file);
        
        editResults.push({
          file: editRequest.edit.file,
          success: false,
          applied: false,
          error: `Unexpected error: ${String(error)}`,
          errorDetails
        });
      }
    }

    const successfulEdits = editResults.filter(r => r.success);
    const failedEdits = editResults.filter(r => !r.success);

    response += `**Edit Validation Results:**\n`;
    response += `- Successful edits: ${successfulEdits.length}\n`;
    response += `- Failed edits: ${failedEdits.length}\n`;
    response += `- Conflicts detected: ${conflicts.length}\n\n`;

    if (validated.dryRun) {
      // Dry run mode - show detailed preview
      response += `## 🔍 Preview of Changes\n\n`;
      
      for (let i = 0; i < editResults.length; i++) {
        const result = editResults[i]!;
        const editRequest = validated.edits[i]!;
        
        response += `### ${i + 1}. ${result.file}\n`;
        
        if (result.success && result.context) {
          response += `**Status:** ✅ Ready to apply\n`;
          
          if (editRequest.type === 'line-range') {
            const { startLine, endLine } = editRequest.edit;
            response += `**Range:** Lines ${startLine}-${endLine}\n`;
          }
          
          response += `**Context (±${validated.showContext} lines):**\n\`\`\`diff\n`;
          
          // Show before context
          result.context.before.forEach((line, idx) => {
            const lineNum = (result.context!.lineRange?.[0] || 1) - validated.showContext + idx;
            response += `  ${lineNum.toString().padStart(3)} | ${line}\n`;
          });
          
          // Show after context  
          result.context.after.forEach((line, idx) => {
            const lineNum = (result.context!.lineRange?.[0] || 1) - validated.showContext + idx;
            if (idx < result.context!.before.length) {
              response += `- ${lineNum.toString().padStart(3)} | ${result.context!.before[idx]}\n`;
              response += `+ ${lineNum.toString().padStart(3)} | ${line}\n`;
            } else {
              response += `  ${lineNum.toString().padStart(3)} | ${line}\n`;
            }
          });
          
          response += `\`\`\`\n\n`;
        } else {
          response += `**Status:** ❌ Failed\n`;
          response += `**Error:** ${result.error}\n\n`;
        }
      }
      
      if (conflicts.length === 0) {
        response += `## Summary\n`;
        response += `✅ All edits validated successfully. To apply these changes, run with \`dryRun: false\`\n`;
      } else {
        response += `## Summary\n`;
        response += `⚠️ Conflicts detected. Please resolve conflicts before applying changes.\n`;
      }
      
    } else {
      // Live edit mode - apply changes if no conflicts
      if (conflicts.length > 0) {
        response += `## ❌ Operation Aborted\n\n`;
        response += `Cannot apply edits due to conflicts. Please resolve conflicts and try again.\n`;
      } else if (fileEdits.length > 0) {
        logger.info(`Applying advanced edits to ${fileEdits.length} files`);
        
        try {
          const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
          
          // Mark edits as applied
          editResults.forEach(result => {
            if (result.success) result.applied = true;
          });
          
          // Record operation in history
          const historyId = await historyManager.recordOperation(
            'multi_file_edit_advanced',
            'Advanced Multi-File Edit',
            `Applied ${fileEdits.length} edits across multiple files`,
            fileSnapshots,
            {
              editsApplied: fileEdits.length,
              editTypes: validated.edits.map(e => e.type),
              backupsCreated: backups.length,
            }
          );
          
          response += `## ✅ Advanced Multi-File Edit Successful\n\n`;
          response += `**Files modified:** ${fileEdits.length}\n`;
          response += `**Operation ID:** ${historyId}\n\n`;
          
          if (validated.createBackups && backups.length > 0) {
            response += `**Backups created:** ${backups.length}\n\n`;
          }
          
          response += `### Modified Files\n`;
          for (let i = 0; i < fileEdits.length; i++) {
            const edit = fileEdits[i]!;
            const editRequest = validated.edits[i]!;
            const stats = await fileOps.getFileStats(edit.filePath);
            
            response += `${i + 1}. **${edit.filePath}**\n`;
            response += `   - Edit type: ${editRequest.type}\n`;
            response += `   - Lines: ${stats.lines}\n`;
            response += `   - Size: ${stats.size} bytes\n`;
            response += `   - Modified: ${stats.modified.toISOString()}\n\n`;
          }
          
          response += `## Next Steps\n`;
          response += `- Review the changes in your editor\n`;
          response += `- Run tests to ensure functionality\n`;
          response += `- Use operation ID ${historyId} to rollback if needed\n`;
          
          logger.info('Advanced multi-file edit operation completed successfully', {
            filesModified: fileEdits.length,
            historyId,
          });
          
        } catch (error) {
          response += `## ❌ Advanced Multi-File Edit Failed\n\n`;
          response += `**Error:** ${error}\n\n`;
          response += `All changes have been rolled back to maintain file consistency.\n`;
          
          logger.error('Advanced multi-file edit operation failed', error);
          throw error;
        }
      } else {
        response += `## ℹ️ No Edits Applied\n\n`;
        response += `No valid edits to apply.\n`;
      }
      
      if (failedEdits.length > 0) {
        response += `\n### 🚨 Failed Edits - Detailed Analysis\n\n`;
        for (const result of failedEdits) {
          response += `#### ${result.file}\n`;
          response += `**Error:** ${result.error}\n\n`;
          
          if (result.errorDetails) {
            response += `**Root Cause:** ${result.errorDetails.rootCause}\n\n`;
            response += `**Severity:** ${result.errorDetails.severity.toUpperCase()}\n\n`;
            
            if (result.errorDetails.affectedLines) {
              response += `**Affected Lines:** ${result.errorDetails.affectedLines[0]}-${result.errorDetails.affectedLines[1]}\n\n`;
            }
            
            if (result.errorDetails.expectedContent) {
              response += `**Expected Content:** \n\`\`\`\n${result.errorDetails.expectedContent}\n\`\`\`\n\n`;
            }
            
            if (result.errorDetails.actualContent) {
              response += `**Actual Content:** \n\`\`\`\n${result.errorDetails.actualContent}\n\`\`\`\n\n`;
            }
            
            response += `**💡 Suggested Solutions:**\n`;
            result.errorDetails.suggestions.forEach((suggestion, i) => {
              response += `${i + 1}. ${suggestion}\n`;
            });
          }
          
          if (result.warnings && result.warnings.length > 0) {
            response += `\n**⚠️ Warnings:**\n`;
            result.warnings.forEach(warning => {
              response += `- ${warning}\n`;
            });
          }
          
          response += `\n---\n\n`;
        }
        
        response += `### 📊 Error Summary\n`;
        const errorTypes = failedEdits.reduce((acc, result) => {
          const type = result.errorDetails?.type || 'unknown';
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        Object.entries(errorTypes).forEach(([type, count]) => {
          response += `- **${type}**: ${count} error(s)\n`;
        });
        
        response += `\n**🔧 General Troubleshooting Steps:**\n`;
        response += `1. Verify all file paths are correct and files exist\n`;
        response += `2. Check file permissions and ensure files are not locked\n`;
        response += `3. Refresh file contents if they may have been modified\n`;
        response += `4. Consider using smaller, incremental edits\n`;
        response += `5. Test edits in dry-run mode first\n`;
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
    logger.error('Error in advanced multi_file_edit tool:', error);
    throw error;
  }
}

async function validateEditConflicts(
  edits: z.infer<typeof AdvancedFileEditSchema>[],
  fileOps: FileOperations,
  logger: any
): Promise<EditConflict[]> {
  const conflicts: EditConflict[] = [];
  const fileEditGroups = new Map<string, number[]>();

  // Group edits by file
  edits.forEach((edit, index) => {
    const filePath = edit.edit.file;
    if (!fileEditGroups.has(filePath)) {
      fileEditGroups.set(filePath, []);
    }
    fileEditGroups.get(filePath)!.push(index);
  });

  // Check conflicts within each file
  for (const [filePath, editIndices] of fileEditGroups) {
    if (editIndices.length <= 1) continue;

    const fileConflicts: EditConflict['conflicts'] = [];

    // Check if file exists
    if (!await fileOps.fileExists(filePath)) {
      fileConflicts.push({
        type: 'missing-content',
        description: 'File does not exist',
        editIndex1: editIndices[0]!,
      });
      continue;
    }

    const fileContent = await fileOps.readFile(filePath);
    const lines = fileContent.split('\n');

    // Check for overlapping line ranges
    const lineRangeEdits = editIndices
      .map(index => ({ index, edit: edits[index]! }))
      .filter(({ edit }) => edit.type === 'line-range');

    for (let i = 0; i < lineRangeEdits.length; i++) {
      for (let j = i + 1; j < lineRangeEdits.length; j++) {
        const edit1 = lineRangeEdits[i]!;
        const edit2 = lineRangeEdits[j]!;
        
        if (edit1.edit.type === 'line-range' && edit2.edit.type === 'line-range') {
          const range1 = [edit1.edit.edit.startLine, edit1.edit.edit.endLine];
          const range2 = [edit2.edit.edit.startLine, edit2.edit.edit.endLine];
          
          // Check for overlap
          if (range1 && range2 && 
              range1[1] !== undefined && range1[0] !== undefined && 
              range2[1] !== undefined && range2[0] !== undefined &&
              range1[1] >= range2[0] && range2[1] >= range1[0]) {
            fileConflicts.push({
              type: 'overlapping-ranges',
              description: `Line ranges overlap: ${range1[0]}-${range1[1]} and ${range2[0]}-${range2[1]}`,
              editIndex1: edit1.index,
              editIndex2: edit2.index,
            });
          }
        }
      }
    }

    // Check if string content exists for string-based edits
    const stringEdits = editIndices
      .map(index => ({ index, edit: edits[index]! }))
      .filter(({ edit }) => edit.type === 'string');

    for (const { index, edit } of stringEdits) {
      if (edit.type === 'string' && !fileContent.includes(edit.edit.old)) {
        fileConflicts.push({
          type: 'missing-content',
          description: `Content to replace not found: "${edit.edit.old.slice(0, 50)}${edit.edit.old.length > 50 ? '...' : ''}"`,
          editIndex1: index,
        });
      }
    }

    if (fileConflicts.length > 0) {
      conflicts.push({
        file: filePath,
        conflicts: fileConflicts,
      });
    }
  }

  return conflicts;
}

function generateContext(
  originalContent: string,
  newContent: string,
  lineRange: [number, number] | undefined,
  contextLines: number
): AdvancedEditResult['context'] {
  const originalLines = originalContent.split('\n');
  const newLines = newContent.split('\n');
  
  if (!lineRange) {
    // For string-based edits, try to find the changed area
    let startLine = 0;
    let endLine = Math.min(originalLines.length, newLines.length);
    
    // Find first difference
    for (let i = 0; i < Math.min(originalLines.length, newLines.length); i++) {
      if (originalLines[i] !== newLines[i]) {
        startLine = i;
        break;
      }
    }
    
    // Find last difference
    for (let i = Math.min(originalLines.length, newLines.length) - 1; i >= startLine; i--) {
      if (originalLines[i] !== newLines[i]) {
        endLine = i + 1;
        break;
      }
    }
    
    lineRange = [startLine + 1, endLine];
  }

  const contextStart = Math.max(0, lineRange[0] - 1 - contextLines);
  const contextEnd = Math.min(originalLines.length, lineRange[1] + contextLines);
  
  const before = originalLines.slice(contextStart, contextEnd);
  const newContextEnd = Math.min(newLines.length, lineRange[1] + contextLines);
  const after = newLines.slice(contextStart, newContextEnd);

  return {
    before,
    after,
    lineRange,
  };
}

// Helper functions for enhanced error reporting
function analyzeError(error: unknown, filePath: string): AdvancedEditResult['errorDetails'] {
  const errorMessage = String(error);
  
  // Permission errors
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
    return {
      type: 'permission-denied',
      rootCause: `Access denied when trying to edit '${filePath}'. The file or directory permissions prevent writing.`,
      suggestions: [
        'Check file permissions with `ls -la`',
        'Ensure you have write permissions to the file',
        'Check if the file is being used by another process',
        'Try running with appropriate privileges if needed'
      ],
      severity: 'critical'
    };
  }
  
  // Encoding errors
  if (errorMessage.includes('encoding') || errorMessage.includes('charset')) {
    return {
      type: 'encoding-error',
      rootCause: `File encoding issue when processing '${filePath}'. The file may contain non-UTF-8 characters.`,
      suggestions: [
        'Check if the file uses a different encoding (UTF-16, Latin-1, etc.)',
        'Convert the file to UTF-8 encoding',
        'Use a tool to detect the file encoding',
        'Handle binary files appropriately'
      ],
      severity: 'medium'
    };
  }
  
  // Syntax errors (if file is being parsed)
  if (errorMessage.includes('SyntaxError') || errorMessage.includes('parse')) {
    return {
      type: 'syntax-error',
      rootCause: `Syntax error encountered when processing '${filePath}'. The file may have invalid syntax.`,
      suggestions: [
        'Check the file syntax in your editor',
        'Ensure the file is a valid source file',
        'Fix any syntax errors before attempting edits',
        'Verify the file extension matches the content type'
      ],
      severity: 'high'
    };
  }
  
  // Default unknown error
  return {
    type: 'unknown',
    rootCause: `An unexpected error occurred while processing '${filePath}': ${errorMessage}`,
    suggestions: [
      'Check the error message for specific details',
      'Verify the file is accessible and not corrupted',
      'Try the operation again',
      'Check system resources (disk space, memory)',
      'Report this as a potential bug if the error persists'
    ],
    severity: 'high'
  };
}

function findMostSimilarContent(target: string, lines: string[]): { line: number; content: string; similarity: number } {
  let bestMatch = { line: 0, content: '', similarity: 0 };
  const targetWords = target.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (targetWords.length === 0) {
    return bestMatch;
  }
  
  lines.forEach((line, index) => {
    const lineWords = line.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const commonWords = targetWords.filter(word => lineWords.includes(word));
    const similarity = commonWords.length / Math.max(targetWords.length, lineWords.length);
    
    if (similarity > bestMatch.similarity && similarity > 0.3) {
      bestMatch = {
        line: index + 1,
        content: line,
        similarity
      };
    }
  });
  
  return bestMatch;
}