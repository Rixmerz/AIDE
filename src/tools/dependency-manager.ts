/**
 * Dependency Manager Tool for AIDE MCP Server
 * 
 * Manages npm packages: install, update, audit, and maintain dependencies
 */

import { z } from 'zod';
import { NPMUtils, type DependencyUpdate, type AuditResult } from '../utils/npm-utils-simple.js';
import { HistoryManager } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const DependencyManagerSchema = z.object({
  operation: z.enum([
    'install', 
    'uninstall', 
    'update', 
    'check-updates', 
    'audit', 
    'fix-audit', 
    'list-scripts',
    'add-script',
    'run-script'
  ]),
  
  // Package operations
  packageName: z.string().optional(),
  packageVersion: z.string().optional(),
  saveDev: z.boolean().optional().default(false),
  saveExact: z.boolean().optional().default(false),
  
  // Update operations
  updateType: z.enum(['patch', 'minor', 'major', 'all']).optional().default('minor'),
  packages: z.array(z.string()).optional(),
  
  // Script operations
  scriptName: z.string().optional(),
  scriptCommand: z.string().optional(),
  
  // Options
  dryRun: z.boolean().optional().default(false),
  includeDevDependencies: z.boolean().optional().default(true),
  workingDirectory: z.string().optional(),
});

interface DependencyOperation {
  operation: string;
  success: boolean;
  output: string;
  packages?: string[];
  updates?: DependencyUpdate[];
  audit?: AuditResult;
  scripts?: Record<string, string>;
}

export async function handleDependencyManager(args: any, context: ToolContext) {
  const validated = DependencyManagerSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting dependency management operation', {
      operation: validated.operation,
      packageName: validated.packageName,
      dryRun: validated.dryRun,
    });

    const workingDir = validated.workingDirectory || process.cwd();
    const npmUtils = new NPMUtils(logger, workingDir);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    let response = `# Dependency Management Operation\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Working Directory:** ${workingDir}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE OPERATION'}\n\n`;

    let result: DependencyOperation;

    switch (validated.operation) {
      case 'install':
        result = await handleInstallPackage(validated, npmUtils, logger);
        break;
      case 'uninstall':
        result = await handleUninstallPackage(validated, npmUtils, logger);
        break;
      case 'update':
        result = await handleUpdatePackages(validated, npmUtils, logger);
        break;
      case 'check-updates':
        result = await handleCheckUpdates(validated, npmUtils, logger);
        break;
      case 'audit':
        result = await handleAuditPackages(validated, npmUtils, logger);
        break;
      case 'fix-audit':
        result = await handleFixAudit(validated, npmUtils, logger);
        break;
      case 'list-scripts':
        result = await handleListScripts(validated, npmUtils, logger);
        break;
      case 'add-script':
        result = await handleAddScript(validated, npmUtils, logger);
        break;
      case 'run-script':
        result = await handleRunScript(validated, npmUtils, logger);
        break;
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    response += `## Operation Results\n\n`;
    response += `**Status:** ${result.success ? '✅ Successful' : '❌ Failed'}\n\n`;

    // Display operation-specific results
    switch (validated.operation) {
      case 'install':
      case 'uninstall':
        if (result.success) {
          response += `### Package Operation Complete\n`;
          response += `**Package:** ${validated.packageName}\n`;
          if (validated.operation === 'install') {
            response += `**Save type:** ${validated.saveDev ? 'devDependencies' : 'dependencies'}\n`;
            response += `**Save exact:** ${validated.saveExact}\n`;
          }
          response += '\n';
        }
        break;

      case 'check-updates':
        if (result.updates && result.updates.length > 0) {
          response += `### Available Updates\n`;
          response += npmUtils.generateUpdateReport(result.updates);
        } else {
          response += `✅ All dependencies are up to date!\n`;
        }
        break;

      case 'update':
        if (result.success) {
          response += `### Update Results\n`;
          if (result.packages && result.packages.length > 0) {
            response += `**Packages updated:** ${result.packages.length}\n`;
            for (const pkg of result.packages) {
              response += `- ${pkg}\n`;
            }
          } else {
            response += `No packages were updated.\n`;
          }
        }
        break;

      case 'audit':
        if (result.audit) {
          response += npmUtils.generateAuditReport(result.audit);
        }
        break;

      case 'fix-audit':
        if (result.success) {
          response += `### Security Audit Fix Results\n`;
          response += `Security vulnerabilities have been automatically fixed where possible.\n`;
        }
        break;

      case 'list-scripts':
        if (result.scripts && Object.keys(result.scripts).length > 0) {
          response += `### Available NPM Scripts\n`;
          for (const [name, command] of Object.entries(result.scripts)) {
            response += `- **${name}:** \`${command}\`\n`;
          }
        } else {
          response += `No scripts found in package.json.\n`;
        }
        break;

      case 'add-script':
        if (result.success) {
          response += `### Script Added Successfully\n`;
          response += `**Name:** ${validated.scriptName}\n`;
          response += `**Command:** \`${validated.scriptCommand}\`\n`;
        }
        break;

      case 'run-script':
        if (result.success) {
          response += `### Script Execution Results\n`;
          response += `**Script:** ${validated.scriptName}\n`;
          response += `**Status:** Completed successfully\n`;
        }
        break;
    }

    // Show command output
    if (result.output && result.output.trim()) {
      response += `\n### Command Output\n`;
      // Truncate very long output
      const output = result.output.length > 2000 ? 
        result.output.substring(0, 2000) + '\n... (output truncated)' : 
        result.output;
      response += `\`\`\`\n${output}\n\`\`\`\n`;
    }

    // Show errors if operation failed
    if (!result.success) {
      response += `\n### Error Details\n`;
      response += `The operation failed. Check the command output above for details.\n`;
      
      if (validated.operation === 'install' && validated.packageName) {
        response += `\n**Troubleshooting Tips:**\n`;
        response += `- Verify the package name is correct\n`;
        response += `- Check if the package version exists\n`;
        response += `- Ensure you have internet connectivity\n`;
        response += `- Try clearing npm cache: \`npm cache clean --force\`\n`;
      }
    }

    // Record operation in history if it modified the project
    if (result.success && ['install', 'uninstall', 'update', 'fix-audit', 'add-script'].includes(validated.operation)) {
      try {
        const historyId = await historyManager.recordOperation(
          'dependency_manager',
          `Dependency Management: ${validated.operation}`,
          `${validated.operation} operation on ${validated.packageName || 'project dependencies'}`,
          [], // No file snapshots for npm operations
          {
            operation: validated.operation,
            packageName: validated.packageName,
            success: result.success,
            workingDirectory: workingDir,
          }
        );
        
        response += `\n**Operation ID:** ${historyId}\n`;
      } catch (historyError) {
        logger.warn('Failed to record operation in history:', historyError);
      }
    }

    // Next steps recommendations
    if (result.success) {
      response += `\n## Next Steps\n`;
      
      switch (validated.operation) {
        case 'install':
          response += `- Import the package in your code: \`import ... from '${validated.packageName}'\`\n`;
          response += `- Check the package documentation for usage examples\n`;
          response += `- Update your TypeScript types if needed\n`;
          break;
          
        case 'update':
          response += `- Test your application with the updated dependencies\n`;
          response += `- Check for breaking changes in updated packages\n`;
          response += `- Run your test suite to ensure compatibility\n`;
          break;
          
        case 'audit':
          if (result.audit && result.audit.totalVulnerabilities > 0) {
            response += `- Run \`dependency_manager\` with \`fix-audit\` operation to fix vulnerabilities\n`;
            response += `- Review high and critical severity issues immediately\n`;
            response += `- Consider updating vulnerable packages manually if auto-fix doesn't work\n`;
          }
          break;
          
        case 'fix-audit':
          response += `- Run audit again to verify fixes were applied\n`;
          response += `- Test your application after security updates\n`;
          response += `- Review any remaining vulnerabilities manually\n`;
          break;
          
        case 'add-script':
          response += `- Run the script using: \`npm run ${validated.scriptName}\`\n`;
          response += `- Consider adding the script to your development workflow\n`;
          break;
      }
    }

    logger.info('Dependency management operation completed', {
      operation: validated.operation,
      success: result.success,
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
    logger.error('Error in dependency_manager tool:', error);
    throw error;
  }
}

async function handleInstallPackage(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (!config.packageName) {
    return {
      operation: 'install',
      success: false,
      output: 'Package name is required for install operation',
    };
  }

  if (config.dryRun) {
    return {
      operation: 'install',
      success: true,
      output: `Would install: ${config.packageName}${config.packageVersion ? `@${config.packageVersion}` : ''} ${config.saveDev ? '(dev)' : '(prod)'}`,
    };
  }

  const installOptions: { saveDev?: boolean; saveExact?: boolean; version?: string } = {
    saveDev: config.saveDev,
    saveExact: config.saveExact,
  };
  if (config.packageVersion) {
    installOptions.version = config.packageVersion;
  }
  const result = await npmUtils.installPackage(config.packageName, installOptions);

  const response: DependencyOperation = {
    operation: 'install',
    success: result.success,
    output: result.output,
  };
  if (result.success) {
    response.packages = [config.packageName];
  }
  return response;
}

async function handleUninstallPackage(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (!config.packageName) {
    return {
      operation: 'uninstall',
      success: false,
      output: 'Package name is required for uninstall operation',
    };
  }

  if (config.dryRun) {
    return {
      operation: 'uninstall',
      success: true,
      output: `Would uninstall: ${config.packageName}`,
    };
  }

  const result = await npmUtils.uninstallPackage(config.packageName);

  return {
    operation: 'uninstall',
    success: result.success,
    output: result.output,
    packages: result.success ? [config.packageName] : undefined,
  };
}

async function handleUpdatePackages(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (config.dryRun) {
    const updates = await npmUtils.checkUpdates();
    const filteredUpdates = filterUpdatesByType(updates, config.updateType);
    
    return {
      operation: 'update',
      success: true,
      output: `Would update ${filteredUpdates.length} packages`,
      updates: filteredUpdates,
    };
  }

  let packages: string[] = [];
  let output = '';

  if (config.packages && config.packages.length > 0) {
    // Update specific packages
    for (const packageName of config.packages) {
      const result = await npmUtils.updatePackage(packageName, config.packageVersion);
      output += `${packageName}: ${result.success ? 'Updated' : 'Failed'}\n${result.output}\n`;
      if (result.success) {
        packages.push(packageName);
      }
    }
  } else {
    // Update all packages based on type
    const updates = await npmUtils.checkUpdates();
    const filteredUpdates = filterUpdatesByType(updates, config.updateType);
    
    for (const update of filteredUpdates) {
      const result = await npmUtils.updatePackage(update.name);
      output += `${update.name}: ${result.success ? 'Updated' : 'Failed'}\n${result.output}\n`;
      if (result.success) {
        packages.push(update.name);
      }
    }
  }

  return {
    operation: 'update',
    success: packages.length > 0,
    output,
    packages,
  };
}

async function handleCheckUpdates(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  const updates = await npmUtils.checkUpdates();
  const filteredUpdates = filterUpdatesByType(updates, config.updateType);

  return {
    operation: 'check-updates',
    success: true,
    output: `Found ${updates.length} total updates, ${filteredUpdates.length} matching criteria`,
    updates: filteredUpdates,
  };
}

async function handleAuditPackages(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  const audit = await npmUtils.auditPackages();

  return {
    operation: 'audit',
    success: true,
    output: `Found ${audit.totalVulnerabilities} vulnerabilities`,
    audit,
  };
}

async function handleFixAudit(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (config.dryRun) {
    return {
      operation: 'fix-audit',
      success: true,
      output: 'Would run: npm audit fix',
    };
  }

  const result = await npmUtils.fixAuditIssues();

  return {
    operation: 'fix-audit',
    success: result.success,
    output: result.output,
  };
}

async function handleListScripts(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  const scripts = await npmUtils.getScripts();

  return {
    operation: 'list-scripts',
    success: true,
    output: `Found ${Object.keys(scripts).length} scripts`,
    scripts,
  };
}

async function handleAddScript(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (!config.scriptName || !config.scriptCommand) {
    return {
      operation: 'add-script',
      success: false,
      output: 'Script name and command are required',
    };
  }

  if (config.dryRun) {
    return {
      operation: 'add-script',
      success: true,
      output: `Would add script: ${config.scriptName} = ${config.scriptCommand}`,
    };
  }

  const success = await npmUtils.addScript(config.scriptName, config.scriptCommand);

  return {
    operation: 'add-script',
    success,
    output: success ? 
      `Script '${config.scriptName}' added successfully` : 
      `Failed to add script '${config.scriptName}'`,
  };
}

async function handleRunScript(
  config: z.infer<typeof DependencyManagerSchema>,
  npmUtils: NPMUtils,
  _logger: any
): Promise<DependencyOperation> {
  if (!config.scriptName) {
    return {
      operation: 'run-script',
      success: false,
      output: 'Script name is required',
    };
  }

  if (config.dryRun) {
    return {
      operation: 'run-script',
      success: true,
      output: `Would run script: ${config.scriptName}`,
    };
  }

  const result = await npmUtils.runScript(config.scriptName);

  return {
    operation: 'run-script',
    success: result.success,
    output: result.output,
  };
}

function filterUpdatesByType(
  updates: DependencyUpdate[], 
  updateType: 'patch' | 'minor' | 'major' | 'all'
): DependencyUpdate[] {
  if (updateType === 'all') {
    return updates;
  }

  return updates.filter(update => {
    if (updateType === 'patch') {
      return update.updateType === 'patch';
    } else if (updateType === 'minor') {
      return update.updateType === 'patch' || update.updateType === 'minor';
    } else if (updateType === 'major') {
      return update.updateType === 'major';
    }
    return false;
  });
}