/**
 * AIDE MCP Tools Registration
 * 
 * Registers all AIDE tools with the MCP server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  McpError, 
  ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../utils/logger.js';
import type { ErrorHandler } from '../utils/errors.js';
import { handleErrorDiff } from './error-diff.js';
import { handleMultiFileEdit } from './multi-file-edit.js';
import { handlePatternReplace } from './pattern-replace.js';
import { handleTypescriptAutoFix } from './typescript-fix-simple.js';
// Enhanced tools
import { handleTypescriptAutoFixAdvanced } from './typescript-fix-advanced.js';
// import { handleMultiFileEditAdvanced } from './multi-file-edit-advanced.js';
import { handlePatternReplaceAdvanced } from './pattern-replace-advanced.js';
// New tools
import { handleCodeRefactor } from './code-refactor.js';
import { handleImportOrganizer } from './import-organizer.js';
import { handleCodeFormatter } from './code-formatter.js';
import { handleDependencyManager } from './dependency-manager.js';
// Advanced analysis tools
import { handleCodeStructureAnalyzer } from './code-structure-analyzer.js';
import { handleCodeDuplicates } from './code-duplicates.js';
import { handleVariableLifecycle } from './variable-lifecycle.js';
// Recently resolved TypeScript issues - re-enabling these tools
import { handleTypeEvolution } from './type-evolution.js';
import { handleCodeModernizer } from './code-modernizer.js';
import { handleSmartCompletion } from './smart-completion.js';
import { handleApiContractSync } from './api-contract-sync.js';

export interface ToolContext {
  logger: Logger;
  errorHandler: ErrorHandler;
}

export async function registerTools(server: Server, context: ToolContext): Promise<void> {
  const { logger, errorHandler } = context;

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      logger.info(`Executing AIDE tool: ${name}`, { args });

      switch (name) {
        case 'error_diff':
          return await handleErrorDiff(args, context);
        case 'multi_file_edit':
          return await handleMultiFileEdit(args, context);
        case 'pattern_replace':
          return await handlePatternReplace(args, context);
        case 'typescript_auto_fix':
          return await handleTypescriptAutoFix(args, context);
        // Enhanced tools
        case 'typescript_auto_fix_advanced':
          return await handleTypescriptAutoFixAdvanced(args, context);
        // case 'multi_file_edit_advanced':
        //   return await handleMultiFileEditAdvanced(args, context);
        case 'pattern_replace_advanced':
          return await handlePatternReplaceAdvanced(args, context);
        // New tools
        case 'code_refactor':
          return await handleCodeRefactor(args, context);
        case 'import_organizer':
          return await handleImportOrganizer(args, context);
        case 'code_formatter':
          return await handleCodeFormatter(args, context);
        case 'dependency_manager':
          return await handleDependencyManager(args, context);
        // Advanced analysis tools
        case 'code_structure_analyzer':
          return await handleCodeStructureAnalyzer(args, context);
        case 'code_duplicates':
          return await handleCodeDuplicates(args, context);
        case 'variable_lifecycle':
          return await handleVariableLifecycle(args, context);
        // Recently resolved TypeScript issues - re-enabling these tools
        case 'type_evolution':
          return await handleTypeEvolution(args, context);
        case 'code_modernizer':
          return await handleCodeModernizer(args, context);
        case 'smart_completion':
          return await handleSmartCompletion(args, context);
        case 'api_contract_sync':
          return await handleApiContractSync(args, context);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown AIDE tool: ${name}`);
      }
    } catch (error) {
      logger.error(`Error in AIDE tool ${name}:`, error);
      return errorHandler.handleToolError(error, name);
    }
  });

  // Register tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info('Listing available AIDE tools');
    
    return {
      tools: [
        {
          name: 'error_diff',
          description: 'Compare TypeScript errors between two build outputs to show resolved, new, and persistent errors',
          inputSchema: {
            type: 'object',
            properties: {
              beforeBuild: {
                type: 'string',
                description: 'Output from the previous TypeScript build',
              },
              afterBuild: {
                type: 'string',
                description: 'Output from the current TypeScript build',
              },
              includeReport: {
                type: 'boolean',
                description: 'Include detailed error diff report',
                default: true,
              },
            },
            required: ['beforeBuild', 'afterBuild'],
          },
        },
        {
          name: 'multi_file_edit',
          description: 'Edit multiple files in one atomic operation with validation and rollback support',
          inputSchema: {
            type: 'object',
            properties: {
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      description: 'Path to the file to edit',
                    },
                    old: {
                      type: 'string',
                      description: 'Text to replace (must match exactly)',
                    },
                    new: {
                      type: 'string',
                      description: 'Replacement text',
                    },
                  },
                  required: ['file', 'old', 'new'],
                },
                description: 'Array of file edits to apply atomically',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before editing',
                default: true,
              },
            },
            required: ['edits'],
          },
        },
        {
          name: 'pattern_replace',
          description: 'Replace patterns across entire project using regex with file glob support',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Regular expression pattern to find',
              },
              replacement: {
                type: 'string',
                description: 'Replacement text (supports regex groups)',
              },
              fileGlob: {
                type: 'string',
                description: 'File glob pattern to match files',
                default: 'src/**/*.{ts,tsx,js,jsx}',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false,
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Whether pattern matching should be case sensitive',
                default: true,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before replacing',
                default: true,
              },
            },
            required: ['pattern', 'replacement'],
          },
        },
        {
          name: 'typescript_auto_fix',
          description: 'Automatically fix common TypeScript errors by category',
          inputSchema: {
            type: 'object',
            properties: {
              errorType: {
                type: 'string',
                enum: ['unused-imports', 'unused-variables', 'missing-properties', 'null-checks', 'all'],
                description: 'Type of errors to auto-fix',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to fix (optional, defaults to project-wide)',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview fixes without applying them',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before fixing',
                default: true,
              },
            },
            required: ['errorType'],
          },
        },
        {
          name: 'typescript_auto_fix_advanced',
          description: 'Advanced TypeScript auto-fix with import sorting, type assertions, async/await conversion, and ESLint integration',
          inputSchema: {
            type: 'object',
            properties: {
              errorType: {
                type: 'string',
                enum: ['unused-imports', 'unused-variables', 'missing-properties', 'null-checks', 'type-assertions', 'import-sorting', 'async-await-conversion', 'eslint-rules', 'all'],
                description: 'Type of errors to auto-fix',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to fix (optional, defaults to project-wide)',
              },
              eslintRules: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific ESLint rules to apply',
              },
              importStyle: {
                type: 'string',
                enum: ['grouped', 'sorted', 'optimized'],
                description: 'Import organization style',
                default: 'optimized',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview fixes without applying them',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before fixing',
                default: true,
              },
            },
            required: ['errorType'],
          },
        },
        {
          name: 'multi_file_edit_advanced',
          description: 'Advanced multi-file editing with conflict detection, line-based edits, and detailed preview',
          inputSchema: {
            type: 'object',
            properties: {
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      description: 'Path to the file to edit',
                    },
                    old: {
                      type: 'string',
                      description: 'Text to replace (must match exactly)',
                    },
                    new: {
                      type: 'string',
                      description: 'Replacement text',
                    },
                    startLine: {
                      type: 'number',
                      description: 'Start line number for range-based edit',
                    },
                    endLine: {
                      type: 'number',
                      description: 'End line number for range-based edit',
                    },
                  },
                  required: ['file'],
                },
                description: 'Array of file edits to apply atomically',
              },
              validateConflicts: {
                type: 'boolean',
                description: 'Check for edit conflicts before applying',
                default: true,
              },
              previewContext: {
                type: 'number',
                description: 'Number of context lines to show in preview',
                default: 3,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before editing',
                default: true,
              },
            },
            required: ['edits'],
          },
        },
        {
          name: 'pattern_replace_advanced',
          description: 'Advanced pattern replacement with exclude patterns, conditional replacement, and history tracking',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Regular expression pattern to find',
              },
              replacement: {
                type: 'string',
                description: 'Replacement text (supports regex groups)',
              },
              fileGlob: {
                type: 'string',
                description: 'File glob pattern to match files',
                default: 'src/**/*.{ts,tsx,js,jsx}',
              },
              excludePatterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'Patterns to exclude from replacement',
              },
              conditionalReplace: {
                type: 'object',
                properties: {
                  contextPattern: {
                    type: 'string',
                    description: 'Only replace if this context pattern is found',
                  },
                  avoidPattern: {
                    type: 'string',
                    description: 'Skip replacement if this pattern is found nearby',
                  },
                },
                description: 'Conditional replacement rules',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false,
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Whether pattern matching should be case sensitive',
                default: true,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before replacing',
                default: true,
              },
            },
            required: ['pattern', 'replacement'],
          },
        },
        {
          name: 'code_refactor',
          description: 'Advanced code refactoring operations like extract function, inline, move, and rename',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['extract-function', 'extract-method', 'extract-class', 'inline-function', 'inline-variable', 'move-to-file', 'rename-symbol'],
                description: 'Type of refactoring operation to perform',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file to refactor',
              },
              startLine: {
                type: 'number',
                description: 'Start line for extraction operations',
              },
              endLine: {
                type: 'number',
                description: 'End line for extraction operations',
              },
              extractedName: {
                type: 'string',
                description: 'Name for extracted function/method/class',
              },
              symbolName: {
                type: 'string',
                description: 'Symbol name for inline/move operations',
              },
              oldName: {
                type: 'string',
                description: 'Current symbol name for rename operations',
              },
              newName: {
                type: 'string',
                description: 'New symbol name for rename operations',
              },
              targetFile: {
                type: 'string',
                description: 'Target file path for move operations',
              },
              updateReferences: {
                type: 'boolean',
                description: 'Update all references when refactoring',
                default: true,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview refactoring without applying changes',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before refactoring',
                default: true,
              },
            },
            required: ['operation', 'filePath'],
          },
        },
        {
          name: 'import_organizer',
          description: 'Auto-import missing dependencies, remove unused imports, and organize import statements',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['organize', 'auto-import', 'remove-unused', 'sort-imports', 'group-imports', 'analyze-dependencies'],
                description: 'Type of import operation to perform',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to process (optional, defaults to project-wide)',
              },
              autoImportSymbols: {
                type: 'array',
                items: { type: 'string' },
                description: 'Symbols to auto-import (for auto-import operation)',
              },
              importStyle: {
                type: 'string',
                enum: ['grouped', 'sorted', 'optimized'],
                description: 'How to organize imports',
                default: 'optimized',
              },
              groupSeparator: {
                type: 'boolean',
                description: 'Add blank lines between import groups',
                default: true,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before organizing',
                default: true,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'code_formatter',
          description: 'Comprehensive code formatting using Prettier and ESLint with custom rules',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['format-prettier', 'fix-eslint', 'format-and-fix', 'check-formatting'],
                description: 'Type of formatting operation',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to format (optional, uses glob pattern if not provided)',
              },
              prettierConfig: {
                type: 'object',
                properties: {
                  printWidth: { type: 'number' },
                  tabWidth: { type: 'number' },
                  useTabs: { type: 'boolean' },
                  semi: { type: 'boolean' },
                  singleQuote: { type: 'boolean' },
                  trailingComma: { type: 'string', enum: ['none', 'es5', 'all'] },
                  bracketSpacing: { type: 'boolean' },
                  arrowParens: { type: 'string', enum: ['avoid', 'always'] },
                },
                description: 'Prettier configuration overrides',
              },
              includeGlob: {
                type: 'string',
                description: 'File glob pattern to include',
                default: 'src/**/*.{ts,tsx,js,jsx}',
              },
              excludeGlob: {
                type: 'string',
                description: 'File glob pattern to exclude',
              },
              parallel: {
                type: 'boolean',
                description: 'Process files in parallel',
                default: true,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview formatting without applying changes',
                default: false,
              },
              createBackups: {
                type: 'boolean',
                description: 'Create backup files before formatting',
                default: true,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'dependency_manager',
          description: 'Comprehensive NPM package management: install, update, audit, and maintain dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['install', 'uninstall', 'update', 'check-updates', 'audit', 'fix-audit', 'list-scripts', 'add-script', 'run-script'],
                description: 'Type of dependency operation',
              },
              packageName: {
                type: 'string',
                description: 'Name of the package (for install/uninstall operations)',
              },
              packageVersion: {
                type: 'string',
                description: 'Specific version to install',
              },
              saveDev: {
                type: 'boolean',
                description: 'Save as dev dependency',
                default: false,
              },
              saveExact: {
                type: 'boolean',
                description: 'Save exact version',
                default: false,
              },
              updateType: {
                type: 'string',
                enum: ['patch', 'minor', 'major', 'all'],
                description: 'Type of updates to apply',
                default: 'minor',
              },
              packages: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific packages to update',
              },
              scriptName: {
                type: 'string',
                description: 'NPM script name (for script operations)',
              },
              scriptCommand: {
                type: 'string',
                description: 'NPM script command (for add-script operation)',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview operation without applying changes',
                default: false,
              },
              workingDirectory: {
                type: 'string',
                description: 'Working directory for npm operations',
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'code_structure_analyzer',
          description: 'Comprehensive code structure analysis with complexity metrics, architectural insights, and code quality assessment',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['analyze-structure', 'detect-smells', 'complexity-analysis', 'dependency-analysis', 'architecture-review', 'full-analysis'],
                description: 'Type of analysis to perform',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to analyze (optional, defaults to project-wide)',
              },
              includeMetrics: {
                type: 'boolean',
                description: 'Include detailed metrics in the analysis',
                default: true,
              },
              complexityThreshold: {
                type: 'number',
                description: 'Complexity threshold for warnings',
                default: 10,
              },
              generateReport: {
                type: 'boolean',
                description: 'Generate a comprehensive analysis report',
                default: true,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'code_duplicates',
          description: 'Advanced code duplication detection with refactoring suggestions and automated extraction capabilities',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['detect-duplicates', 'extract-common', 'merge-similar', 'analyze-patterns', 'full-deduplication'],
                description: 'Type of duplication operation to perform',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to analyze (optional, defaults to project-wide)',
              },
              minLines: {
                type: 'number',
                description: 'Minimum number of lines to consider as duplicate',
                default: 5,
              },
              minTokens: {
                type: 'number',
                description: 'Minimum number of tokens to consider as duplicate',
                default: 50,
              },
              similarityThreshold: {
                type: 'number',
                description: 'Similarity threshold (0.0-1.0) for detecting similar code',
                default: 0.8,
              },
              extractionStrategy: {
                type: 'string',
                enum: ['function', 'class', 'utility', 'component'],
                description: 'Strategy for extracting duplicated code',
                default: 'function',
              },
              createUtilityFile: {
                type: 'boolean',
                description: 'Create separate utility file for extracted code',
                default: false,
              },
              utilityFilePath: {
                type: 'string',
                description: 'Path for utility file (if createUtilityFile is true)',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview duplication analysis without applying changes',
                default: false,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'variable_lifecycle',
          description: 'Advanced variable usage analysis with lifecycle optimization, scope analysis, and immutability suggestions',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['analyze-usage', 'optimize-declarations', 'fix-scope', 'detect-unused', 'suggest-immutable', 'full-optimization'],
                description: 'Type of variable lifecycle operation',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to analyze (optional, defaults to project-wide)',
              },
              includeUnused: {
                type: 'boolean',
                description: 'Include analysis of unused variables',
                default: true,
              },
              suggestImmutable: {
                type: 'boolean',
                description: 'Suggest const for variables that are never reassigned',
                default: true,
              },
              analyzeScopeOptimization: {
                type: 'boolean',
                description: 'Analyze variable scope for potential optimizations',
                default: true,
              },
              generateReport: {
                type: 'boolean',
                description: 'Generate comprehensive variable usage report',
                default: true,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview optimizations without applying changes',
                default: false,
              },
            },
            required: ['operation'],
          },
        },
        // Recently resolved TypeScript issues - re-enabling these tools
        {
          name: 'type_evolution',
          description: 'Advanced TypeScript type evolution analysis with interface conversion, generics, and type safety improvements',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['analyze-types', 'suggest-interfaces', 'add-generics', 'improve-safety', 'detect-evolution', 'full-evolution'],
                description: 'Type of type evolution operation',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to analyze (optional, defaults to project-wide)',
              },
              includeGenerics: {
                type: 'boolean',
                description: 'Include generic type suggestions',
                default: true,
              },
              suggestInterfaces: {
                type: 'boolean',
                description: 'Suggest converting type aliases to interfaces',
                default: true,
              },
              improveSafety: {
                type: 'boolean',
                description: 'Suggest type safety improvements',
                default: true,
              },
              evolutionThreshold: {
                type: 'number',
                description: 'Evolution confidence threshold (0.0-1.0)',
                default: 0.7,
              },
              generateReport: {
                type: 'boolean',
                description: 'Generate comprehensive type evolution report',
                default: true,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview type evolution without applying changes',
                default: false,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'code_modernizer',
          description: 'JavaScript/TypeScript code modernization with ES6+ features, async/await, and modern patterns',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['es6-features', 'async-await', 'arrow-functions', 'destructuring', 'template-literals', 'class-syntax', 'import-export', 'full-modernization'],
                description: 'Type of modernization operation',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to modernize (optional, defaults to project-wide)',
              },
              includeArrowFunctions: {
                type: 'boolean',
                description: 'Convert to arrow functions',
                default: true,
              },
              includeDestructuring: {
                type: 'boolean',
                description: 'Add destructuring patterns',
                default: true,
              },
              includeTemplateLiterals: {
                type: 'boolean',
                description: 'Convert to template literals',
                default: true,
              },
              includeAsyncAwait: {
                type: 'boolean',
                description: 'Convert to async/await',
                default: true,
              },
              aggressiveMode: {
                type: 'boolean',
                description: 'Apply more aggressive modernizations',
                default: false,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview modernizations without applying changes',
                default: false,
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'smart_completion',
          description: 'Intelligent code completion with AST analysis, type inference, and context-aware suggestions',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['suggest-completions', 'auto-import', 'method-signatures', 'type-completions', 'pattern-completions', 'full-assistance'],
                description: 'Type of completion assistance',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file for completion',
              },
              position: {
                type: 'object',
                properties: {
                  line: { type: 'number', description: 'Line number (1-based)' },
                  character: { type: 'number', description: 'Character position (0-based)' }
                },
                required: ['line', 'character'],
                description: 'Cursor position for completion',
              },
              context: {
                type: 'string',
                description: 'Additional context for completion',
              },
              partialInput: {
                type: 'string',
                description: 'Partial text being typed',
              },
              includeImports: {
                type: 'boolean',
                description: 'Include auto-import suggestions',
                default: true,
              },
              includeSnippets: {
                type: 'boolean',
                description: 'Include code snippet suggestions',
                default: true,
              },
              maxSuggestions: {
                type: 'number',
                description: 'Maximum number of suggestions',
                default: 10,
              },
              confidenceThreshold: {
                type: 'number',
                description: 'Minimum confidence threshold (0.0-1.0)',
                default: 0.6,
              },
            },
            required: ['operation', 'filePath', 'position'],
          },
        },
        {
          name: 'api_contract_sync',
          description: 'API contract synchronization with TypeScript type generation, validation, and client generation from OpenAPI specs',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['generate-types', 'validate-contracts', 'detect-changes', 'generate-client', 'sync-schemas', 'full-sync'],
                description: 'Type of API contract operation',
              },
              apiSpecPath: {
                type: 'string',
                description: 'Path to OpenAPI/Swagger specification file',
              },
              apiSpecUrl: {
                type: 'string',
                description: 'URL to OpenAPI/Swagger specification',
              },
              outputDir: {
                type: 'string',
                description: 'Output directory for generated types',
                default: './src/types/api',
              },
              clientOutputDir: {
                type: 'string',
                description: 'Output directory for generated API clients',
                default: './src/api/clients',
              },
              includeValidation: {
                type: 'boolean',
                description: 'Include runtime validation',
                default: true,
              },
              includeDocumentation: {
                type: 'boolean',
                description: 'Include JSDoc documentation',
                default: true,
              },
              generateMocks: {
                type: 'boolean',
                description: 'Generate mock data for testing',
                default: false,
              },
              targetFramework: {
                type: 'string',
                enum: ['fetch', 'axios', 'swr', 'react-query'],
                description: 'Target HTTP client framework',
                default: 'fetch',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview contract sync without applying changes',
                default: false,
              },
            },
            required: ['operation'],
          },
        },
      ],
    };
  });

  logger.info('AIDE MCP tools registered successfully');
}