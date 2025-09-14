/**
 * Code Modernizer Tool
 * 
 * Helps modernize JavaScript/TypeScript code with:
 * - ES6+ features (arrow functions, destructuring, template literals)
 * - async/await conversion from callbacks/promises
 * - Modern JavaScript patterns and best practices
 * - Class syntax updates
 * - Import/export modernization
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import type { ToolContext } from './index.js';
import { ASTUtilsEnhanced } from '../utils/ast-utils-enhanced.js';
import { FileOperations } from '../utils/file-operations.js';

const CodeModernizerSchema = z.object({
  operation: z.enum([
    'es6-features',
    'async-await',
    'arrow-functions', 
    'destructuring',
    'template-literals',
    'class-syntax',
    'import-export',
    'full-modernization'
  ]),
  files: z.array(z.string()).optional(),
  includeArrowFunctions: z.boolean().default(true),
  includeDestructuring: z.boolean().default(true),
  includeTemplateLiterals: z.boolean().default(true),
  includeAsyncAwait: z.boolean().default(true),
  includeClassSyntax: z.boolean().default(true),
  modernizeImports: z.boolean().default(true),
  aggressiveMode: z.boolean().default(false),
  preserveComments: z.boolean().default(true),
  generateReport: z.boolean().default(true),
  dryRun: z.boolean().default(false)
});

interface ModernizationSuggestion {
  type: 'arrow-function' | 'destructuring' | 'template-literal' | 'async-await' | 'class-syntax' | 'import-export';
  file: string;
  line: number;
  column: number;
  oldCode: string;
  newCode: string;
  description: string;
  confidence: number;
  savings: {
    lines: number;
    characters: number;
    readability: 'improved' | 'same' | 'complex';
  };
  impact: 'low' | 'medium' | 'high';
}

interface ModernizationResult {
  file: string;
  originalSize: number;
  modernizedSize: number;
  suggestions: ModernizationSuggestion[];
  modernizationScore: number;
  appliedChanges: ModernizationSuggestion[];
  errors: Array<{
    line: number;
    message: string;
    severity: 'warning' | 'error';
  }>;
}

interface ModernizationReport {
  summary: {
    filesProcessed: number;
    totalSuggestions: number;
    changesApplied: number;
    linesReduced: number;
    charactersReduced: number;
    averageModernizationScore: number;
  };
  fileResults: ModernizationResult[];
  topImprovements: ModernizationSuggestion[];
  modernizationMetrics: {
    arrowFunctions: number;
    destructuring: number;
    templateLiterals: number;
    asyncAwait: number;
    classSyntax: number;
    importExport: number;
  };
}

export async function handleCodeModernizer(args: any, context: ToolContext): Promise<any> {
  const { logger } = context;

  try {
    logger.info('Starting code modernization analysis', { args });

    const validated = CodeModernizerSchema.parse(args);
    
    // Determine files to analyze
    const filesToAnalyze = validated.files?.length 
      ? validated.files 
      : await glob('src/**/*.{js,ts,jsx,tsx}', { ignore: ['**/*.d.ts', '**/*.test.{js,ts}', '**/*.spec.{js,ts}'] });

    if (filesToAnalyze.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No JavaScript/TypeScript files found to modernize.'
        }]
      };
    }

    logger.info(`Modernizing ${filesToAnalyze.length} files`);

    const astUtils = new ASTUtilsEnhanced(logger);
    const fileOps = new FileOperations(logger);

    let modernizationResults: ModernizationResult[] = [];
    let modernizationReport: ModernizationReport | null = null;

    switch (validated.operation) {
      case 'es6-features':
        modernizationResults = await modernizeES6Features(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'async-await':
        modernizationResults = await modernizeAsyncAwait(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'arrow-functions':
        modernizationResults = await modernizeArrowFunctions(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'destructuring':
        modernizationResults = await modernizeDestructuring(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'template-literals':
        modernizationResults = await modernizeTemplateLiterals(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'class-syntax':
        modernizationResults = await modernizeClassSyntax(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'import-export':
        modernizationResults = await modernizeImportExport(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'full-modernization':
        modernizationResults = await performFullModernization(filesToAnalyze, astUtils, fileOps, validated, logger);
        modernizationReport = generateModernizationReport(modernizationResults);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    // Generate response
    let response = `## Code Modernization Results\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files processed:** ${modernizationResults.length}\n`;
    response += `**Total suggestions:** ${modernizationResults.reduce((sum, r) => sum + r.suggestions.length, 0)}\n\n`;

    if (modernizationReport) {
      response += generateModernizationReportText(modernizationReport);
    } else {
      response += generateModernizationSummary(modernizationResults, validated.operation);
    }

    // Apply changes if not dry run
    if (!validated.dryRun && modernizationResults.some(r => r.suggestions.length > 0)) {
      const changesApplied = await applyModernizations(modernizationResults, astUtils, fileOps, validated, logger);
      response += `\n\n## Changes Applied\n\n${changesApplied}`;
    }

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    logger.error('Error in code modernization:', error);
    throw error;
  }
}

async function modernizeES6Features(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Modernizing ES6 features in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      // Analyze for various ES6 modernization opportunities
      await analyzeForArrowFunctions(file, content, result, options);
      await analyzeForDestructuring(file, content, result, options);
      await analyzeForTemplateLiterals(file, content, result, options);

      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error modernizing ${file}:`, error);
    }
  }

  return results;
}

async function modernizeAsyncAwait(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Converting to async/await in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      // Analyze for async/await opportunities
      const asyncOpportunities = await astUtils.detectAsyncOpportunities(file);
      
      for (const opportunity of asyncOpportunities) {
        result.suggestions.push({
          type: 'async-await',
          file,
          line: opportunity.line!,
          column: 0,
          oldCode: opportunity.suggestion || 'async/await pattern',
          newCode: opportunity.suggestion || 'async/await pattern',
          description: opportunity.suggestion || 'Convert to async/await pattern',
          confidence: opportunity.confidence,
          savings: {
            lines: 1,
            characters: 0,
            readability: 'improved'
          },
          impact: 'medium'
        });
      }

      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error analyzing async/await opportunities in ${file}:`, error);
    }
  }

  return results;
}

async function modernizeArrowFunctions(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Converting to arrow functions in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      await analyzeForArrowFunctions(file, content, result, options);
      
      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error converting to arrow functions in ${file}:`, error);
    }
  }

  return results;
}

async function modernizeDestructuring(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Adding destructuring patterns in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      await analyzeForDestructuring(file, content, result, options);
      
      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error adding destructuring in ${file}:`, error);
    }
  }

  return results;
}

async function modernizeTemplateLiterals(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Converting to template literals in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      await analyzeForTemplateLiterals(file, content, result, options);
      
      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error converting to template literals in ${file}:`, error);
    }
  }

  return results;
}

async function modernizeClassSyntax(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Modernizing class syntax in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      // Look for constructor function patterns that could be classes
      const classOpportunities = findClassOpportunities(content);
      
      for (const opportunity of classOpportunities) {
        result.suggestions.push({
          type: 'class-syntax',
          file,
          line: opportunity.line!,
          column: 0,
          oldCode: opportunity.constructorPattern,
          newCode: opportunity.classPattern,
          description: 'Convert constructor function to ES6 class syntax',
          confidence: 0.8,
          savings: {
            lines: 0,
            characters: opportunity.constructorPattern.length - opportunity.classPattern.length,
            readability: 'improved'
          },
          impact: 'medium'
        });
      }
      
      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error modernizing class syntax in ${file}:`, error);
    }
  }

  return results;
}

async function modernizeImportExport(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  const results: ModernizationResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Modernizing imports/exports in ${file}`);
      
      const content = await readFile(file, 'utf-8');
      const result: ModernizationResult = {
        file,
        originalSize: content.length,
        modernizedSize: content.length,
        suggestions: [],
        modernizationScore: 0,
        appliedChanges: [],
        errors: []
      };

      // Look for require/module.exports patterns
      const importExportOpportunities = findImportExportOpportunities(content);
      
      for (const opportunity of importExportOpportunities) {
        result.suggestions.push({
          type: 'import-export',
          file,
          line: opportunity.line!,
          column: 0,
          oldCode: opportunity.oldPattern,
          newCode: opportunity.newPattern,
          description: opportunity.description,
          confidence: 0.9,
          savings: {
            lines: 0,
            characters: opportunity.oldPattern.length - opportunity.newPattern.length,
            readability: 'improved'
          },
          impact: 'medium'
        });
      }
      
      result.modernizationScore = calculateModernizationScore(result);
      results.push(result);

    } catch (error) {
      logger.warn(`Error modernizing imports/exports in ${file}:`, error);
    }
  }

  return results;
}

async function performFullModernization(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<ModernizationResult[]> {
  logger.info('Performing comprehensive code modernization...');
  
  // Run all modernization techniques
  const es6Results = await modernizeES6Features(files, astUtils, options, logger);
  const asyncResults = await modernizeAsyncAwait(files, astUtils, options, logger);
  const classResults = await modernizeClassSyntax(files, astUtils, options, logger);
  const importResults = await modernizeImportExport(files, astUtils, options, logger);

  // Merge results
  const mergedResults: ModernizationResult[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const merged: ModernizationResult = {
      file: files[i]!,
      originalSize: es6Results[i]?.originalSize || 0,
      modernizedSize: es6Results[i]?.originalSize || 0,
      suggestions: [
        ...(es6Results[i]?.suggestions || []),
        ...(asyncResults[i]?.suggestions || []),
        ...(classResults[i]?.suggestions || []),
        ...(importResults[i]?.suggestions || [])
      ],
      modernizationScore: 0,
      appliedChanges: [],
      errors: []
    };
    
    merged.modernizationScore = calculateModernizationScore(merged);
    mergedResults.push(merged);
  }

  return mergedResults;
}

// Helper analysis functions
async function analyzeForArrowFunctions(
  file: string,
  content: string,
  result: ModernizationResult,
  options: z.infer<typeof CodeModernizerSchema>
): Promise<void> {
  if (!options.includeArrowFunctions) return;

  // Simple regex-based detection for demonstration
  const functionRegex = /function\s*\(([^)]*)\)\s*\{([^}]*)\}/g;
  let match;
  let lineNumber = 1;

  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const functionMatch = line?.match(/function\s*\(([^)]*)\)/);

    if (functionMatch && !line?.includes('function name') && (line?.length ?? 0) < 100) {
      const params = functionMatch[1] || '';
      const arrowEquivalent = params 
        ? `(${params}) => {` 
        : '() => {';
        
      result.suggestions.push({
        type: 'arrow-function',
        file,
        line: i + 1,
        column: 0,
        oldCode: functionMatch[0] + ' {',
        newCode: arrowEquivalent,
        description: 'Convert function expression to arrow function for more concise syntax',
        confidence: 0.8,
        savings: {
          lines: 0,
          characters: functionMatch[0].length - arrowEquivalent.length + 1,
          readability: 'improved'
        },
        impact: 'low'
      });
    }
  }
}

async function analyzeForDestructuring(
  file: string,
  content: string,
  result: ModernizationResult,
  options: z.infer<typeof CodeModernizerSchema>
): Promise<void> {
  if (!options.includeDestructuring) return;

  // Look for property access patterns that could be destructured
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Simple pattern: const x = obj.x; const y = obj.y;
    const propAccessMatch = line!.match(/const\s+(\w+)\s*=\s*(\w+)\.(\w+);?/);
    if (propAccessMatch) {
      const [, varName, objName, propName] = propAccessMatch;
      
      // Check if next lines have similar pattern
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextMatch = nextLine!.match(/const\s+(\w+)\s*=\s*(\w+)\.(\w+);?/);
        
        if (nextMatch && nextMatch[2] === objName) {
          const destructuredVersion = `const { ${propName}, ${nextMatch[3]} } = ${objName};`;
          
          result.suggestions.push({
            type: 'destructuring',
            file,
            line: i + 1,
            column: 0,
            oldCode: `${line!}\n${nextLine!}`,
            newCode: destructuredVersion,
            description: 'Use destructuring assignment for cleaner property extraction',
            confidence: 0.9,
            savings: {
              lines: 1,
              characters: line!.length + nextLine!.length - destructuredVersion.length,
              readability: 'improved'
            },
            impact: 'medium'
          });
        }
      }
    }
  }
}

async function analyzeForTemplateLiterals(
  file: string,
  content: string,
  result: ModernizationResult,
  options: z.infer<typeof CodeModernizerSchema>
): Promise<void> {
  if (!options.includeTemplateLiterals) return;

  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for string concatenation patterns
    const concatMatch = line!.match(/"([^"]*)"?\s*\+\s*(\w+)\s*\+\s*"([^"]*)"/);
    if (concatMatch) {
      const [, prefix, variable, suffix] = concatMatch;
      const templateLiteral = `\`${prefix}$\{${variable}\}${suffix}\``;
      
      result.suggestions.push({
        type: 'template-literal',
        file,
        line: i + 1,
        column: 0,
        oldCode: concatMatch[0],
        newCode: templateLiteral,
        description: 'Use template literal for cleaner string interpolation',
        confidence: 0.9,
        savings: {
          lines: 0,
          characters: concatMatch[0].length - templateLiteral.length,
          readability: 'improved'
        },
        impact: 'low'
      });
    }
  }
}

function findClassOpportunities(content: string): Array<{line: number, constructorPattern: string, classPattern: string}> {
  const opportunities = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for constructor function patterns
    const constructorMatch = line?.match(/function\s+(\w+)\s*\(([^)]*)\)\s*\{/);
    if (constructorMatch) {
      const [, className, params] = constructorMatch || [];
      if (!className) continue;
      
      // Look for prototype assignments in following lines
      let prototypeFound = false;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j]?.includes(`${className}.prototype.`)) {
          prototypeFound = true;
          break;
        }
      }
      
      if (prototypeFound) {
        const classPattern = `class ${className} {\n  constructor(${params}) {`;
        
        opportunities.push({
          line: i + 1,
          constructorPattern: line! || '',
          classPattern
        });
      }
    }
  }
  
  return opportunities;
}

function findImportExportOpportunities(content: string): Array<{
  line: number,
  oldPattern: string,
  newPattern: string,
  description: string
}> {
  const opportunities = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Convert require statements
    const requireMatch = line!.match(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/);
    if (requireMatch) {
      const [, varName, modulePath] = requireMatch;
      const importStatement = `import ${varName} from '${modulePath}';`;
      
      opportunities.push({
        line: i + 1,
        oldPattern: line!.trim(),
        newPattern: importStatement,
        description: 'Convert require() to ES6 import statement'
      });
    }
    
    // Convert module.exports
    const exportsMatch = line!.match(/module\.exports\s*=\s*(\w+);?/);
    if (exportsMatch) {
      const [, varName] = exportsMatch;
      const exportStatement = `export default ${varName};`;
      
      opportunities.push({
        line: i + 1,
        oldPattern: line!.trim(),
        newPattern: exportStatement,
        description: 'Convert module.exports to ES6 export statement'
      });
    }
  }
  
  return opportunities;
}

function calculateModernizationScore(result: ModernizationResult): number {
  if (result.suggestions.length === 0) return 1.0;

  // Calculate based on impact and confidence
  const totalImpact = result.suggestions.reduce((sum, s) => {
    const impactScore = s.impact === 'high' ? 3 : s.impact === 'medium' ? 2 : 1;
    return sum + (impactScore * s.confidence);
  }, 0);

  const maxPossibleImpact = result.suggestions.length * 3; // Max impact * max confidence
  return Math.max(0, 1 - (totalImpact / maxPossibleImpact));
}

function generateModernizationReport(results: ModernizationResult[]): ModernizationReport {
  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const changesApplied = results.reduce((sum, r) => sum + r.appliedChanges.length, 0);
  const linesReduced = results.reduce((sum, r) => sum + r.suggestions.reduce((s, suggestion) => s + suggestion.savings.lines, 0), 0);
  const charactersReduced = results.reduce((sum, r) => sum + r.suggestions.reduce((s, suggestion) => s + suggestion.savings.characters, 0), 0);
  const avgScore = results.reduce((sum, r) => sum + r.modernizationScore, 0) / results.length;

  // Get top improvements
  const allSuggestions = results.flatMap(r => r.suggestions);
  const topImprovements = allSuggestions
    .sort((a, b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.impact] - priorityMap[a.impact] || b.confidence - a.confidence;
    })
    .slice(0, 10);

  // Calculate metrics by type
  const modernizationMetrics = {
    arrowFunctions: allSuggestions.filter(s => s.type === 'arrow-function').length,
    destructuring: allSuggestions.filter(s => s.type === 'destructuring').length,
    templateLiterals: allSuggestions.filter(s => s.type === 'template-literal').length,
    asyncAwait: allSuggestions.filter(s => s.type === 'async-await').length,
    classSyntax: allSuggestions.filter(s => s.type === 'class-syntax').length,
    importExport: allSuggestions.filter(s => s.type === 'import-export').length,
  };

  return {
    summary: {
      filesProcessed: results.length,
      totalSuggestions,
      changesApplied,
      linesReduced,
      charactersReduced,
      averageModernizationScore: Math.round(avgScore * 100) / 100
    },
    fileResults: results,
    topImprovements,
    modernizationMetrics
  };
}

function generateModernizationReportText(report: ModernizationReport): string {
  let text = `### Modernization Summary\n\n`;
  text += `- **Files processed:** ${report.summary.filesProcessed}\n`;
  text += `- **Total suggestions:** ${report.summary.totalSuggestions}\n`;
  text += `- **Changes applied:** ${report.summary.changesApplied}\n`;
  text += `- **Lines reduced:** ${report.summary.linesReduced}\n`;
  text += `- **Characters saved:** ${report.summary.charactersReduced}\n`;
  text += `- **Average modernization score:** ${report.summary.averageModernizationScore}\n\n`;

  // Modernization metrics
  text += `### Modernization Breakdown\n\n`;
  text += `- **Arrow functions:** ${report.modernizationMetrics.arrowFunctions} opportunities\n`;
  text += `- **Destructuring:** ${report.modernizationMetrics.destructuring} opportunities\n`;
  text += `- **Template literals:** ${report.modernizationMetrics.templateLiterals} opportunities\n`;
  text += `- **Async/await:** ${report.modernizationMetrics.asyncAwait} opportunities\n`;
  text += `- **Class syntax:** ${report.modernizationMetrics.classSyntax} opportunities\n`;
  text += `- **Import/export:** ${report.modernizationMetrics.importExport} opportunities\n\n`;

  // Top improvements
  if (report.topImprovements.length > 0) {
    text += `### Top Modernization Opportunities\n\n`;
    report.topImprovements.slice(0, 5).forEach((improvement, index) => {
      text += `${index + 1}. **${improvement.file}:${improvement.line!}** - ${improvement.type}\n`;
      text += `   - ${improvement.description}\n`;
      text += `   - Impact: ${improvement.impact}, Confidence: ${Math.round(improvement.confidence * 100)}%\n`;
      text += `   - Before: \`${improvement.oldCode.substring(0, 50)}${improvement.oldCode.length > 50 ? '...' : ''}\`\n`;
      text += `   - After: \`${improvement.newCode.substring(0, 50)}${improvement.newCode.length > 50 ? '...' : ''}\`\n\n`;
    });
  }

  return text;
}

function generateModernizationSummary(results: ModernizationResult[], operation: string): string {
  let text = `### ${operation.replace('-', ' ').toUpperCase()} Results\n\n`;

  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const avgScore = results.reduce((sum, r) => sum + r.modernizationScore, 0) / results.length;

  text += `**Overall Statistics:**\n`;
  text += `- Total modernization opportunities: ${totalSuggestions}\n`;
  text += `- Average modernization score: ${Math.round(avgScore * 100)}%\n`;
  text += `- Files needing modernization: ${results.filter(r => r.suggestions.length > 0).length}\n\n`;

  // Show files with most opportunities
  const topFiles = results
    .filter(r => r.suggestions.length > 0)
    .sort((a, b) => b.suggestions.length - a.suggestions.length)
    .slice(0, 5);

  if (topFiles.length > 0) {
    text += `### Files with Most Modernization Opportunities\n\n`;
    topFiles.forEach((result, index) => {
      text += `${index + 1}. **${result.file}** (${result.suggestions.length} opportunities, score: ${Math.round(result.modernizationScore * 100)}%)\n`;
      
      result.suggestions.slice(0, 3).forEach(suggestion => {
        text += `   - ${suggestion.description}\n`;
      });
      
      if (result.suggestions.length > 3) {
        text += `   - ... and ${result.suggestions.length - 3} more\n`;
      }
      text += `\n`;
    });
  }

  return text;
}

async function applyModernizations(
  results: ModernizationResult[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof CodeModernizerSchema>,
  logger: any
): Promise<string> {
  let changesApplied = 0;
  let report = '';

  for (const result of results) {
    if (result.suggestions.length === 0) continue;

    try {
      const content = await readFile(result.file, 'utf-8');
      let updatedContent = content;

      // Apply high-confidence, low-risk changes first
      const safeChanges = result.suggestions
        .filter(s => s.confidence > 0.8 && s.impact !== 'high')
        .sort((a, b) => b.line! - a.line!); // Apply from bottom to top to preserve line! numbers

      for (const change of safeChanges) {
        try {
          // Simple string replacement for now
          if (updatedContent.includes(change.oldCode)) {
            updatedContent = updatedContent.replace(change.oldCode, change.newCode);
            result.appliedChanges.push(change);
            changesApplied++;
          }
        } catch (error) {
          logger.warn(`Failed to apply change in ${result.file}:`, error);
        }
      }

      // Write back if changes were made
      if (result.appliedChanges.length > 0) {
        await fileOps.writeFile(result.file, updatedContent);
        result.modernizedSize = updatedContent.length;
        report += `✓ Applied ${result.appliedChanges.length} modernizations to ${result.file}\n`;
      }

    } catch (error) {
      logger.warn(`Error applying modernizations to ${result.file}:`, error);
    }
  }

  if (changesApplied === 0) {
    return 'No changes could be automatically applied. Manual review recommended for complex modernizations.';
  }

  const totalSavings = results.reduce((sum, r) => sum + Math.max(0, r.originalSize - r.modernizedSize), 0);
  
  return `${changesApplied} modernization changes applied successfully:\n${report}\nTotal characters saved: ${totalSavings}`;
}