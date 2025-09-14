/**
 * History Manager for AIDE MCP Server
 * 
 * Provides operation history tracking and rollback capabilities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from './logger.js';
import { FileOperationError } from './errors.js';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  operation: string;
  tool: string;
  description: string;
  files: FileSnapshot[];
  metadata?: Record<string, any>;
}

export interface FileSnapshot {
  filePath: string;
  contentBefore: string;
  contentAfter: string;
  backup?: string;
}

export interface RollbackResult {
  success: boolean;
  filesRestored: string[];
  errors: string[];
  entryId: string;
}

export class HistoryManager {
  private historyDir: string;
  private maxEntries: number;
  private logger: Logger;

  constructor(logger: Logger, maxEntries: number = 100) {
    this.logger = logger;
    this.maxEntries = maxEntries;
    this.historyDir = path.join(process.cwd(), '.aide-history');
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
      this.logger.debug('History manager initialized');
    } catch (error) {
      throw new FileOperationError(`Failed to initialize history directory: ${error}`);
    }
  }

  async recordOperation(
    tool: string,
    operation: string,
    description: string,
    files: FileSnapshot[],
    metadata?: Record<string, any>
  ): Promise<string> {
    try {
      const entryId = uuidv4();
      const timestamp = new Date().toISOString();

      // Create backups for files
      const filesWithBackups = await Promise.all(
        files.map(async file => {
          const backupPath = await this.createBackup(file.filePath, file.contentBefore, entryId);
          return {
            ...file,
            backup: backupPath,
          };
        })
      );

      const entry: HistoryEntry = {
        id: entryId,
        timestamp,
        operation,
        tool,
        description,
        files: filesWithBackups,
        metadata: metadata || {},
      };

      await this.saveEntry(entry);
      await this.cleanupOldEntries();

      this.logger.info(`Recorded operation: ${operation} (${entryId})`);
      return entryId;
    } catch (error) {
      throw new FileOperationError(`Failed to record operation: ${error}`);
    }
  }

  private async createBackup(filePath: string, content: string, entryId: string): Promise<string> {
    try {
      const fileName = path.basename(filePath).replace(/[^a-zA-Z0-9.-]/g, '_');
      const backupPath = path.join(this.historyDir, `${entryId}_${fileName}`);
      await fs.writeFile(backupPath, content, 'utf-8');
      return backupPath;
    } catch (error) {
      throw new FileOperationError(`Failed to create backup: ${error}`);
    }
  }

  private async saveEntry(entry: HistoryEntry): Promise<void> {
    try {
      const entryPath = path.join(this.historyDir, `${entry.id}.json`);
      await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      throw new FileOperationError(`Failed to save history entry: ${error}`);
    }
  }

  async getHistory(limit?: number): Promise<HistoryEntry[]> {
    try {
      const files = await fs.readdir(this.historyDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      const entries: HistoryEntry[] = [];

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.historyDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const entry: HistoryEntry = JSON.parse(content);
          entries.push(entry);
        } catch (error) {
          this.logger.warn(`Failed to read history entry ${file}: ${error}`);
        }
      }

      // Sort by timestamp (newest first)
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return limit ? entries.slice(0, limit) : entries;
    } catch (error) {
      this.logger.warn(`Failed to get history: ${error}`);
      return [];
    }
  }

  async getEntry(entryId: string): Promise<HistoryEntry | null> {
    try {
      const entryPath = path.join(this.historyDir, `${entryId}.json`);
      const content = await fs.readFile(entryPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.warn(`Failed to get history entry ${entryId}: ${error}`);
      return null;
    }
  }

  async rollback(entryId: string): Promise<RollbackResult> {
    try {
      const entry = await this.getEntry(entryId);
      
      if (!entry) {
        return {
          success: false,
          filesRestored: [],
          errors: [`History entry ${entryId} not found`],
          entryId,
        };
      }

      const filesRestored: string[] = [];
      const errors: string[] = [];

      // Restore files from backups
      for (const file of entry.files) {
        try {
          if (file.backup && await this.fileExists(file.backup)) {
            const backupContent = await fs.readFile(file.backup, 'utf-8');
            await fs.writeFile(file.filePath, backupContent, 'utf-8');
            filesRestored.push(file.filePath);
            this.logger.debug(`Restored ${file.filePath} from backup`);
          } else {
            // Fallback to contentBefore if backup is missing
            await fs.writeFile(file.filePath, file.contentBefore, 'utf-8');
            filesRestored.push(file.filePath);
            this.logger.debug(`Restored ${file.filePath} from stored content`);
          }
        } catch (error) {
          errors.push(`Failed to restore ${file.filePath}: ${error}`);
        }
      }

      this.logger.info(`Rolled back operation ${entry.operation} (${entryId})`);
      
      return {
        success: errors.length === 0,
        filesRestored,
        errors,
        entryId,
      };
    } catch (error) {
      return {
        success: false,
        filesRestored: [],
        errors: [`Rollback failed: ${error}`],
        entryId,
      };
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    try {
      const entry = await this.getEntry(entryId);
      
      if (!entry) {
        return false;
      }

      // Delete backup files
      for (const file of entry.files) {
        if (file.backup && await this.fileExists(file.backup)) {
          try {
            await fs.unlink(file.backup);
          } catch (error) {
            this.logger.warn(`Failed to delete backup ${file.backup}: ${error}`);
          }
        }
      }

      // Delete entry file
      const entryPath = path.join(this.historyDir, `${entryId}.json`);
      await fs.unlink(entryPath);

      this.logger.info(`Deleted history entry: ${entryId}`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to delete entry ${entryId}: ${error}`);
      return false;
    }
  }

  async clearHistory(): Promise<number> {
    try {
      const files = await fs.readdir(this.historyDir);
      let deletedCount = 0;

      for (const file of files) {
        try {
          const filePath = path.join(this.historyDir, file);
          await fs.unlink(filePath);
          deletedCount++;
        } catch (error) {
          this.logger.warn(`Failed to delete ${file}: ${error}`);
        }
      }

      this.logger.info(`Cleared ${deletedCount} history entries`);
      return deletedCount;
    } catch (error) {
      this.logger.warn(`Failed to clear history: ${error}`);
      return 0;
    }
  }

  private async cleanupOldEntries(): Promise<void> {
    try {
      const entries = await this.getHistory();
      
      if (entries.length > this.maxEntries) {
        const entriesToDelete = entries.slice(this.maxEntries);
        
        for (const entry of entriesToDelete) {
          await this.deleteEntry(entry.id);
        }
        
        this.logger.debug(`Cleaned up ${entriesToDelete.length} old history entries`);
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup old entries: ${error}`);
    }
  }

  async searchHistory(query: {
    tool?: string;
    operation?: string;
    filePath?: string;
    after?: Date;
    before?: Date;
  }): Promise<HistoryEntry[]> {
    try {
      const allEntries = await this.getHistory();
      
      return allEntries.filter(entry => {
        // Filter by tool
        if (query.tool && entry.tool !== query.tool) {
          return false;
        }
        
        // Filter by operation
        if (query.operation && !entry.operation.includes(query.operation)) {
          return false;
        }
        
        // Filter by file path
        if (query.filePath && !entry.files.some(file => file.filePath.includes(query.filePath!))) {
          return false;
        }
        
        // Filter by date range
        const entryDate = new Date(entry.timestamp);
        if (query.after && entryDate < query.after) {
          return false;
        }
        if (query.before && entryDate > query.before) {
          return false;
        }
        
        return true;
      });
    } catch (error) {
      this.logger.warn(`Failed to search history: ${error}`);
      return [];
    }
  }

  generateHistoryReport(entries?: HistoryEntry[]): string {
    const historyEntries = entries || [];
    
    let report = '# Operation History Report\n\n';
    
    if (historyEntries.length === 0) {
      report += 'No operations recorded in history.\n';
      return report;
    }
    
    report += `## Summary\n`;
    report += `- **Total operations:** ${historyEntries.length}\n\n`;
    
    // Group by tool
    const toolGroups = historyEntries.reduce((acc, entry) => {
      if (!acc[entry.tool]) {
        acc[entry.tool] = [];
      }
      acc[entry.tool]?.push(entry);
      return acc;
    }, {} as Record<string, HistoryEntry[]>);
    
    report += `## Operations by Tool\n`;
    for (const [tool, toolEntries] of Object.entries(toolGroups)) {
      report += `- **${tool}:** ${toolEntries.length} operations\n`;
    }
    report += '\n';
    
    // Recent operations
    report += `## Recent Operations\n\n`;
    historyEntries.slice(0, 10).forEach(entry => {
      const date = new Date(entry.timestamp).toLocaleString();
      report += `### ${entry.operation}\n`;
      report += `- **Tool:** ${entry.tool}\n`;
      report += `- **Date:** ${date}\n`;
      report += `- **Description:** ${entry.description}\n`;
      report += `- **Files affected:** ${entry.files.length}\n`;
      report += `- **ID:** ${entry.id}\n\n`;
    });
    
    if (historyEntries.length > 10) {
      report += `... and ${historyEntries.length - 10} more operations\n`;
    }
    
    return report;
  }

  async getStorageUsage(): Promise<{ totalSize: number; entryCount: number; backupCount: number }> {
    try {
      const files = await fs.readdir(this.historyDir);
      let totalSize = 0;
      let entryCount = 0;
      let backupCount = 0;
      
      for (const file of files) {
        const filePath = path.join(this.historyDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
        
        if (file.endsWith('.json')) {
          entryCount++;
        } else {
          backupCount++;
        }
      }
      
      return { totalSize, entryCount, backupCount };
    } catch (error) {
      this.logger.warn(`Failed to get storage usage: ${error}`);
      return { totalSize: 0, entryCount: 0, backupCount: 0 };
    }
  }
}