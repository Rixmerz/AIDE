/**
 * Smart Completion Tool
 * 
 * Provides intelligent code completion suggestions using:
 * - AST analysis for context-aware suggestions
 * - Type inference for accurate completions
 * - Pattern recognition for common coding patterns
 * - Import suggestions for external dependencies
 * - Method signature assistance
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import type { ToolContext } from './index.js';
import { ASTUtilsEnhanced } from '../utils/ast-utils-enhanced.js';
import { FileOperations } from '../utils/file-operations.js';

const SmartCompletionSchema = z.object({
  operation: z.enum([
    'suggest-completions',
    'auto-import',
    'method-signatures',
    'type-completions',
    'pattern-completions',
    'full-assistance'
  ]),
  filePath: z.string(),
  position: z.object({
    line: z.number(),
    character: z.number()
  }),
  context: z.string().optional(),
  partialInput: z.string().optional(),
  includeImports: z.boolean().default(true),
  includeSnippets: z.boolean().default(true),
  includeTypeInfo: z.boolean().default(true),
  maxSuggestions: z.number().default(10),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  languageContext: z.enum(['typescript', 'javascript', 'tsx', 'jsx']).optional()
});

interface CompletionSuggestion {
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
  kind: 'function' | 'variable' | 'class' | 'interface' | 'enum' | 'module' | 'property' | 'method' | 'snippet' | 'import';
  confidence: number;
  sortText: string;
  filterText: string;
  additionalTextEdits?: Array<{
    range: { start: { line: number; character: number }, end: { line: number; character: number } };
    newText: string;
  }>;
  imports?: Array<{
    module: string;
    name: string;
    isDefault: boolean;
  }>;
}

interface TypeCompletionInfo {
  expectedType: string;
  availableTypes: string[];
  suggestions: CompletionSuggestion[];
}

interface MethodSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string;
  }>;
  returnType: string;
  documentation: string;
  overloads: MethodSignature[];
}

interface CompletionContext {
  file: string;
  position: { line: number; character: number };
  surroundingCode: string;
  currentScope: 'global' | 'function' | 'class' | 'method' | 'block';
  availableSymbols: Array<{
    name: string;
    type: string;
    kind: string;
    source: 'local' | 'imported' | 'global';
  }>;
  expectedType?: string;
  inCallExpression?: {
    functionName: string;
    parameterIndex: number;
  };
}

interface CompletionResult {
  suggestions: CompletionSuggestion[];
  context: CompletionContext;
  typeInfo: TypeCompletionInfo | null;
  methodSignatures: MethodSignature[];
  diagnostics: Array<{
    message: string;
    severity: 'info' | 'warning' | 'error';
    range: { start: { line: number; character: number }, end: { line: number; character: number } };
  }>;
  performance: {
    analysisTime: number;
    suggestionCount: number;
    cacheHits: number;
  };
}

export async function handleSmartCompletion(args: any, context: ToolContext): Promise<any> {
  const { logger } = context;

  try {
    logger.info('Starting smart completion analysis', { args });

    const validated = SmartCompletionSchema.parse(args);
    
    // Check if file exists
    const astUtils = new ASTUtilsEnhanced(logger);
    const fileOps = new FileOperations(logger);
    
    let completionResult: CompletionResult | null = null;
    const startTime = Date.now();

    switch (validated.operation) {
      case 'suggest-completions':
        completionResult = await suggestCompletions(validated, astUtils, fileOps, logger);
        break;
      
      case 'auto-import':
        completionResult = await suggestAutoImports(validated, astUtils, fileOps, logger);
        break;
      
      case 'method-signatures':
        completionResult = await provideMethodSignatures(validated, astUtils, fileOps, logger);
        break;
      
      case 'type-completions':
        completionResult = await provideTypeCompletions(validated, astUtils, fileOps, logger);
        break;
      
      case 'pattern-completions':
        completionResult = await providePatternCompletions(validated, astUtils, fileOps, logger);
        break;
      
      case 'full-assistance':
        completionResult = await provideFullAssistance(validated, astUtils, fileOps, logger);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    const analysisTime = Date.now() - startTime;
    if (completionResult) {
      completionResult.performance.analysisTime = analysisTime;
    }

    // Generate response
    let response = `## Smart Completion Results\n\n`;
    response += `**File:** ${validated.filePath}\n`;
    response += `**Position:** Line ${validated.position.line!}, Character ${validated.position.character}\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Analysis time:** ${analysisTime}ms\n\n`;

    if (completionResult) {
      response += generateCompletionResponse(completionResult, validated);
    }

    return {
      content: [{
        type: 'text',
        text: response
      }],
      // Include structured data for LSP-like integrations
      metadata: completionResult ? {
        suggestions: completionResult.suggestions,
        context: completionResult.context,
        performance: completionResult.performance
      } : undefined
    };

  } catch (error) {
    logger.error('Error in smart completion:', error);
    throw error;
  }
}

async function suggestCompletions(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Providing completions for ${options.filePath} at ${options.position.line!}:${options.position.character}`);

  const context = await analyzeCompletionContext(options, astUtils, logger);
  const suggestions: CompletionSuggestion[] = [];

  // Get basic symbol completions
  for (const symbol of context.availableSymbols) {
    if (options.partialInput && !symbol.name.toLowerCase().includes(options.partialInput.toLowerCase())) {
      continue;
    }

    suggestions.push({
      label: symbol.name,
      insertText: symbol.name,
      detail: `${symbol.type} (${symbol.source})`,
      documentation: `${symbol.kind} from ${symbol.source}`,
      kind: mapSymbolKind(symbol.kind),
      confidence: symbol.source === 'local' ? 0.9 : 0.7,
      sortText: `${symbol.source === 'local' ? '0' : '1'}${symbol.name}`,
      filterText: symbol.name
    });
  }

  // Add common pattern suggestions
  if (context.currentScope === 'function' || context.currentScope === 'method') {
    suggestions.push(
      ...getCommonPatternSuggestions(context, options.partialInput)
    );
  }

  // Filter by confidence threshold
  const filteredSuggestions = suggestions
    .filter(s => s.confidence >= options.confidenceThreshold)
    .slice(0, options.maxSuggestions);

  return {
    suggestions: filteredSuggestions,
    context,
    typeInfo: null,
    methodSignatures: [],
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: filteredSuggestions.length,
      cacheHits: 0
    }
  };
}

async function suggestAutoImports(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Suggesting auto-imports for ${options.partialInput} in ${options.filePath}`);

  const context = await analyzeCompletionContext(options, astUtils, logger);
  const suggestions: CompletionSuggestion[] = [];

  if (options.partialInput) {
    // Look for potential imports in node_modules and project files
    const importSuggestions = await findPotentialImports(
      options.partialInput,
      options.filePath,
      astUtils,
      logger
    );

    for (const importSug of importSuggestions) {
      suggestions.push({
        label: importSug.name,
        insertText: importSug.name,
        detail: `Import from ${importSug.module}`,
        documentation: `Auto-import ${importSug.name} from ${importSug.module}`,
        kind: 'import',
        confidence: importSug.confidence,
        sortText: `0${importSug.name}`,
        filterText: importSug.name,
        additionalTextEdits: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: importSug.isDefault 
            ? `import ${importSug.name} from '${importSug.module}';\n`
            : `import { ${importSug.name} } from '${importSug.module}';\n`
        }],
        imports: [{
          module: importSug.module,
          name: importSug.name,
          isDefault: importSug.isDefault
        }]
      });
    }
  }

  return {
    suggestions,
    context,
    typeInfo: null,
    methodSignatures: [],
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: suggestions.length,
      cacheHits: 0
    }
  };
}

async function provideMethodSignatures(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Providing method signatures for ${options.filePath}`);

  const context = await analyzeCompletionContext(options, astUtils, logger);
  const methodSignatures: MethodSignature[] = [];

  if (context.inCallExpression) {
    // Find method signatures for the function being called
    const functionName = context.inCallExpression.functionName;
    const signatures = await findMethodSignatures(functionName, context, astUtils, logger);
    methodSignatures.push(...signatures);
  }

  return {
    suggestions: [],
    context,
    typeInfo: null,
    methodSignatures,
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: 0,
      cacheHits: 0
    }
  };
}

async function provideTypeCompletions(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Providing type completions for ${options.filePath}`);

  const context = await analyzeCompletionContext(options, astUtils, logger);
  const suggestions: CompletionSuggestion[] = [];
  
  // Get type-specific completions
  if (context.expectedType) {
    const typeCompletions = getTypeBasedCompletions(context.expectedType, options.partialInput);
    suggestions.push(...typeCompletions);
  }

  const typeInfo: TypeCompletionInfo = {
    expectedType: context.expectedType || 'unknown',
    availableTypes: getAvailableTypes(context),
    suggestions: suggestions
  };

  return {
    suggestions,
    context,
    typeInfo,
    methodSignatures: [],
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: suggestions.length,
      cacheHits: 0
    }
  };
}

async function providePatternCompletions(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Providing pattern completions for ${options.filePath}`);

  const context = await analyzeCompletionContext(options, astUtils, logger);
  const suggestions = getPatternBasedSuggestions(context, options.partialInput);

  return {
    suggestions,
    context,
    typeInfo: null,
    methodSignatures: [],
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: suggestions.length,
      cacheHits: 0
    }
  };
}

async function provideFullAssistance(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<CompletionResult> {
  logger.info(`Providing full completion assistance for ${options.filePath}`);

  // Combine all completion types
  const basicResult = await suggestCompletions(options, astUtils, fileOps, logger);
  const importResult = await suggestAutoImports(options, astUtils, fileOps, logger);
  const typeResult = await provideTypeCompletions(options, astUtils, fileOps, logger);
  const patternResult = await providePatternCompletions(options, astUtils, fileOps, logger);
  const signatureResult = await provideMethodSignatures(options, astUtils, fileOps, logger);

  // Merge and deduplicate suggestions
  const allSuggestions = [
    ...basicResult.suggestions,
    ...importResult.suggestions,
    ...typeResult.suggestions,
    ...patternResult.suggestions
  ];

  const uniqueSuggestions = deduplicateSuggestions(allSuggestions)
    .sort((a, b) => b.confidence - a.confidence || a.sortText.localeCompare(b.sortText))
    .slice(0, options.maxSuggestions);

  return {
    suggestions: uniqueSuggestions,
    context: basicResult.context,
    typeInfo: typeResult.typeInfo,
    methodSignatures: signatureResult.methodSignatures,
    diagnostics: [],
    performance: {
      analysisTime: 0,
      suggestionCount: uniqueSuggestions.length,
      cacheHits: 0
    }
  };
}

// Helper functions

async function analyzeCompletionContext(
  options: z.infer<typeof SmartCompletionSchema>,
  astUtils: ASTUtilsEnhanced,
  logger: any
): Promise<CompletionContext> {
  try {
    const content = await readFile(options.filePath, 'utf-8');
    const lines = content.split('\n');
    const currentLine = lines[options.position.line! - 1] || '';
    
    // Extract surrounding code for context
    const surroundingStart = Math.max(0, options.position.line! - 5);
    const surroundingEnd = Math.min(lines.length, options.position.line! + 5);
    const surroundingCode = lines.slice(surroundingStart, surroundingEnd).join('\n');

    // Analyze available symbols (simplified)
    const availableSymbols = await analyzeAvailableSymbols(options.filePath, astUtils, logger);

    // Determine current scope (simplified)
    const currentScope = determineScopeAtPosition(lines, options.position);

    // Check if we're in a call expression
    const inCallExpression = analyzeCallExpression(currentLine, options.position.character);

    return {
      file: options.filePath,
      position: options.position,
      surroundingCode,
      currentScope,
      availableSymbols,
      inCallExpression
    };
  } catch (error) {
    logger.warn(`Error analyzing completion context:`, error);
    
    return {
      file: options.filePath,
      position: options.position,
      surroundingCode: '',
      currentScope: 'global',
      availableSymbols: [],
    };
  }
}

async function analyzeAvailableSymbols(
  filePath: string,
  astUtils: ASTUtilsEnhanced,
  logger: any
): Promise<Array<{name: string; type: string; kind: string; source: 'local' | 'imported' | 'global'}>> {
  const symbols = [];

  try {
    // Get imports
    const imports = await astUtils.analyzeImports(filePath);
    for (const imp of imports) {
      if (imp.defaultImport) {
        symbols.push({
          name: imp.defaultImport,
          type: 'any',
          kind: 'variable',
          source: 'imported' as const
        });
      }
      for (const namedImport of imp.namedImports) {
        symbols.push({
          name: namedImport,
          type: 'any',
          kind: 'variable',
          source: 'imported' as const
        });
      }
    }

    // Add common global symbols
    const commonGlobals = [
      { name: 'console', type: 'Console', kind: 'variable', source: 'global' as const },
      { name: 'Promise', type: 'PromiseConstructor', kind: 'class', source: 'global' as const },
      { name: 'Array', type: 'ArrayConstructor', kind: 'class', source: 'global' as const },
      { name: 'Object', type: 'ObjectConstructor', kind: 'class', source: 'global' as const },
      { name: 'String', type: 'StringConstructor', kind: 'class', source: 'global' as const },
      { name: 'Number', type: 'NumberConstructor', kind: 'class', source: 'global' as const },
      { name: 'Boolean', type: 'BooleanConstructor', kind: 'class', source: 'global' as const }
    ];

    symbols.push(...commonGlobals);

  } catch (error) {
    logger.warn('Error analyzing symbols:', error);
  }

  return symbols;
}

function determineScopeAtPosition(
  lines: string[],
  position: { line: number; character: number }
): 'global' | 'function' | 'class' | 'method' | 'block' {
  // Simple scope detection based on line! content analysis
  for (let i = position.line! - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    
    if (line!.includes('function ') || line!.includes('const ') && line!.includes('= (') && line!.includes('=>')) {
      return 'function';
    }
    if (line!.includes('class ')) {
      return 'class';
    }
    if (line!.includes('method') || (line!.includes(')(') && line!.includes('{'))) {
      return 'method';
    }
    if (line!.includes('{')) {
      return 'block';
    }
  }
  
  return 'global';
}

function analyzeCallExpression(
  line: string,
  character: number
): { functionName: string; parameterIndex: number } | undefined {
  const beforeCursor = line!.substring(0, character);
  const callMatch = beforeCursor.match(/(\w+)\s*\([^)]*$/);
  
  if (callMatch) {
    const functionName = callMatch[1];
    const paramsText = beforeCursor.substring((callMatch.index ?? 0) + functionName!.length + 1);
    const parameterIndex = (paramsText.match(/,/g) || []).length;

    return { functionName: functionName!, parameterIndex };
  }
  
  return undefined;
}

async function findPotentialImports(
  partialInput: string,
  filePath: string,
  astUtils: ASTUtilsEnhanced,
  logger: any
): Promise<Array<{name: string; module: string; confidence: number; isDefault: boolean}>> {
  const imports = [];

  // Common libraries and their exports (simplified)
  const commonExports = {
    'lodash': ['map', 'filter', 'reduce', 'forEach', 'find', 'includes', 'isEmpty', 'isNull', 'isUndefined'],
    'react': ['useState', 'useEffect', 'useContext', 'useCallback', 'useMemo', 'Component', 'Fragment'],
    'fs': ['readFile', 'writeFile', 'existsSync', 'mkdirSync', 'stat'],
    'path': ['join', 'resolve', 'dirname', 'basename', 'extname'],
    'util': ['promisify', 'inspect', 'types'],
  };

  for (const [module, exports] of Object.entries(commonExports)) {
    for (const exportName of exports) {
      if (exportName.toLowerCase().includes(partialInput.toLowerCase())) {
        imports.push({
          name: exportName,
          module,
          confidence: 0.8,
          isDefault: false
        });
      }
    }
  }

  // Add some default imports
  if (partialInput.toLowerCase().includes('react')) {
    imports.push({
      name: 'React',
      module: 'react',
      confidence: 0.9,
      isDefault: true
    });
  }

  return imports.slice(0, 5); // Limit to top 5 matches
}

async function findMethodSignatures(
  functionName: string,
  context: CompletionContext,
  astUtils: ASTUtilsEnhanced,
  logger: any
): Promise<MethodSignature[]> {
  const signatures: MethodSignature[] = [];

  // Common method signatures (simplified)
  const commonSignatures: Record<string, MethodSignature> = {
    'map': {
      name: 'map',
      parameters: [
        { name: 'callback', type: '(value: T, index: number, array: T[]) => U', optional: false },
        { name: 'thisArg', type: 'any', optional: true }
      ],
      returnType: 'U[]',
      documentation: 'Creates a new array populated with the results of calling a provided function on every element in the calling array.',
      overloads: []
    },
    'filter': {
      name: 'filter',
      parameters: [
        { name: 'predicate', type: '(value: T, index: number, array: T[]) => boolean', optional: false },
        { name: 'thisArg', type: 'any', optional: true }
      ],
      returnType: 'T[]',
      documentation: 'Creates a new array with all elements that pass the test implemented by the provided function.',
      overloads: []
    },
    'console.log': {
      name: 'console.log',
      parameters: [
        { name: 'message', type: 'any', optional: true },
        { name: '...optionalParams', type: 'any[]', optional: true }
      ],
      returnType: 'void',
      documentation: 'Outputs a message to the console.',
      overloads: []
    }
  };

  const signature = commonSignatures[functionName];
  if (signature) {
    signatures.push(signature);
  }

  return signatures;
}

function getCommonPatternSuggestions(
  context: CompletionContext,
  partialInput?: string
): CompletionSuggestion[] {
  const suggestions: CompletionSuggestion[] = [];

  // Common patterns
  const patterns = [
    {
      label: 'if statement',
      insertText: 'if (${1:condition}) {\n  ${2:// code}\n}',
      detail: 'if statement',
      documentation: 'Creates an if statement',
      kind: 'snippet' as const,
      confidence: 0.8
    },
    {
      label: 'for loop',
      insertText: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3:// code}\n}',
      detail: 'for loop',
      documentation: 'Creates a for loop',
      kind: 'snippet' as const,
      confidence: 0.8
    },
    {
      label: 'try-catch',
      insertText: 'try {\n  ${1:// code}\n} catch (${2:error}) {\n  ${3:// handle error}\n}',
      detail: 'try-catch block',
      documentation: 'Creates a try-catch block',
      kind: 'snippet' as const,
      confidence: 0.7
    }
  ];

  return patterns
    .filter(p => !partialInput || p.label.toLowerCase().includes(partialInput.toLowerCase()))
    .map((pattern, index) => ({
      ...pattern,
      sortText: `2${index.toString().padStart(3, '0')}`,
      filterText: pattern.label
    }));
}

function getTypeBasedCompletions(expectedType: string, partialInput?: string): CompletionSuggestion[] {
  const suggestions: CompletionSuggestion[] = [];

  // Type-specific completions
  if (expectedType.includes('string')) {
    suggestions.push({
      label: "''",
      insertText: "'${1:}'",
      detail: 'string literal',
      documentation: 'Empty string literal',
      kind: 'snippet',
      confidence: 0.9,
      sortText: '0001',
      filterText: 'string'
    });
  }

  if (expectedType.includes('number')) {
    suggestions.push({
      label: '0',
      insertText: '${1:0}',
      detail: 'number literal',
      documentation: 'Number literal',
      kind: 'snippet',
      confidence: 0.9,
      sortText: '0002',
      filterText: 'number'
    });
  }

  if (expectedType.includes('boolean')) {
    suggestions.push(
      {
        label: 'true',
        insertText: 'true',
        detail: 'boolean',
        documentation: 'Boolean true value',
        kind: 'snippet',
        confidence: 0.9,
        sortText: '0003',
        filterText: 'true'
      },
      {
        label: 'false',
        insertText: 'false',
        detail: 'boolean',
        documentation: 'Boolean false value',
        kind: 'snippet',
        confidence: 0.9,
        sortText: '0004',
        filterText: 'false'
      }
    );
  }

  return suggestions.filter(s => !partialInput || s.filterText.includes(partialInput.toLowerCase()));
}

function getAvailableTypes(context: CompletionContext): string[] {
  return [
    'string', 'number', 'boolean', 'object', 'array', 'function',
    'Promise', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'any', 'unknown', 'never', 'void', 'null', 'undefined'
  ];
}

function getPatternBasedSuggestions(context: CompletionContext, partialInput?: string): CompletionSuggestion[] {
  const suggestions: CompletionSuggestion[] = [];

  // Context-specific patterns
  if (context.currentScope === 'class') {
    suggestions.push({
      label: 'constructor',
      insertText: 'constructor(${1:parameters}) {\n  ${2:// initialization}\n}',
      detail: 'class constructor',
      documentation: 'Creates a class constructor',
      kind: 'snippet',
      confidence: 0.9,
      sortText: '0001',
      filterText: 'constructor'
    });
  }

  if (context.surroundingCode.includes('async') || context.surroundingCode.includes('await')) {
    suggestions.push({
      label: 'await',
      insertText: 'await ${1:promise}',
      detail: 'await expression',
      documentation: 'Awaits a promise',
      kind: 'snippet',
      confidence: 0.8,
      sortText: '0002',
      filterText: 'await'
    });
  }

  return suggestions.filter(s => !partialInput || s.filterText.includes(partialInput.toLowerCase()));
}

function mapSymbolKind(kind: string): CompletionSuggestion['kind'] {
  const mapping: Record<string, CompletionSuggestion['kind']> = {
    'function': 'function',
    'variable': 'variable',
    'class': 'class',
    'interface': 'interface',
    'enum': 'enum',
    'module': 'module',
    'property': 'property',
    'method': 'method'
  };
  
  return mapping[kind] || 'variable';
}

function deduplicateSuggestions(suggestions: CompletionSuggestion[]): CompletionSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter(s => {
    const key = `${s.label}-${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateCompletionResponse(result: CompletionResult, options: z.infer<typeof SmartCompletionSchema>): string {
  let response = `### Completion Context\n\n`;
  response += `- **Current scope:** ${result.context.currentScope}\n`;
  response += `- **Available symbols:** ${result.context.availableSymbols.length}\n`;
  response += `- **Suggestions found:** ${result.suggestions.length}\n`;
  
  if (result.context.expectedType) {
    response += `- **Expected type:** ${result.context.expectedType}\n`;
  }
  
  if (result.context.inCallExpression) {
    response += `- **In call to:** ${result.context.inCallExpression.functionName} (parameter ${result.context.inCallExpression.parameterIndex})\n`;
  }
  
  response += `\n`;

  if (result.suggestions.length > 0) {
    response += `### Top Suggestions\n\n`;
    
    result.suggestions.slice(0, 8).forEach((suggestion, index) => {
      response += `${index + 1}. **${suggestion.label}** (${suggestion.kind})\n`;
      response += `   - Confidence: ${Math.round(suggestion.confidence * 100)}%\n`;
      response += `   - ${suggestion.documentation}\n`;
      
      if (suggestion.imports && suggestion.imports.length > 0) {
        const imp = suggestion.imports[0];
        response += `   - Requires import: \`${imp?.isDefault ? `import ${imp?.name}` : `import { ${imp?.name} }`} from '${imp?.module}'\`\n`;
      }
      
      response += `\n`;
    });
  }

  if (result.methodSignatures.length > 0) {
    response += `### Method Signatures\n\n`;
    
    result.methodSignatures.forEach(signature => {
      const params = signature.parameters
        .map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}${p.defaultValue ? ` = ${p.defaultValue}` : ''}`)
        .join(', ');
        
      response += `**${signature.name}**(${params}): ${signature.returnType}\n`;
      response += `${signature.documentation}\n\n`;
    });
  }

  if (result.typeInfo) {
    response += `### Type Information\n\n`;
    response += `- **Expected type:** ${result.typeInfo.expectedType}\n`;
    response += `- **Available types:** ${result.typeInfo.availableTypes.slice(0, 10).join(', ')}\n\n`;
  }

  response += `### Performance\n\n`;
  response += `- **Analysis time:** ${result.performance.analysisTime}ms\n`;
  response += `- **Suggestions generated:** ${result.performance.suggestionCount}\n`;
  response += `- **Cache hits:** ${result.performance.cacheHits}\n`;

  return response;
}