/**
 * Multi-File Edit Tool for AIDE MCP Server
 * 
 * Performs atomic edits across multiple files with validation and rollback
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import type { ToolContext } from './index.js';

const FileEditSchema = z.object({
  file: z.string().min(1, 'File path cannot be empty'),
  old: z.string(),
  new: z.string(),
});

const MultiFileEditSchema = z.object({
  edits: z.array(FileEditSchema).min(1, 'At least one edit must be provided'),
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
});

export async function handleMultiFileEdit(args: any, context: ToolContext) {
  const validated = MultiFileEditSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting multi-file edit operation', {
      editsCount: validated.edits.length,
      dryRun: validated.dryRun,
      createBackups: validated.createBackups,
    });

    const fileOps = new FileOperations(logger);
    const fileEdits: FileEdit[] = validated.edits.map(edit => ({
      filePath: edit.file,
      oldContent: edit.old,
      newContent: edit.new,
    }));

    let response = `# Multi-File Edit Operation\n\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE EDIT'}\n`;
    response += `**Files to edit:** ${fileEdits.length}\n`;
    response += `**Backups:** ${validated.createBackups ? 'Enabled' : 'Disabled'}\n\n`;

    if (validated.dryRun) {
      // Dry run mode - validate and preview changes
      logger.info('Running in dry-run mode, validating edits');
      
      response += `## Preview of Changes\n\n`;
      
      for (let i = 0; i < fileEdits.length; i++) {
        const edit = fileEdits[i];
        if (!edit) continue;
        response += `### ${i + 1}. ${edit.filePath}\n`;
        
        try {
          // Check if file exists
          if (!await fileOps.fileExists(edit.filePath)) {
            response += `❌ **Error:** File does not exist\n\n`;
            continue;
          }

          // Validate edit
          await fileOps.validateFileEdit(edit);
          
          const stats = await fileOps.getFileStats(edit.filePath);
          response += `✅ **Status:** Ready for edit\n`;
          response += `📊 **File info:** ${stats.lines} lines, ${stats.size} bytes\n`;
          response += `🔄 **Change:** Replace ${edit.oldContent.length} chars with ${edit.newContent.length} chars\n`;
          
          // Show diff preview if content is short enough
          if (edit.oldContent.length <= 200 && edit.newContent.length <= 200) {
            response += `**Old content:**\n\`\`\`\n${edit.oldContent}\n\`\`\`\n`;
            response += `**New content:**\n\`\`\`\n${edit.newContent}\n\`\`\`\n`;
          }
          
          response += '\n';
        } catch (error) {
          response += `❌ **Error:** ${error}\n\n`;
        }
      }
      
      response += `## Summary\n`;
      response += `To apply these changes, run the same command with \`dryRun: false\`\n`;
      
    } else {
      // Live edit mode - apply changes atomically
      logger.info('Running in live mode, applying edits');
      
      try {
        const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
        
        response += `## ✅ Edit Operation Successful\n\n`;
        response += `**Files modified:** ${fileEdits.length}\n`;
        
        if (validated.createBackups && backups.length > 0) {
          response += `**Backups created:** ${backups.length}\n\n`;
          response += `### Backup Files\n`;
          for (const backup of backups) {
            response += `- \`${backup.originalPath}\` → \`${backup.backupPath}\`\n`;
          }
          response += '\n';
        }
        
        response += `### Modified Files\n`;
        for (let i = 0; i < fileEdits.length; i++) {
          const edit = fileEdits[i];
          if (!edit) continue;
          const stats = await fileOps.getFileStats(edit.filePath);
          response += `${i + 1}. **${edit.filePath}**\n`;
          response += `   - Lines: ${stats.lines}\n`;
          response += `   - Size: ${stats.size} bytes\n`;
          response += `   - Modified: ${stats.modified.toISOString()}\n\n`;
        }
        
        // Suggest next steps
        response += `## Next Steps\n`;
        response += `- Run TypeScript compiler to check for new errors\n`;
        response += `- Use \`error_diff\` tool to compare before/after errors\n`;
        if (validated.createBackups) {
          response += `- Backup files can be used to restore if needed\n`;
        }
        
        logger.info('Multi-file edit operation completed successfully', {
          filesModified: fileEdits.length,
          backupsCreated: backups.length,
        });
        
      } catch (error) {
        response += `## ❌ Edit Operation Failed\n\n`;
        response += `**Error:** ${error}\n\n`;
        response += `All changes have been rolled back to maintain file consistency.\n`;
        
        logger.error('Multi-file edit operation failed, rollback initiated', error);
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
    logger.error('Error in multi_file_edit tool:', error);
    throw error;
  }
}