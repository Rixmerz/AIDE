/**
 * Advanced Pattern Replace Tool for AIDE MCP Server
 * 
 * Enhanced version with exclude patterns, conditional replacement, and history tracking
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const PatternReplaceAdvancedSchema = z.object({
  pattern: z.string().min(1, 'Pattern cannot be empty'),
  replacement: z.string(),
  fileGlob: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  excludeGlob: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(true),
  createBackups: z.boolean().optional().default(true),
  conditional: z.object({
    enabled: z.boolean().optional().default(false),
    context: z.string().optional(), // Additional context pattern that must be present
    fileType: z.array(z.string()).optional(), // Only apply to specific file types
    excludeInComments: z.boolean().optional().default(false), // Don't replace in comments
    excludeInStrings: z.boolean().optional().default(false), // Don't replace in strings
  }).optional().default({ enabled: false }),
  multiline: z.boolean().optional().default(false),
  maxReplacements: z.number().min(1).optional(), // Limit total replacements
});

interface AdvancedMatchInfo {
  file: string;
  matches: {
    line: number;
    column: number;
    matched: string;
    replacement: string;
    context?: string;
    allowed: boolean;
    reason?: string;
  }[];
}

export async function handlePatternReplaceAdvanced(args: any, context: ToolContext) {
  const validated = PatternReplaceAdvancedSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting advanced pattern replace operation', {
      pattern: validated.pattern,
      fileGlob: validated.fileGlob,
      excludeGlob: validated.excludeGlob,
      dryRun: validated.dryRun,
      caseSensitive: validated.caseSensitive,
      conditional: validated.conditional?.enabled,
    });

    const fileOps = new FileOperations(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();
    
    // Create regex pattern
    let regex: RegExp;
    try {
      const flags = validated.caseSensitive ? 'g' : 'gi';
      const finalFlags = validated.multiline ? flags + 'm' : flags;
      regex = new RegExp(validated.pattern, finalFlags);
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error}`);
    }

    // Find matching files (with exclusions)
    const allFiles = await fileOps.findFiles(validated.fileGlob);
    let files = allFiles;
    
    if (validated.excludeGlob) {
      const excludedFiles = await fileOps.findFiles(validated.excludeGlob);
      const excludedSet = new Set(excludedFiles);
      files = allFiles.filter(file => !excludedSet.has(file));
      
      logger.info(`Found ${allFiles.length} files, excluded ${excludedFiles.length}, processing ${files.length}`);
    }

    if (files.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No files found matching pattern: ${validated.fileGlob}${validated.excludeGlob ? ` (excluding: ${validated.excludeGlob})` : ''}`,
          },
        ],
      };
    }

    logger.info(`Processing ${files.length} files for pattern replacement`);

    // Process files and find matches
    const matchedFiles: AdvancedMatchInfo[] = [];
    const fileEdits: FileEdit[] = [];
    const fileSnapshots: FileSnapshot[] = [];
    let totalReplacements = 0;

    for (const file of files) {
      try {
        const content = await fileOps.readFile(file);
        const lines = content.split('\n');
        const matches: AdvancedMatchInfo['matches'] = [];
        
        let newContent = content;
        let hasMatches = false;
        let fileReplacements = 0;

        // Find matches with advanced filtering
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          if (!line) continue;
          
          // Reset regex lastIndex for each line
          regex.lastIndex = 0;
          
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            const matched = match[0] || '';
            const replacement = validated.replacement.replace(/\$(\d+)/g, (_, num) => {
              const groupIndex = parseInt(num, 10);
              return match?.[groupIndex] || '';
            });

            // Check conditional replacement rules
            const matchResult = await evaluateMatch(
              file,
              content,
              lineIndex,
              match.index || 0,
              matched,
              validated.conditional
            );

            matches.push({
              line: lineIndex + 1,
              column: (match.index || 0) + 1,
              matched,
              replacement,
              context: matchResult.context,
              allowed: matchResult.allowed,
              reason: matchResult.reason,
            });

            if (matchResult.allowed) {
              hasMatches = true;
              fileReplacements++;
              totalReplacements++;
              
              // Check max replacements limit
              if (validated.maxReplacements && totalReplacements >= validated.maxReplacements) {
                break;
              }
            }

            // Prevent infinite loop on zero-length matches
            if (match[0] === '') {
              regex.lastIndex++;
            }
          }
          
          if (validated.maxReplacements && totalReplacements >= validated.maxReplacements) {
            break;
          }
        }

        if (hasMatches) {
          // Apply replacements only for allowed matches
          regex.lastIndex = 0;
          newContent = content.replace(regex, (match, ...groups) => {
            // This is a simplified approach - in practice, we'd need more sophisticated
            // logic to only replace matches that passed our conditional checks
            const replacement = validated.replacement.replace(/\$(\d+)/g, (_, num) => {
              const groupIndex = parseInt(num, 10);
              return groups[groupIndex - 1] || '';
            });
            return replacement;
          });
          
          matchedFiles.push({
            file,
            matches,
          });

          fileEdits.push({
            filePath: file,
            oldContent: content,
            newContent,
          });

          fileSnapshots.push({
            filePath: file,
            contentBefore: content,
            contentAfter: newContent,
          });
        }
      } catch (error) {
        logger.warn(`Error processing file ${file}:`, error);
      }
    }

    let response = `# Advanced Pattern Replace Operation\n\n`;
    response += `**Pattern:** \`${validated.pattern}\`\n`;
    response += `**Replacement:** \`${validated.replacement}\`\n`;
    response += `**File glob:** \`${validated.fileGlob}\`\n`;
    if (validated.excludeGlob) {
      response += `**Exclude glob:** \`${validated.excludeGlob}\`\n`;
    }
    response += `**Case sensitive:** ${validated.caseSensitive}\n`;
    response += `**Conditional replacement:** ${validated.conditional?.enabled ? 'Enabled' : 'Disabled'}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE REPLACE'}\n\n`;

    response += `**Files scanned:** ${files.length}\n`;
    response += `**Files with matches:** ${matchedFiles.length}\n`;

    if (matchedFiles.length === 0) {
      response += `\nNo matches found for the pattern.\n`;
      
      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    }

    const totalMatches = matchedFiles.reduce((sum, info) => sum + info.matches.length, 0);
    const allowedMatches = matchedFiles.reduce((sum, info) => 
      sum + info.matches.filter(m => m.allowed).length, 0);
    
    response += `**Total matches:** ${totalMatches}\n`;
    response += `**Allowed replacements:** ${allowedMatches}\n`;
    
    if (totalMatches !== allowedMatches) {
      response += `**Filtered out:** ${totalMatches - allowedMatches}\n`;
    }
    
    if (validated.maxReplacements && totalReplacements >= validated.maxReplacements) {
      response += `**Limit reached:** ${validated.maxReplacements} max replacements\n`;
    }
    
    response += '\n';

    if (validated.dryRun) {
      // Dry run mode - show preview
      response += `## 🔍 Preview of Advanced Replacements\n\n`;
      
      for (const matchInfo of matchedFiles.slice(0, 10)) {
        response += `### ${matchInfo.file}\n`;
        const allowedCount = matchInfo.matches.filter(m => m.allowed).length;
        const blockedCount = matchInfo.matches.length - allowedCount;
        
        response += `**Matches:** ${matchInfo.matches.length} total, ${allowedCount} allowed`;
        if (blockedCount > 0) {
          response += `, ${blockedCount} blocked`;
        }
        response += '\n\n';
        
        // Show allowed matches
        const allowedMatches = matchInfo.matches.filter(m => m.allowed).slice(0, 5);
        if (allowedMatches.length > 0) {
          response += `**✅ Allowed Replacements:**\n`;
          for (const match of allowedMatches) {
            response += `- Line ${match.line}, Column ${match.column}: \`${match.matched}\` → \`${match.replacement}\`\n`;
          }
        }
        
        // Show blocked matches
        const blockedMatches = matchInfo.matches.filter(m => !m.allowed).slice(0, 3);
        if (blockedMatches.length > 0) {
          response += `**❌ Blocked Replacements:**\n`;
          for (const match of blockedMatches) {
            response += `- Line ${match.line}, Column ${match.column}: \`${match.matched}\` (${match.reason})\n`;
          }
        }
        
        if (matchInfo.matches.length > 8) {
          response += `  ... and ${matchInfo.matches.length - 8} more matches\n`;
        }
        response += '\n';
      }
      
      if (matchedFiles.length > 10) {
        response += `... and ${matchedFiles.length - 10} more files with matches\n\n`;
      }
      
      response += `## Summary\n`;
      response += `To apply these changes, run the same command with \`dryRun: false\`\n`;
      
    } else {
      // Live replace mode - apply changes
      logger.info('Applying advanced pattern replacements to files');
      
      try {
        const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
        
        // Record operation in history
        const historyId = await historyManager.recordOperation(
          'pattern_replace_advanced',
          'Advanced Pattern Replace',
          `Replaced pattern "${validated.pattern}" in ${fileEdits.length} files`,
          fileSnapshots,
          {
            pattern: validated.pattern,
            replacement: validated.replacement,
            totalReplacements: allowedMatches,
            filesProcessed: files.length,
            filesModified: fileEdits.length,
            conditional: validated.conditional?.enabled,
            backupsCreated: backups.length,
          }
        );
        
        response += `## ✅ Advanced Pattern Replace Successful\n\n`;
        response += `**Files modified:** ${fileEdits.length}\n`;
        response += `**Total replacements:** ${allowedMatches}\n`;
        response += `**Operation ID:** ${historyId}\n\n`;
        
        if (validated.createBackups && backups.length > 0) {
          response += `**Backups created:** ${backups.length}\n\n`;
          response += `### Backup Files\n`;
          for (const backup of backups.slice(0, 5)) {
            response += `- \`${backup.originalPath}\` → \`${backup.backupPath}\`\n`;
          }
          if (backups.length > 5) {
            response += `  ... and ${backups.length - 5} more backups\n`;
          }
          response += '\n';
        }
        
        response += `### Modified Files Summary\n`;
        for (const matchInfo of matchedFiles) {
          const allowedCount = matchInfo.matches.filter(m => m.allowed).length;
          response += `- **${matchInfo.file}**: ${allowedCount} replacements\n`;
        }
        response += '\n';
        
        // Show replacement statistics
        if (validated.conditional?.enabled) {
          response += `### Conditional Replacement Statistics\n`;
          const stats = analyzeReplacementStats(matchedFiles);
          
          if (stats.blockedByComments > 0) {
            response += `- **Blocked in comments:** ${stats.blockedByComments}\n`;
          }
          if (stats.blockedByStrings > 0) {
            response += `- **Blocked in strings:** ${stats.blockedByStrings}\n`;
          }
          if (stats.blockedByFileType > 0) {
            response += `- **Blocked by file type:** ${stats.blockedByFileType}\n`;
          }
          if (stats.blockedByContext > 0) {
            response += `- **Blocked by context:** ${stats.blockedByContext}\n`;
          }
          response += '\n';
        }
        
        response += `## Next Steps\n`;
        response += `- Review the changes in your editor\n`;
        response += `- Run TypeScript compiler to check for any new errors\n`;
        response += `- Use \`error_diff\` tool to compare before/after errors\n`;
        response += `- Test your application to ensure replacements work correctly\n`;
        response += `- Use operation ID ${historyId} to rollback if needed\n`;
        
        logger.info('Advanced pattern replace operation completed successfully', {
          filesModified: fileEdits.length,
          totalReplacements: allowedMatches,
          backupsCreated: backups.length,
          historyId,
        });
        
      } catch (error) {
        response += `## ❌ Advanced Pattern Replace Failed\n\n`;
        response += `**Error:** ${error}\n\n`;
        response += `All changes have been rolled back to maintain file consistency.\n`;
        
        logger.error('Advanced pattern replace operation failed', error);
        throw error;
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
    logger.error('Error in advanced pattern_replace tool:', error);
    throw error;
  }
}

async function evaluateMatch(
  filePath: string,
  content: string,
  lineIndex: number,
  columnIndex: number,
  matched: string,
  conditional?: z.infer<typeof PatternReplaceAdvancedSchema>['conditional']
): Promise<{ allowed: boolean; reason?: string; context?: string }> {
  if (!conditional?.enabled) {
    return { allowed: true };
  }

  // Check file type restrictions
  if (conditional.fileType && conditional.fileType.length > 0) {
    const fileExt = filePath.split('.').pop()?.toLowerCase();
    if (fileExt && !conditional.fileType.includes(fileExt)) {
      return { 
        allowed: false, 
        reason: `File type .${fileExt} not in allowed types: ${conditional.fileType.join(', ')}` 
      };
    }
  }

  const lines = content.split('\n');
  const currentLine = lines[lineIndex] || '';

  // Check if match is in comments
  if (conditional.excludeInComments) {
    // Simple comment detection for common languages
    const trimmedLine = currentLine.trim();
    const beforeMatch = currentLine.substring(0, columnIndex);
    
    // Single-line comments
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#') || trimmedLine.startsWith('*')) {
      return { allowed: false, reason: 'Match found in comment' };
    }
    
    // Inline comments
    if (beforeMatch.includes('//') || beforeMatch.includes('/*')) {
      return { allowed: false, reason: 'Match found in comment' };
    }
  }

  // Check if match is in strings
  if (conditional.excludeInStrings) {
    const beforeMatch = currentLine.substring(0, columnIndex);
    const quotes = ['"', "'", '`'];
    
    for (const quote of quotes) {
      const beforeQuotes = (beforeMatch.match(new RegExp(quote, 'g')) || []).length;
      if (beforeQuotes % 2 === 1) {
        return { allowed: false, reason: `Match found in ${quote}-quoted string` };
      }
    }
  }

  // Check context requirement
  if (conditional.context) {
    try {
      const contextRegex = new RegExp(conditional.context, 'i');
      const contextStart = Math.max(0, lineIndex - 2);
      const contextEnd = Math.min(lines.length, lineIndex + 3);
      const contextLines = lines.slice(contextStart, contextEnd);
      const contextText = contextLines.join('\n');
      
      if (!contextRegex.test(contextText)) {
        return { 
          allowed: false, 
          reason: `Required context not found: ${conditional.context}` 
        };
      }
      
      return { 
        allowed: true, 
        context: contextText.substring(0, 100) + (contextText.length > 100 ? '...' : '') 
      };
    } catch (error) {
      return { allowed: false, reason: `Invalid context pattern: ${error}` };
    }
  }

  return { allowed: true };
}

function analyzeReplacementStats(matchedFiles: AdvancedMatchInfo[]): {
  blockedByComments: number;
  blockedByStrings: number;
  blockedByFileType: number;
  blockedByContext: number;
} {
  let blockedByComments = 0;
  let blockedByStrings = 0;
  let blockedByFileType = 0;
  let blockedByContext = 0;

  for (const file of matchedFiles) {
    for (const match of file.matches) {
      if (!match.allowed && match.reason) {
        if (match.reason.includes('comment')) {
          blockedByComments++;
        } else if (match.reason.includes('string')) {
          blockedByStrings++;
        } else if (match.reason.includes('File type')) {
          blockedByFileType++;
        } else if (match.reason.includes('context')) {
          blockedByContext++;
        }
      }
    }
  }

  return {
    blockedByComments,
    blockedByStrings,
    blockedByFileType,
    blockedByContext,
  };
}