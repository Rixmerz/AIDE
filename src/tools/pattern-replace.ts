/**
 * Pattern Replace Tool for AIDE MCP Server
 * 
 * Performs project-wide pattern replacement using regex with file glob support
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import type { ToolContext } from './index.js';

const PatternReplaceSchema = z.object({
  pattern: z.string().min(1, 'Pattern cannot be empty'),
  replacement: z.string(),
  fileGlob: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  dryRun: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(true),
  createBackups: z.boolean().optional().default(true),
});

interface MatchInfo {
  file: string;
  matches: {
    line: number;
    column: number;
    matched: string;
    replacement: string;
  }[];
}

export async function handlePatternReplace(args: any, context: ToolContext) {
  const validated = PatternReplaceSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting pattern replace operation', {
      pattern: validated.pattern,
      fileGlob: validated.fileGlob,
      dryRun: validated.dryRun,
      caseSensitive: validated.caseSensitive,
    });

    const fileOps = new FileOperations(logger);
    
    // Create regex pattern
    let regex: RegExp;
    try {
      const flags = validated.caseSensitive ? 'g' : 'gi';
      regex = new RegExp(validated.pattern, flags);
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error}`);
    }

    // Find matching files
    const files = await fileOps.findFiles(validated.fileGlob);
    if (files.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No files found matching pattern: ${validated.fileGlob}`,
          },
        ],
      };
    }

    logger.info(`Found ${files.length} files to process`);

    // Process files and find matches
    const matchedFiles: MatchInfo[] = [];
    const fileEdits: FileEdit[] = [];

    for (const file of files) {
      try {
        const content = await fileOps.readFile(file);
        const lines = content.split('\n');
        const matches: MatchInfo['matches'] = [];
        
        let newContent = content;
        let hasMatches = false;

        // Find matches with line/column information
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          if (!line) continue;
          
          // Reset regex lastIndex for each line
          regex.lastIndex = 0;
          
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            hasMatches = true;
            const matched = match[0] || '';
            const replacement = validated.replacement.replace(/\$(\d+)/g, (_, num) => {
              const groupIndex = parseInt(num, 10);
              return match?.[groupIndex] || '';
            });

            matches.push({
              line: lineIndex + 1,
              column: (match.index || 0) + 1,
              matched,
              replacement,
            });

            // Prevent infinite loop on zero-length matches
            if (match[0] === '') {
              regex.lastIndex++;
            }
          }
        }

        if (hasMatches) {
          // Apply replacement to entire content
          regex.lastIndex = 0;
          newContent = content.replace(regex, validated.replacement);
          
          matchedFiles.push({
            file,
            matches,
          });

          fileEdits.push({
            filePath: file,
            oldContent: content,
            newContent,
          });
        }
      } catch (error) {
        logger.warn(`Error processing file ${file}:`, error);
      }
    }

    let response = `# Pattern Replace Operation\n\n`;
    response += `**Pattern:** \`${validated.pattern}\`\n`;
    response += `**Replacement:** \`${validated.replacement}\`\n`;
    response += `**File glob:** \`${validated.fileGlob}\`\n`;
    response += `**Case sensitive:** ${validated.caseSensitive}\n`;
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
    response += `**Total matches:** ${totalMatches}\n\n`;

    if (validated.dryRun) {
      // Dry run mode - show preview
      response += `## Preview of Changes\n\n`;
      
      for (const matchInfo of matchedFiles.slice(0, 10)) { // Limit preview to first 10 files
        response += `### ${matchInfo.file}\n`;
        response += `**Matches:** ${matchInfo.matches.length}\n`;
        
        for (const match of matchInfo.matches.slice(0, 5)) { // Limit to first 5 matches per file
          response += `- Line ${match.line}, Column ${match.column}: \`${match.matched}\` → \`${match.replacement}\`\n`;
        }
        
        if (matchInfo.matches.length > 5) {
          response += `  ... and ${matchInfo.matches.length - 5} more matches\n`;
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
      logger.info('Applying pattern replacements to files');
      
      try {
        const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
        
        response += `## ✅ Pattern Replace Successful\n\n`;
        response += `**Files modified:** ${fileEdits.length}\n`;
        response += `**Total replacements:** ${totalMatches}\n`;
        
        if (validated.createBackups && backups.length > 0) {
          response += `**Backups created:** ${backups.length}\n\n`;
          response += `### Backup Files\n`;
          for (const backup of backups.slice(0, 5)) { // Limit displayed backups
            response += `- \`${backup.originalPath}\` → \`${backup.backupPath}\`\n`;
          }
          if (backups.length > 5) {
            response += `  ... and ${backups.length - 5} more backups\n`;
          }
          response += '\n';
        }
        
        response += `### Modified Files Summary\n`;
        for (const matchInfo of matchedFiles) {
          response += `- **${matchInfo.file}**: ${matchInfo.matches.length} replacements\n`;
        }
        response += '\n';
        
        // Show detailed changes for first few files
        if (matchedFiles.length <= 3) {
          response += `### Detailed Changes\n`;
          for (const matchInfo of matchedFiles) {
            response += `\n#### ${matchInfo.file}\n`;
            for (const match of matchInfo.matches) {
              response += `- Line ${match.line}: \`${match.matched}\` → \`${match.replacement}\`\n`;
            }
          }
        }
        
        response += `\n## Next Steps\n`;
        response += `- Run TypeScript compiler to check for any new errors\n`;
        response += `- Use \`error_diff\` tool to compare before/after errors\n`;
        response += `- Test your application to ensure replacements work correctly\n`;
        if (validated.createBackups) {
          response += `- Backup files are available for rollback if needed\n`;
        }
        
        logger.info('Pattern replace operation completed successfully', {
          filesModified: fileEdits.length,
          totalReplacements: totalMatches,
          backupsCreated: backups.length,
        });
        
      } catch (error) {
        response += `## ❌ Pattern Replace Failed\n\n`;
        response += `**Error:** ${error}\n\n`;
        response += `All changes have been rolled back to maintain file consistency.\n`;
        
        logger.error('Pattern replace operation failed, rollback initiated', error);
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
    logger.error('Error in pattern_replace tool:', error);
    throw error;
  }
}