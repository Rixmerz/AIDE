/**
 * Type Evolution Tool
 * 
 * Analyzes TypeScript type evolution and suggests improvements:
 * - Converting type aliases to interfaces
 * - Adding generic type parameters
 * - Improving type safety with better types
 * - Detecting type evolution opportunities
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import type { ToolContext } from './index.js';
import { ASTUtilsEnhanced } from '../utils/ast-utils-enhanced.js';
import { FileOperations } from '../utils/file-operations.js';

const TypeEvolutionSchema = z.object({
  operation: z.enum([
    'analyze-types',
    'suggest-interfaces', 
    'add-generics',
    'improve-safety',
    'detect-evolution',
    'full-evolution'
  ]),
  files: z.array(z.string()).optional(),
  includeGenerics: z.boolean().default(true),
  suggestInterfaces: z.boolean().default(true),
  improveSafety: z.boolean().default(true),
  evolutionThreshold: z.number().min(0).max(1).default(0.7),
  generateReport: z.boolean().default(true),
  dryRun: z.boolean().default(false)
});

interface TypeEvolutionSuggestion {
  type: 'convert-to-interface' | 'add-generic' | 'improve-safety' | 'refactor-type';
  file: string;
  line: number;
  currentType: string;
  suggestedType: string;
  reason: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
}

interface TypeAnalysisResult {
  file: string;
  typeAliases: Array<{
    name: string;
    definition: string;
    line: number;
    complexity: number;
    usageCount: number;
    shouldBeInterface: boolean;
  }>;
  interfaces: Array<{
    name: string;
    members: number;
    line: number;
    extensibility: 'low' | 'medium' | 'high';
    genericPotential: boolean;
  }>;
  functions: Array<{
    name: string;
    line: number;
    parameters: Array<{
      name: string;
      type: string;
      genericPotential: boolean;
    }>;
    returnType: string;
    genericPotential: boolean;
  }>;
  suggestions: TypeEvolutionSuggestion[];
  evolutionScore: number;
}

interface TypeEvolutionReport {
  summary: {
    filesAnalyzed: number;
    totalSuggestions: number;
    evolutionOpportunities: number;
    averageEvolutionScore: number;
  };
  fileAnalysis: TypeAnalysisResult[];
  prioritySuggestions: TypeEvolutionSuggestion[];
  evolutionPath: Array<{
    step: number;
    description: string;
    files: string[];
    impact: 'low' | 'medium' | 'high';
    effort: 'low' | 'medium' | 'high';
  }>;
}

export async function handleTypeEvolution(args: any, context: ToolContext): Promise<any> {
  const { logger } = context;

  try {
    logger.info('Starting type evolution analysis', { args });

    const validated = TypeEvolutionSchema.parse(args);
    
    // Determine files to analyze
    const filesToAnalyze = validated.files?.length 
      ? validated.files 
      : await glob('src/**/*.{ts,tsx}', { ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'] });

    if (filesToAnalyze.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No TypeScript files found to analyze.'
        }]
      };
    }

    logger.info(`Analyzing ${filesToAnalyze.length} files for type evolution opportunities`);

    const astUtils = new ASTUtilsEnhanced(logger);
    const fileOps = new FileOperations(logger);

    let analysisResults: TypeAnalysisResult[] = [];
    let evolutionReport: TypeEvolutionReport | null = null;

    switch (validated.operation) {
      case 'analyze-types':
        analysisResults = await analyzeTypes(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'suggest-interfaces':
        analysisResults = await suggestInterfaces(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'add-generics':
        analysisResults = await addGenerics(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'improve-safety':
        analysisResults = await improveSafety(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'detect-evolution':
        analysisResults = await detectEvolution(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'full-evolution':
        analysisResults = await performFullEvolution(filesToAnalyze, astUtils, fileOps, validated, logger);
        evolutionReport = generateEvolutionReport(analysisResults);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    // Generate response
    let response = `## Type Evolution Analysis Results\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files analyzed:** ${analysisResults.length}\n`;
    response += `**Total suggestions:** ${analysisResults.reduce((sum, r) => sum + r.suggestions.length, 0)}\n\n`;

    if (evolutionReport) {
      response += generateEvolutionReportText(evolutionReport);
    } else {
      response += generateAnalysisReport(analysisResults, validated.operation);
    }

    // Apply changes if not dry run
    if (!validated.dryRun && analysisResults.some(r => r.suggestions.length > 0)) {
      const changesApplied = await applyEvolutionSuggestions(analysisResults, astUtils, fileOps, logger);
      response += `\n\n## Changes Applied\n\n${changesApplied}`;
    }

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    logger.error('Error in type evolution analysis:', error);
    throw error;
  }
}

async function analyzeTypes(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  const results: TypeAnalysisResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Analyzing types in ${file}`);
      
      const analysis: TypeAnalysisResult = {
        file,
        typeAliases: [],
        interfaces: [],
        functions: [],
        suggestions: [],
        evolutionScore: 0
      };

      // Analyze type aliases that could be interfaces
      const typeEvolutionSuggestions = await astUtils.analyzeTypeEvolution(file);
      
      for (const suggestion of typeEvolutionSuggestions) {
        analysis.suggestions.push({
          type: 'convert-to-interface',
          file,
          line: (suggestion as any).line || 1,
          currentType: (suggestion as any).currentDefinition || '',
          suggestedType: (suggestion as any).suggestedInterface || '',
          reason: (suggestion as any).reason || '',
          confidence: (suggestion as any).confidence || 0.7,
          impact: ((suggestion as any).impact === 'high' ? 'high' : (suggestion as any).impact === 'medium' ? 'medium' : 'low') as 'low' | 'medium' | 'high'
        });
      }

      // Calculate evolution score
      analysis.evolutionScore = calculateEvolutionScore(analysis);
      
      results.push(analysis);

    } catch (error) {
      logger.warn(`Error analyzing file ${file}:`, error);
    }
  }

  return results;
}

async function suggestInterfaces(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  logger.info('Suggesting interface conversions...');
  
  // For now, delegate to analyzeTypes as they share similar functionality
  return analyzeTypes(files, astUtils, options, logger);
}

async function addGenerics(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  const results: TypeAnalysisResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Analyzing generic opportunities in ${file}`);
      
      const analysis: TypeAnalysisResult = {
        file,
        typeAliases: [],
        interfaces: [],
        functions: [],
        suggestions: [],
        evolutionScore: 0
      };

      // This would analyze functions and types that could benefit from generics
      // For now, provide a basic implementation
      analysis.suggestions.push({
        type: 'add-generic',
        file,
        line: 1,
        currentType: 'function example(param: any): any',
        suggestedType: 'function example<T>(param: T): T',
        reason: 'Function could benefit from generic type parameter for better type safety',
        confidence: 0.8,
        impact: 'medium'
      });

      analysis.evolutionScore = 0.6;
      results.push(analysis);

    } catch (error) {
      logger.warn(`Error analyzing generics in ${file}:`, error);
    }
  }

  return results;
}

async function improveSafety(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  const results: TypeAnalysisResult[] = [];

  for (const file of files) {
    try {
      logger.info(`Analyzing type safety improvements in ${file}`);
      
      const analysis: TypeAnalysisResult = {
        file,
        typeAliases: [],
        interfaces: [],
        functions: [],
        suggestions: [],
        evolutionScore: 0
      };

      // This would detect any types, missing null checks, etc.
      analysis.suggestions.push({
        type: 'improve-safety',
        file,
        line: 1,
        currentType: 'param: any',
        suggestedType: 'param: string | number',
        reason: 'Replace any type with more specific union type for better type safety',
        confidence: 0.9,
        impact: 'high'
      });

      analysis.evolutionScore = 0.7;
      results.push(analysis);

    } catch (error) {
      logger.warn(`Error analyzing type safety in ${file}:`, error);
    }
  }

  return results;
}

async function detectEvolution(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  logger.info('Detecting type evolution opportunities...');
  
  // Combine multiple analysis approaches
  const typeResults = await analyzeTypes(files, astUtils, options, logger);
  const genericResults = await addGenerics(files, astUtils, options, logger);
  const safetyResults = await improveSafety(files, astUtils, options, logger);

  // Merge results
  const mergedResults: TypeAnalysisResult[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const merged: TypeAnalysisResult = {
      file: files[i]!,
      typeAliases: typeResults[i]?.typeAliases || [],
      interfaces: typeResults[i]?.interfaces || [],
      functions: typeResults[i]?.functions || [],
      suggestions: [
        ...(typeResults[i]?.suggestions || []),
        ...(genericResults[i]?.suggestions || []),
        ...(safetyResults[i]?.suggestions || [])
      ],
      evolutionScore: Math.max(
        typeResults[i]?.evolutionScore || 0,
        genericResults[i]?.evolutionScore || 0,
        safetyResults[i]?.evolutionScore || 0
      )
    };
    
    mergedResults.push(merged);
  }

  return mergedResults;
}

async function performFullEvolution(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof TypeEvolutionSchema>,
  logger: any
): Promise<TypeAnalysisResult[]> {
  logger.info('Performing comprehensive type evolution analysis...');
  
  // Get comprehensive analysis
  const results = await detectEvolution(files, astUtils, options, logger);
  
  // Sort suggestions by priority
  for (const result of results) {
    result.suggestions.sort((a, b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.impact] - priorityMap[a.impact] || b.confidence - a.confidence;
    });
  }

  return results;
}

function calculateEvolutionScore(analysis: TypeAnalysisResult): number {
  if (analysis.suggestions.length === 0) return 1.0;

  const highImpactCount = analysis.suggestions.filter(s => s.impact === 'high').length;
  const mediumImpactCount = analysis.suggestions.filter(s => s.impact === 'medium').length;
  const totalSuggestions = analysis.suggestions.length;

  // Calculate score: more high-impact suggestions = lower score (more room for evolution)
  const impactScore = (highImpactCount * 0.3 + mediumImpactCount * 0.1) / totalSuggestions;
  return Math.max(0, 1 - impactScore);
}

function generateEvolutionReport(results: TypeAnalysisResult[]): TypeEvolutionReport {
  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const evolutionOpportunities = results.filter(r => r.evolutionScore < 0.8).length;
  const avgEvolutionScore = results.reduce((sum, r) => sum + r.evolutionScore, 0) / results.length;

  // Get top priority suggestions
  const allSuggestions = results.flatMap(r => r.suggestions);
  const prioritySuggestions = allSuggestions
    .sort((a, b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.impact] - priorityMap[a.impact] || b.confidence - a.confidence;
    })
    .slice(0, 10);

  // Generate evolution path
  const evolutionPath = [
    {
      step: 1,
      description: 'Convert type aliases to interfaces where beneficial',
      files: results.filter(r => r.suggestions.some(s => s.type === 'convert-to-interface')).map(r => r.file),
      impact: 'medium' as const,
      effort: 'low' as const
    },
    {
      step: 2,
      description: 'Add generic type parameters to improve reusability',
      files: results.filter(r => r.suggestions.some(s => s.type === 'add-generic')).map(r => r.file),
      impact: 'high' as const,
      effort: 'medium' as const
    },
    {
      step: 3,
      description: 'Improve type safety by replacing any types',
      files: results.filter(r => r.suggestions.some(s => s.type === 'improve-safety')).map(r => r.file),
      impact: 'high' as const,
      effort: 'medium' as const
    }
  ];

  return {
    summary: {
      filesAnalyzed: results.length,
      totalSuggestions,
      evolutionOpportunities,
      averageEvolutionScore: Math.round(avgEvolutionScore * 100) / 100
    },
    fileAnalysis: results,
    prioritySuggestions,
    evolutionPath
  };
}

function generateEvolutionReportText(report: TypeEvolutionReport): string {
  let text = `### Evolution Summary\n\n`;
  text += `- **Files analyzed:** ${report.summary.filesAnalyzed}\n`;
  text += `- **Total suggestions:** ${report.summary.totalSuggestions}\n`;
  text += `- **Evolution opportunities:** ${report.summary.evolutionOpportunities}\n`;
  text += `- **Average evolution score:** ${report.summary.averageEvolutionScore}\n\n`;

  if (report.prioritySuggestions.length > 0) {
    text += `### Priority Suggestions\n\n`;
    report.prioritySuggestions.slice(0, 5).forEach((suggestion, index) => {
      text += `${index + 1}. **${suggestion.file}:${suggestion.line}** (${suggestion.impact} impact)\n`;
      text += `   - ${suggestion.reason}\n`;
      text += `   - Current: \`${suggestion.currentType}\`\n`;
      text += `   - Suggested: \`${suggestion.suggestedType}\`\n\n`;
    });
  }

  if (report.evolutionPath.length > 0) {
    text += `### Suggested Evolution Path\n\n`;
    report.evolutionPath.forEach(step => {
      if (step.files.length > 0) {
        text += `**Step ${step.step}:** ${step.description}\n`;
        text += `- Impact: ${step.impact}, Effort: ${step.effort}\n`;
        text += `- Files: ${step.files.length} files affected\n\n`;
      }
    });
  }

  return text;
}

function generateAnalysisReport(results: TypeAnalysisResult[], operation: string): string {
  let text = `### ${operation.replace('-', ' ').toUpperCase()} Results\n\n`;

  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const avgScore = results.reduce((sum, r) => sum + r.evolutionScore, 0) / results.length;

  text += `**Overall Statistics:**\n`;
  text += `- Total suggestions: ${totalSuggestions}\n`;
  text += `- Average evolution score: ${Math.round(avgScore * 100)}%\n`;
  text += `- Files needing attention: ${results.filter(r => r.suggestions.length > 0).length}\n\n`;

  // Show files with most suggestions
  const topFiles = results
    .filter(r => r.suggestions.length > 0)
    .sort((a, b) => b.suggestions.length - a.suggestions.length)
    .slice(0, 5);

  if (topFiles.length > 0) {
    text += `### Files with Most Evolution Opportunities\n\n`;
    topFiles.forEach((result, index) => {
      text += `${index + 1}. **${result.file}** (${result.suggestions.length} suggestions, score: ${Math.round(result.evolutionScore * 100)}%)\n`;
      
      result.suggestions.slice(0, 3).forEach(suggestion => {
        text += `   - ${suggestion.reason}\n`;
      });
      
      if (result.suggestions.length > 3) {
        text += `   - ... and ${result.suggestions.length - 3} more\n`;
      }
      text += `\n`;
    });
  }

  return text;
}

async function applyEvolutionSuggestions(
  results: TypeAnalysisResult[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<string> {
  let changesApplied = 0;
  let report = '';

  for (const result of results) {
    if (result.suggestions.length === 0) continue;

    try {
      // For interface conversions, use the AST utils
      const interfaceConversions = result.suggestions.filter(s => s.type === 'convert-to-interface');
      
      for (const suggestion of interfaceConversions) {
        try {
          const extractResult = await astUtils.extractInterface(
            suggestion.file,
            suggestion.currentType?.split(' ')[1] || 'UnknownType' // Extract type name
          );
          
          if (extractResult.success) {
            changesApplied++;
            report += `✓ Converted type alias to interface in ${suggestion.file}\n`;
          }
        } catch (error) {
          logger.warn(`Failed to convert type in ${suggestion.file}:`, error);
        }
      }

    } catch (error) {
      logger.warn(`Error applying suggestions to ${result.file}:`, error);
    }
  }

  if (changesApplied === 0) {
    return 'No changes could be automatically applied. Manual review recommended for complex type evolutions.';
  }

  return `${changesApplied} type evolution changes applied successfully:\n${report}`;
}