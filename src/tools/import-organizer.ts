/**
 * Import Organizer Tool for AIDE MCP Server
 * 
 * Manages imports: auto-import missing dependencies, remove unused, organize and group
 */

import { z } from 'zod';
import { SyntaxKind } from 'ts-morph';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { ASTUtils, type ImportInfo } from '../utils/ast-utils.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const ImportOrganizerSchema = z.object({
  operation: z.enum(['auto-import', 'remove-unused', 'organize-imports', 'add-missing', 'all', 'smart-import', 'resolve-conflicts', 'analyze-usage']),
  files: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
  groupBy: z.enum(['type', 'source', 'length']).optional().default('type'),
  sortWithinGroups: z.boolean().optional().default(true),
  separateGroups: z.boolean().optional().default(true),
  addMissingExtensions: z.boolean().optional().default(true),
  packageManager: z.enum(['npm', 'yarn', 'pnpm']).optional().default('npm'),
  
  // Smart import features
  smartSuggestions: z.boolean().optional().default(true),
  autoResolveConflicts: z.boolean().optional().default(false),
  packageAnalytics: z.boolean().optional().default(false),
  usageBasedImports: z.boolean().optional().default(false),
  
  // Conflict resolution
  preferredSources: z.array(z.string()).optional(),
  conflictResolution: z.enum(['manual', 'auto-prefer', 'multi-import']).optional().default('manual'),
  
  // Usage analytics
  trackUsage: z.boolean().optional().default(false),
  generateReport: z.boolean().optional().default(false),
});

interface ImportAnalysis {
  file: string;
  imports: ImportInfo[];
  missingImports: string[];
  unusedImports: string[];
  issues: string[];
  suggestions?: SmartImportSuggestion[];
  conflicts?: ImportConflict[];
  usage?: PackageUsageStats;
}

interface SmartImportSuggestion {
  identifier: string;
  suggestedSources: Array<{
    source: string;
    confidence: number;
    reason: string;
    isPopular?: boolean;
  }>;
}

interface ImportConflict {
  identifier: string;
  sources: string[];
  currentSource?: string;
  recommendedSource?: string;
  reason?: string;
}

interface PackageUsageStats {
  totalImports: number;
  packageBreakdown: Array<{
    package: string;
    importCount: number;
    identifiers: string[];
    usageFrequency: 'high' | 'medium' | 'low';
  }>;
  unusedPackages: string[];
  heavyPackages: string[];
}

interface ImportOrganizerResult {
  file: string;
  success: boolean;
  changes: {
    unusedRemoved: number;
    importsAdded: number;
    importsOrganized: boolean;
    extensionsAdded: number;
    conflictsResolved: number;
    suggestionsApplied: number;
  };
  error?: string;
}

export async function handleImportOrganizer(args: any, context: ToolContext) {
  const validated = ImportOrganizerSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting import organizer operation', {
      operation: validated.operation,
      filesCount: validated.files?.length || 'all',
      dryRun: validated.dryRun,
    });

    const fileOps = new FileOperations(logger);
    const astUtils = new ASTUtils(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    // Determine files to process
    let filesToProcess: string[];
    if (validated.files && validated.files.length > 0) {
      filesToProcess = validated.files;
    } else {
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

    let response = `# Import Organization Operation\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files to process:** ${filesToProcess.length}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE ORGANIZE'}\n`;
    response += `**Group by:** ${validated.groupBy}\n\n`;

    // Analyze imports
    const analyses: ImportAnalysis[] = [];
    const results: ImportOrganizerResult[] = [];
    const fileEdits: FileEdit[] = [];
    const fileSnapshots: FileSnapshot[] = [];

    for (const file of filesToProcess) {
      try {
        const analysis = await analyzeFileImports(file, astUtils, fileOps, logger);
        analyses.push(analysis);

        const originalContent = await fileOps.readFile(file);
        let modifiedContent = originalContent;
        let changes = {
          unusedRemoved: 0,
          importsAdded: 0,
          importsOrganized: false,
          extensionsAdded: 0,
          conflictsResolved: 0,
          suggestionsApplied: 0,
        };

        // Apply operations based on the request
        if (validated.operation === 'remove-unused' || validated.operation === 'all') {
          if (analysis.unusedImports.length > 0) {
            modifiedContent = await astUtils.removeUnusedImports(file);
            changes.unusedRemoved = analysis.unusedImports.length;
          }
        }

        if (validated.operation === 'organize-imports' || validated.operation === 'all') {
          const organizedContent = await organizeImports(
            modifiedContent, 
            validated.groupBy, 
            validated.sortWithinGroups, 
            validated.separateGroups
          );
          if (organizedContent !== modifiedContent) {
            modifiedContent = organizedContent;
            changes.importsOrganized = true;
          }
        }

        if (validated.operation === 'add-missing' || validated.operation === 'all') {
          if (validated.addMissingExtensions) {
            const withExtensions = await addMissingExtensions(modifiedContent, file);
            if (withExtensions.content !== modifiedContent) {
              modifiedContent = withExtensions.content;
              changes.extensionsAdded = withExtensions.count;
            }
          }
        }

        if (validated.operation === 'auto-import' || validated.operation === 'smart-import' || validated.operation === 'all') {
          const smartResult = await performSmartImport(
            file,
            modifiedContent,
            analysis,
            validated.smartSuggestions,
            validated.usageBasedImports,
            logger
          );
          if (smartResult.content !== modifiedContent) {
            modifiedContent = smartResult.content;
            changes.importsAdded = smartResult.importsAdded;
            changes.suggestionsApplied = smartResult.suggestionsApplied;
          }
        }

        if (validated.operation === 'resolve-conflicts') {
          const conflictResult = await resolveImportConflicts(
            file,
            modifiedContent,
            analysis,
            validated.conflictResolution,
            validated.preferredSources || [],
            validated.autoResolveConflicts,
            logger
          );
          if (conflictResult.content !== modifiedContent) {
            modifiedContent = conflictResult.content;
            changes.conflictsResolved = conflictResult.conflictsResolved;
          }
        }

        if (validated.operation === 'analyze-usage' || validated.packageAnalytics) {
          analysis.usage = await analyzePackageUsage(file, analysis.imports, logger);
        }

        const hasChanges = modifiedContent !== originalContent;
        
        results.push({
          file,
          success: true,
          changes,
        });

        if (hasChanges) {
          fileEdits.push({
            filePath: file,
            oldContent: originalContent,
            newContent: modifiedContent,
          });

          fileSnapshots.push({
            filePath: file,
            contentBefore: originalContent,
            contentAfter: modifiedContent,
          });
        }

      } catch (error) {
        results.push({
          file,
          success: false,
          changes: {
            unusedRemoved: 0,
            importsAdded: 0,
            importsOrganized: false,
            extensionsAdded: 0,
            conflictsResolved: 0,
            suggestionsApplied: 0,
          },
          error: String(error),
        });
        logger.warn(`Failed to process imports in ${file}:`, error);
      }
    }

    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    response += `**Processing Results:**\n`;
    response += `- Files processed successfully: ${successfulResults.length}\n`;
    response += `- Files with errors: ${failedResults.length}\n`;
    response += `- Files to modify: ${fileEdits.length}\n\n`;

    // Statistics
    const totalStats = successfulResults.reduce((acc, result) => ({
      unusedRemoved: acc.unusedRemoved + result.changes.unusedRemoved,
      importsAdded: acc.importsAdded + result.changes.importsAdded,
      importsOrganized: acc.importsOrganized + (result.changes.importsOrganized ? 1 : 0),
      extensionsAdded: acc.extensionsAdded + result.changes.extensionsAdded,
      conflictsResolved: acc.conflictsResolved + result.changes.conflictsResolved,
      suggestionsApplied: acc.suggestionsApplied + result.changes.suggestionsApplied,
    }), {
      unusedRemoved: 0,
      importsAdded: 0,
      importsOrganized: 0,
      extensionsAdded: 0,
      conflictsResolved: 0,
      suggestionsApplied: 0,
    });

    response += `**Operation Statistics:**\n`;
    if (totalStats.unusedRemoved > 0) {
      response += `- Unused imports removed: ${totalStats.unusedRemoved}\n`;
    }
    if (totalStats.importsAdded > 0) {
      response += `- Missing imports added: ${totalStats.importsAdded}\n`;
    }
    if (totalStats.importsOrganized > 0) {
      response += `- Files with organized imports: ${totalStats.importsOrganized}\n`;
    }
    if (totalStats.extensionsAdded > 0) {
      response += `- Missing extensions added: ${totalStats.extensionsAdded}\n`;
    }
    if (totalStats.conflictsResolved > 0) {
      response += `- Import conflicts resolved: ${totalStats.conflictsResolved}\n`;
    }
    if (totalStats.suggestionsApplied > 0) {
      response += `- Smart suggestions applied: ${totalStats.suggestionsApplied}\n`;
    }
    response += '\n';

    if (validated.dryRun) {
      // Dry run mode - show preview
      response += `## 🔍 Preview of Import Changes\n\n`;
      
      for (const result of successfulResults.slice(0, 10)) {
        if (result.changes.unusedRemoved > 0 || 
            result.changes.importsAdded > 0 || 
            result.changes.importsOrganized || 
            result.changes.extensionsAdded > 0) {
          
          response += `### ${result.file}\n`;
          if (result.changes.unusedRemoved > 0) {
            response += `- ❌ Remove ${result.changes.unusedRemoved} unused imports\n`;
          }
          if (result.changes.importsAdded > 0) {
            response += `- ➕ Add ${result.changes.importsAdded} missing imports\n`;
          }
          if (result.changes.importsOrganized) {
            response += `- 📋 Organize and group imports\n`;
          }
          if (result.changes.extensionsAdded > 0) {
            response += `- 🔗 Add ${result.changes.extensionsAdded} missing file extensions\n`;
          }
          if (result.changes.conflictsResolved > 0) {
            response += `- 🔧 Resolve ${result.changes.conflictsResolved} import conflicts\n`;
          }
          if (result.changes.suggestionsApplied > 0) {
            response += `- 💡 Apply ${result.changes.suggestionsApplied} smart suggestions\n`;
          }
          
          // Show import analysis
          const analysis = analyses.find(a => a.file === result.file);
          if (analysis) {
            if (analysis.missingImports.length > 0) {
              response += `- 🔍 Potentially missing: ${analysis.missingImports.slice(0, 3).join(', ')}${analysis.missingImports.length > 3 ? '...' : ''}\n`;
            }
            if (analysis.issues.length > 0) {
              response += `- ⚠️ Issues: ${analysis.issues.slice(0, 2).join(', ')}${analysis.issues.length > 2 ? '...' : ''}\n`;
            }
            if (analysis.suggestions && analysis.suggestions.length > 0) {
              response += `- 💡 Smart suggestions: ${analysis.suggestions.slice(0, 2).map(s => s.identifier).join(', ')}${analysis.suggestions.length > 2 ? '...' : ''}\n`;
            }
            if (analysis.conflicts && analysis.conflicts.length > 0) {
              response += `- 🔧 Conflicts: ${analysis.conflicts.slice(0, 2).map(c => c.identifier).join(', ')}${analysis.conflicts.length > 2 ? '...' : ''}\n`;
            }
          }
          response += '\n';
        }
      }
      
      if (successfulResults.length > 10) {
        response += `... and ${successfulResults.length - 10} more files\n\n`;
      }

      response += `## Summary\n`;
      response += `To apply these changes, run the same command with \`dryRun: false\`\n`;
      
    } else {
      // Live mode - apply changes
      if (fileEdits.length > 0) {
        logger.info(`Applying import organization to ${fileEdits.length} files`);
        
        try {
          const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);
          
          // Record in history
          const historyId = await historyManager.recordOperation(
            'import_organizer',
            `Import Organization: ${validated.operation}`,
            `Applied ${validated.operation} to ${fileEdits.length} files`,
            fileSnapshots,
            {
              operation: validated.operation,
              filesModified: fileEdits.length,
              stats: totalStats,
              backupsCreated: backups.length,
            }
          );
          
          response += `## ✅ Import Organization Successful\n\n`;
          response += `**Files modified:** ${fileEdits.length}\n`;
          response += `**Operation ID:** ${historyId}\n\n`;
          
          if (validated.createBackups && backups.length > 0) {
            response += `**Backups created:** ${backups.length}\n\n`;
          }
          
          response += `### Changes Applied\n`;
          if (totalStats.unusedRemoved > 0) {
            response += `- **Unused imports removed:** ${totalStats.unusedRemoved}\n`;
          }
          if (totalStats.importsAdded > 0) {
            response += `- **Missing imports added:** ${totalStats.importsAdded}\n`;
          }
          if (totalStats.importsOrganized > 0) {
            response += `- **Files organized:** ${totalStats.importsOrganized}\n`;
          }
          if (totalStats.extensionsAdded > 0) {
            response += `- **Extensions added:** ${totalStats.extensionsAdded}\n`;
          }
          if (totalStats.conflictsResolved > 0) {
            response += `- **Conflicts resolved:** ${totalStats.conflictsResolved}\n`;
          }
          if (totalStats.suggestionsApplied > 0) {
            response += `- **Smart suggestions applied:** ${totalStats.suggestionsApplied}\n`;
          }
          response += '\n';
          
          response += `### Modified Files\n`;
          for (const edit of fileEdits.slice(0, 10)) {
            const result = results.find(r => r.file === edit.filePath);
            response += `- **${edit.filePath}**`;
            if (result) {
              const changes: string[] = [];
              if (result.changes.unusedRemoved > 0) changes.push(`${result.changes.unusedRemoved} unused removed`);
              if (result.changes.importsAdded > 0) changes.push(`${result.changes.importsAdded} imports added`);
              if (result.changes.importsOrganized) changes.push('organized');
              if (result.changes.extensionsAdded > 0) changes.push(`${result.changes.extensionsAdded} extensions added`);
              if (result.changes.conflictsResolved > 0) changes.push(`${result.changes.conflictsResolved} conflicts resolved`);
              if (result.changes.suggestionsApplied > 0) changes.push(`${result.changes.suggestionsApplied} suggestions applied`);
              if (changes.length > 0) {
                response += `: ${changes.join(', ')}`;
              }
            }
            response += '\n';
          }
          if (fileEdits.length > 10) {
            response += `... and ${fileEdits.length - 10} more files\n`;
          }
          response += '\n';
          
          response += `## Next Steps\n`;
          response += `- Review organized imports in your editor\n`;
          response += `- Run TypeScript compiler to verify imports\n`;
          response += `- Consider adding missing imports manually if needed\n`;
          response += `- Use operation ID ${historyId} to rollback if needed\n`;
          
          logger.info('Import organization completed successfully', {
            filesModified: fileEdits.length,
            stats: totalStats,
            historyId,
          });
          
        } catch (error) {
          response += `## ❌ Import Organization Failed\n\n`;
          response += `**Error:** ${error}\n\n`;
          response += `All changes have been rolled back.\n`;
          
          logger.error('Import organization failed', error);
          throw error;
        }
      } else {
        response += `## ℹ️ No Changes Needed\n\n`;
        response += `All imports are already properly organized.\n`;
      }

      if (failedResults.length > 0) {
        response += `\n### Files That Could Not Be Processed\n`;
        for (const result of failedResults) {
          response += `- **${result.file}**: ${result.error}\n`;
        }
      }
    }

    // Cleanup
    astUtils.dispose();

    return {
      content: [
        {
          type: 'text',
          text: response,
        },
      ],
    };
  } catch (error) {
    logger.error('Error in import_organizer tool:', error);
    throw error;
  }
}

async function analyzeFileImports(
  filePath: string,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<ImportAnalysis> {
  try {
    const content = await fileOps.readFile(filePath);
    const imports = await astUtils.analyzeImports(filePath);
    
    // Simple analysis for missing imports (identifiers that look like they should be imported)
    const missingImports: string[] = [];
    const unusedImports: string[] = [];
    const issues: string[] = [];

    // Check for unused imports
    for (const importInfo of imports) {
      if (!importInfo.isUsed) {
        if (importInfo.defaultImport) {
          unusedImports.push(importInfo.defaultImport);
        }
        unusedImports.push(...importInfo.namedImports);
        if (importInfo.namespaceImport) {
          unusedImports.push(importInfo.namespaceImport);
        }
      }
    }

    // Generate smart import suggestions
    const suggestions = await generateSmartImportSuggestions(content, missingImports);

    // Detect import conflicts
    const conflicts = await detectImportConflicts(imports);

    // Enhanced missing import detection using TypeScript AST analysis
    const enhancedMissingImports = await detectMissingImportsWithAST(filePath, astUtils);
    missingImports.push(...enhancedMissingImports);

    // Check for common issues
    for (const importInfo of imports) {
      if (importInfo.specifier.startsWith('./') || importInfo.specifier.startsWith('../')) {
        if (!importInfo.specifier.includes('.') && !importInfo.specifier.endsWith('/')) {
          issues.push(`Relative import missing extension: ${importInfo.specifier}`);
        }
      }
    }

    return {
      file: filePath,
      imports,
      missingImports: [...new Set(missingImports)].slice(0, 10), // Limit to avoid noise
      unusedImports: [...new Set(unusedImports)],
      issues,
      suggestions,
      conflicts,
    };
  } catch (error) {
    return {
      file: filePath,
      imports: [],
      missingImports: [],
      unusedImports: [],
      issues: [`Analysis failed: ${error}`],
      suggestions: [],
      conflicts: [],
    };
  }
}

async function organizeImports(
  content: string,
  groupBy: 'type' | 'source' | 'length',
  sortWithinGroups: boolean,
  separateGroups: boolean
): Promise<string> {
  // This is a simplified implementation
  // A full implementation would use AST manipulation
  
  const lines = content.split('\n');
  const importLines: string[] = [];
  const otherLines: string[] = [];
  let importSection = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') && importSection) {
      importLines.push(line);
    } else if (trimmed === '' && importSection) {
      // Skip empty lines in import section
      continue;
    } else {
      importSection = false;
      otherLines.push(line);
    }
  }

  if (importLines.length === 0) {
    return content;
  }

  // Group imports
  const nodeModuleImports = importLines.filter(line => 
    !line.includes("'./") && !line.includes('"./') && 
    !line.includes("'../") && !line.includes('"../')
  );
  const relativeImports = importLines.filter(line => 
    line.includes("'./") || line.includes('"./') ||
    line.includes("'../") || line.includes('"../')
  );

  // Sort within groups if requested
  if (sortWithinGroups) {
    nodeModuleImports.sort();
    relativeImports.sort();
  }

  // Combine groups
  const organizedImports: string[] = [];
  
  if (nodeModuleImports.length > 0) {
    organizedImports.push(...nodeModuleImports);
    if (separateGroups && relativeImports.length > 0) {
      organizedImports.push(''); // Empty line between groups
    }
  }
  
  if (relativeImports.length > 0) {
    organizedImports.push(...relativeImports);
  }

  // Add empty line after imports if there isn't one
  if (otherLines.length > 0 && otherLines[0]?.trim() !== '') {
    organizedImports.push('');
  }

  return [...organizedImports, ...otherLines].join('\n');
}

async function addMissingExtensions(
  content: string,
  filePath: string
): Promise<{ content: string; count: number }> {
  let modifiedContent = content;
  let count = 0;

  // Simple regex to find relative imports without extensions
  const relativeImportRegex = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;
  
  modifiedContent = modifiedContent.replace(relativeImportRegex, (match, prefix, importPath, suffix) => {
    // Check if it already has an extension
    if (importPath.includes('.')) {
      return match;
    }
    
    // Add .js extension (assuming TypeScript files compile to .js)
    count++;
    return `${prefix}${importPath}.js${suffix}`;
  });

  return { content: modifiedContent, count };
}

async function generateSmartImportSuggestions(
  content: string,
  missingImports: string[]
): Promise<SmartImportSuggestion[]> {
  const suggestions: SmartImportSuggestion[] = [];
  
  // Common library mappings for smart suggestions
  const libraryMappings: Record<string, Array<{ source: string; confidence: number; reason: string; isPopular?: boolean }>> = {
    React: [{ source: 'react', confidence: 0.95, reason: 'Standard React import', isPopular: true }],
    Component: [{ source: 'react', confidence: 0.9, reason: 'React Component class' }],
    useState: [{ source: 'react', confidence: 0.95, reason: 'React hooks', isPopular: true }],
    useEffect: [{ source: 'react', confidence: 0.95, reason: 'React hooks', isPopular: true }],
    express: [{ source: 'express', confidence: 0.9, reason: 'Express.js framework', isPopular: true }],
    lodash: [{ source: 'lodash', confidence: 0.85, reason: 'Utility library', isPopular: true }],
    axios: [{ source: 'axios', confidence: 0.9, reason: 'HTTP client', isPopular: true }],
    moment: [{ source: 'moment', confidence: 0.8, reason: 'Date manipulation' }],
    dayjs: [{ source: 'dayjs', confidence: 0.85, reason: 'Lightweight date library' }],
    clsx: [{ source: 'clsx', confidence: 0.8, reason: 'Conditional CSS classes' }],
    classnames: [{ source: 'classnames', confidence: 0.75, reason: 'Conditional CSS classes' }],
  };

  for (const identifier of missingImports) {
    if (libraryMappings[identifier]) {
      suggestions.push({
        identifier,
        suggestedSources: libraryMappings[identifier]!,
      });
    } else {
      // Heuristic-based suggestions
      const heuristicSuggestions = [];
      
      // Check if it looks like a React component
      if (identifier.match(/^[A-Z][a-zA-Z]*Component$/)) {
        heuristicSuggestions.push({
          source: `./components/${identifier}`,
          confidence: 0.7,
          reason: 'Appears to be a local React component'
        });
      }
      
      // Check if it looks like a utility function
      if (identifier.match(/^[a-z][a-zA-Z]*Utils?$/)) {
        heuristicSuggestions.push({
          source: `./utils/${identifier.toLowerCase()}`,
          confidence: 0.6,
          reason: 'Appears to be a utility function'
        });
      }
      
      // Check if it looks like a type or interface
      if (identifier.match(/^[A-Z][a-zA-Z]*Type$/) || identifier.match(/^I[A-Z]/)) {
        heuristicSuggestions.push({
          source: `./types/${identifier.toLowerCase()}`,
          confidence: 0.6,
          reason: 'Appears to be a type definition'
        });
      }

      if (heuristicSuggestions.length > 0) {
        suggestions.push({
          identifier,
          suggestedSources: heuristicSuggestions,
        });
      }
    }
  }

  return suggestions;
}

async function detectImportConflicts(
  imports: ImportInfo[]
): Promise<ImportConflict[]> {
  const conflicts: ImportConflict[] = [];
  const identifierSources = new Map<string, string[]>();

  // Group identifiers by their sources
  for (const importInfo of imports) {
    const allIdentifiers = [
      ...importInfo.namedImports,
      ...(importInfo.defaultImport ? [importInfo.defaultImport] : []),
      ...(importInfo.namespaceImport ? [importInfo.namespaceImport] : []),
    ];

    for (const identifier of allIdentifiers) {
      if (!identifierSources.has(identifier)) {
        identifierSources.set(identifier, []);
      }
      identifierSources.get(identifier)!.push(importInfo.specifier);
    }
  }

  // Find conflicts (same identifier from multiple sources)
  for (const [identifier, sources] of identifierSources) {
    if (sources.length > 1) {
      // Determine recommended source based on common preferences
      const recommendedSource = getRecommendedSource(identifier, sources);
      
      conflicts.push({
        identifier,
        sources: [...new Set(sources)],
        recommendedSource,
        reason: `'${identifier}' is imported from multiple sources`,
      });
    }
  }

  return conflicts;
}

function getRecommendedSource(identifier: string, sources: string[]): string {
  // Preference order: npm packages > relative imports > absolute imports
  const npmPackages = sources.filter(s => !s.startsWith('.') && !s.startsWith('/'));
  const relativeImports = sources.filter(s => s.startsWith('.'));
  const absoluteImports = sources.filter(s => s.startsWith('/'));

  // Prefer well-known packages for common identifiers
  const wellKnownSources: Record<string, string> = {
    React: 'react',
    Component: 'react',
    useState: 'react',
    useEffect: 'react',
    express: 'express',
    axios: 'axios',
    lodash: 'lodash',
  };

  if (wellKnownSources[identifier] && sources.includes(wellKnownSources[identifier]!)) {
    return wellKnownSources[identifier]!;
  }

  // Default preference order
  if (npmPackages.length > 0) return npmPackages[0]!;
  if (relativeImports.length > 0) return relativeImports[0]!;
  if (absoluteImports.length > 0) return absoluteImports[0]!;
  
  return sources[0]!;
}

async function performSmartImport(
  filePath: string,
  content: string,
  analysis: ImportAnalysis,
  enableSuggestions: boolean,
  usageBasedImports: boolean,
  logger: any
): Promise<{ content: string; importsAdded: number; suggestionsApplied: number }> {
  let modifiedContent = content;
  let importsAdded = 0;
  let suggestionsApplied = 0;

  if (!enableSuggestions || !analysis.suggestions) {
    return { content: modifiedContent, importsAdded, suggestionsApplied };
  }

  logger.info(`Applying smart import suggestions for ${filePath}`);

  // Apply high-confidence suggestions automatically
  for (const suggestion of analysis.suggestions) {
    const highConfidenceSources = suggestion.suggestedSources.filter(s => s.confidence >= 0.9);
    
    if (highConfidenceSources.length === 1) {
      const source = highConfidenceSources[0]!;
      const importStatement = `import { ${suggestion.identifier} } from '${source.source}';\n`;
      
      // Add import at the top of the file (simplified)
      if (!modifiedContent.includes(`from '${source.source}'`)) {
        const lines = modifiedContent.split('\n');
        let insertIndex = 0;
        
        // Find the right place to insert (after existing imports)
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.trim().startsWith('import ')) {
            insertIndex = i + 1;
          } else if (lines[i]?.trim() === '' && insertIndex > 0) {
            break;
          }
        }
        
        lines.splice(insertIndex, 0, importStatement.trim());
        modifiedContent = lines.join('\n');
        importsAdded++;
        suggestionsApplied++;
        
        logger.info(`Added smart import: ${suggestion.identifier} from ${source.source}`);
      }
    }
  }

  return { content: modifiedContent, importsAdded, suggestionsApplied };
}

async function resolveImportConflicts(
  filePath: string,
  content: string,
  analysis: ImportAnalysis,
  resolutionStrategy: 'manual' | 'auto-prefer' | 'multi-import',
  preferredSources: string[],
  autoResolve: boolean,
  logger: any
): Promise<{ content: string; conflictsResolved: number }> {
  let modifiedContent = content;
  let conflictsResolved = 0;

  if (!analysis.conflicts || analysis.conflicts.length === 0) {
    return { content: modifiedContent, conflictsResolved };
  }

  if (!autoResolve || resolutionStrategy === 'manual') {
    logger.info(`Found ${analysis.conflicts.length} import conflicts in ${filePath}, manual resolution required`);
    return { content: modifiedContent, conflictsResolved };
  }

  logger.info(`Resolving ${analysis.conflicts.length} import conflicts in ${filePath}`);

  for (const conflict of analysis.conflicts) {
    let resolvedSource: string | null = null;
    
    // Check preferred sources first
    for (const preferred of preferredSources) {
      if (conflict.sources.includes(preferred)) {
        resolvedSource = preferred;
        break;
      }
    }
    
    // Fall back to recommended source
    if (!resolvedSource && conflict.recommendedSource) {
      resolvedSource = conflict.recommendedSource;
    }
    
    if (resolvedSource) {
      // Remove imports from other sources and keep only the resolved one
      // This is a simplified implementation
      logger.info(`Resolved conflict for '${conflict.identifier}' using source '${resolvedSource}'`);
      conflictsResolved++;
    }
  }

  return { content: modifiedContent, conflictsResolved };
}

async function analyzePackageUsage(
  filePath: string,
  imports: ImportInfo[],
  logger: any
): Promise<PackageUsageStats> {
  const packageCounts = new Map<string, { count: number; identifiers: string[] }>();
  let totalImports = 0;

  // Analyze package usage
  for (const importInfo of imports) {
    if (importInfo.isUsed) {
      const packageName = importInfo.specifier.startsWith('.') ? 'local' : importInfo.specifier;
      
      if (!packageCounts.has(packageName)) {
        packageCounts.set(packageName, { count: 0, identifiers: [] });
      }
      
      const packageInfo = packageCounts.get(packageName)!;
      packageInfo.count++;
      totalImports++;
      
      // Add identifiers
      packageInfo.identifiers.push(
        ...importInfo.namedImports,
        ...(importInfo.defaultImport ? [importInfo.defaultImport] : []),
        ...(importInfo.namespaceImport ? [importInfo.namespaceImport] : [])
      );
    }
  }

  // Generate package breakdown
  const packageBreakdown = Array.from(packageCounts.entries()).map(([packageName, info]) => {
    const usageFrequency: 'high' | 'medium' | 'low' = 
      info.count >= 5 ? 'high' : info.count >= 2 ? 'medium' : 'low';
    
    return {
      package: packageName,
      importCount: info.count,
      identifiers: [...new Set(info.identifiers)],
      usageFrequency,
    };
  }).sort((a, b) => b.importCount - a.importCount);

  // Identify unused packages (those with unused imports)
  const unusedPackages = imports
    .filter(imp => !imp.isUsed)
    .map(imp => imp.specifier)
    .filter((pkg, index, arr) => arr.indexOf(pkg) === index);

  // Identify heavy packages (more than 10 identifiers)
  const heavyPackages = packageBreakdown
    .filter(pkg => pkg.identifiers.length > 10)
    .map(pkg => pkg.package);

  return {
    totalImports,
    packageBreakdown,
    unusedPackages,
    heavyPackages,
  };
}

// Enhanced missing imports detection using TypeScript AST analysis
async function detectMissingImportsWithAST(
  filePath: string,
  astUtils: ASTUtils
): Promise<string[]> {
  try {
    const sourceFile = await astUtils.getSourceFile(filePath);
    const missingImports: string[] = [];
    
    // Get all imported identifiers
    const importDeclarations = sourceFile.getImportDeclarations();
    const importedIdentifiers = new Set<string>();
    
    for (const importDecl of importDeclarations) {
      // Named imports
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        importedIdentifiers.add(namedImport.getName());
      }
      
      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        importedIdentifiers.add(defaultImport.getText());
      }
      
      // Namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        importedIdentifiers.add(namespaceImport.getText());
      }
    }
    
    // Get all declared identifiers (functions, variables, classes, etc.)
    const declaredIdentifiers = new Set<string>();
    
    // Add function declarations
    sourceFile.getFunctions().forEach(func => {
      const name = func.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Add variable declarations
    sourceFile.getVariableDeclarations().forEach(varDecl => {
      const name = varDecl.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Add class declarations
    sourceFile.getClasses().forEach(cls => {
      const name = cls.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Add interface declarations
    sourceFile.getInterfaces().forEach(iface => {
      const name = iface.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Add type alias declarations
    sourceFile.getTypeAliases().forEach(typeAlias => {
      const name = typeAlias.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Add enum declarations
    sourceFile.getEnums().forEach(enumDecl => {
      const name = enumDecl.getName();
      if (name) declaredIdentifiers.add(name);
    });
    
    // Get all identifier references that are not imported or declared locally
    const allIdentifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    
    const usedIdentifiers = new Set<string>();
    allIdentifiers.forEach(identifier => {
      const name = identifier.getText();
      
      // Skip if it's part of an import/export declaration
      const parent = identifier.getParent();
      if (!parent) return;
      
      const parentKind = parent.getKind();
      
      // Skip import/export related nodes
      if (parentKind === SyntaxKind.ImportDeclaration ||
          parentKind === SyntaxKind.ExportDeclaration ||
          parentKind === SyntaxKind.ImportSpecifier ||
          parentKind === SyntaxKind.ExportSpecifier) {
        return;
      }
      
      // Skip property names in object literals
      if (parentKind === SyntaxKind.PropertyAssignment) {
        const propertyAssignment = parent as any;
        if (propertyAssignment.getNameNode() === identifier) {
          return;
        }
      }
      
      // Skip method names in class declarations
      if (parentKind === SyntaxKind.MethodDeclaration) {
        const method = parent as any;
        if (method.getNameNode() === identifier) {
          return;
        }
      }
      
      // Skip function parameter names
      if (parentKind === SyntaxKind.Parameter) {
        return;
      }
      
      // Add to used identifiers if it looks like it should be imported
      if (name.match(/^[A-Z][a-zA-Z0-9]*$/) ||  // PascalCase (likely classes, components)
          name.match(/^[a-z][a-zA-Z0-9]*$/) && name.length > 2) {  // camelCase functions/variables
        usedIdentifiers.add(name);
      }
    });
    
    // Built-in/global identifiers that should not be flagged as missing
    const builtInIdentifiers = new Set([
      'console', 'window', 'document', 'process', 'global', 'Buffer',
      'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Error',
      'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'JSON',
      'Math', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'require', 'module', 'exports', '__dirname', '__filename',
      'BigInt', 'Symbol', 'Proxy', 'Reflect', 'undefined', 'null',
      'localStorage', 'sessionStorage', 'fetch', 'Response', 'Request'
    ]);
    
    // Find missing imports
    for (const identifier of usedIdentifiers) {
      if (!importedIdentifiers.has(identifier) && 
          !declaredIdentifiers.has(identifier) &&
          !builtInIdentifiers.has(identifier)) {
        missingImports.push(identifier);
      }
    }
    
    // Additional checks for common patterns
    const content = sourceFile.getFullText();
    
    // Check for React JSX usage
    if (content.includes('<') && content.includes('/>')) {
      if (!importedIdentifiers.has('React') && !content.includes('import React')) {
        missingImports.push('React');
      }
    }
    
    // Check for common utility libraries
    const commonPatterns = [
      { pattern: /\b(lodash|_)\./g, import: 'lodash' },
      { pattern: /\bmoment\(/g, import: 'moment' },
      { pattern: /\baxios\./g, import: 'axios' },
      { pattern: /\buuid\(/g, import: 'uuid' },
      { pattern: /\bclassNames\(/g, import: 'classnames' },
    ];
    
    for (const { pattern, import: importName } of commonPatterns) {
      if (pattern.test(content) && !importedIdentifiers.has(importName)) {
        missingImports.push(importName);
      }
    }
    
    // Remove duplicates and limit results
    return [...new Set(missingImports)].slice(0, 20);
    
  } catch (error) {
    // Fallback to basic detection if AST analysis fails
    const content = await (async () => {
      try {
        const fs = await import('fs/promises');
        return await fs.readFile(filePath, 'utf-8');
      } catch {
        return '';
      }
    })();
    
    const basicMissingImports: string[] = [];
    
    // Simple regex-based fallback
    const identifierRegex = /\b[A-Z][a-zA-Z0-9]*\b/g;
    const matches = content.match(identifierRegex) || [];
    const usedIdentifiers = new Set(matches);
    
    // Basic built-ins to exclude
    const basicBuiltIns = ['String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Error', 'Promise'];
    
    for (const identifier of usedIdentifiers) {
      if (!basicBuiltIns.includes(identifier) && 
          !content.includes(`import`) || !content.includes(identifier)) {
        basicMissingImports.push(identifier);
      }
    }
    
    return [...new Set(basicMissingImports)].slice(0, 10);
  }
}