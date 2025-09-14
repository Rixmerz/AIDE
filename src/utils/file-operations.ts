/**
 * File Operations Utilities for AIDE MCP Server
 * 
 * Provides safe file operations with validation and backup capabilities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { FileOperationError } from './errors.js';
import type { Logger } from './logger.js';

export interface FileEdit {
  filePath: string;
  oldContent: string;
  newContent: string;
}

export interface BackupInfo {
  originalPath: string;
  backupPath: string;
  timestamp: string;
}

export class FileOperations {
  constructor(private logger: Logger) {}

  async readFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.logger.debug(`Read file: ${filePath}`, { size: content.length });
      return content;
    } catch (error) {
      throw new FileOperationError(`Failed to read file ${filePath}: ${error}`);
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await this.ensureDirectoryExists(path.dirname(filePath));
      await fs.writeFile(filePath, content, 'utf-8');
      this.logger.debug(`Wrote file: ${filePath}`, { size: content.length });
    } catch (error) {
      throw new FileOperationError(`Failed to write file ${filePath}: ${error}`);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new FileOperationError(`Failed to create directory ${dirPath}: ${error}`);
    }
  }

  async findFiles(pattern: string, cwd?: string): Promise<string[]> {
    try {
      const files = await glob(pattern, { 
        cwd: cwd || process.cwd(),
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**']
      });
      this.logger.debug(`Found ${files.length} files matching pattern: ${pattern}`);
      return files;
    } catch (error) {
      throw new FileOperationError(`Failed to find files with pattern ${pattern}: ${error}`);
    }
  }

  async createBackup(filePath: string): Promise<BackupInfo> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.backup-${timestamp}`;
      
      const content = await this.readFile(filePath);
      await this.writeFile(backupPath, content);
      
      const backupInfo: BackupInfo = {
        originalPath: filePath,
        backupPath,
        timestamp
      };
      
      this.logger.info(`Created backup: ${backupPath}`);
      return backupInfo;
    } catch (error) {
      throw new FileOperationError(`Failed to create backup for ${filePath}: ${error}`);
    }
  }

  async restoreFromBackup(backupInfo: BackupInfo): Promise<void> {
    try {
      const backupContent = await this.readFile(backupInfo.backupPath);
      await this.writeFile(backupInfo.originalPath, backupContent);
      this.logger.info(`Restored file from backup: ${backupInfo.originalPath}`);
    } catch (error) {
      throw new FileOperationError(`Failed to restore from backup ${backupInfo.backupPath}: ${error}`);
    }
  }

  async validateFileEdit(edit: FileEdit): Promise<boolean> {
    try {
      if (!await this.fileExists(edit.filePath)) {
        throw new FileOperationError(`File does not exist: ${edit.filePath}`);
      }

      const currentContent = await this.readFile(edit.filePath);
      if (currentContent !== edit.oldContent) {
        throw new FileOperationError(`File content has changed since edit was prepared: ${edit.filePath}`);
      }

      return true;
    } catch (error) {
      if (error instanceof FileOperationError) {
        throw error;
      }
      throw new FileOperationError(`Failed to validate edit for ${edit.filePath}: ${error}`);
    }
  }

  async applyFileEdit(edit: FileEdit, createBackup: boolean = true): Promise<BackupInfo | null> {
    try {
      await this.validateFileEdit(edit);
      
      let backupInfo: BackupInfo | null = null;
      if (createBackup) {
        backupInfo = await this.createBackup(edit.filePath);
      }

      await this.writeFile(edit.filePath, edit.newContent);
      this.logger.info(`Applied edit to file: ${edit.filePath}`);
      
      return backupInfo;
    } catch (error) {
      throw new FileOperationError(`Failed to apply edit to ${edit.filePath}: ${error}`);
    }
  }

  async applyMultipleEdits(edits: FileEdit[], createBackups: boolean = true): Promise<BackupInfo[]> {
    const backups: BackupInfo[] = [];
    const appliedEdits: string[] = [];

    try {
      // Validate all edits first
      for (const edit of edits) {
        await this.validateFileEdit(edit);
      }

      // Apply edits atomically
      for (const edit of edits) {
        let backupInfo: BackupInfo | null = null;
        
        if (createBackups) {
          backupInfo = await this.createBackup(edit.filePath);
          backups.push(backupInfo);
        }

        await this.writeFile(edit.filePath, edit.newContent);
        appliedEdits.push(edit.filePath);
        this.logger.debug(`Applied edit to: ${edit.filePath}`);
      }

      this.logger.info(`Successfully applied ${edits.length} file edits`);
      return backups;
    } catch (error) {
      // Rollback on failure
      this.logger.error(`Failed to apply edits, rolling back ${appliedEdits.length} changes`);
      
      for (const backup of backups) {
        try {
          await this.restoreFromBackup(backup);
        } catch (rollbackError) {
          this.logger.error(`Failed to rollback ${backup.originalPath}:`, rollbackError);
        }
      }

      throw new FileOperationError(`Failed to apply multiple edits: ${error}`);
    }
  }

  async getFileStats(filePath: string): Promise<{ size: number; modified: Date; lines: number }> {
    try {
      const stats = await fs.stat(filePath);
      const content = await this.readFile(filePath);
      const lines = content.split('\n').length;

      return {
        size: stats.size,
        modified: stats.mtime,
        lines
      };
    } catch (error) {
      throw new FileOperationError(`Failed to get stats for ${filePath}: ${error}`);
    }
  }
}