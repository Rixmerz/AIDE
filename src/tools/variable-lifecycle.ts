/**
 * Variable Lifecycle Tool for AIDE MCP Server
 * 
 * Advanced analysis and optimization of variable usage patterns, scope, and lifecycle
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { ASTUtilsEnhanced, type VariableUsagePattern } from '../utils/ast-utils-enhanced.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const VariableLifecycleSchema = z.object({
  operation: z.enum(['analyze-usage', 'optimize-declarations', 'fix-scope', 'detect-unused', 'suggest-immutable', 'full-optimization']),
  files: z.array(z.string()).optional(),
  filePattern: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  
  // Analysis options
  includeUnusedVars: z.boolean().optional().default(true),
  includeScopeOptimization: z.boolean().optional().default(true),
  includeImmutabilityCheck: z.boolean().optional().default(true),
  includeLifecycleAnalysis: z.boolean().optional().default(true),
  
  // Optimization options
  autoFix: z.boolean().optional().default(false),
  preferConst: z.boolean().optional().default(true),
  preferLet: z.boolean().optional().default(true),
  avoidVar: z.boolean().optional().default(true),
  
  // Processing options
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
  reportFormat: z.enum(['detailed', 'summary', 'json']).optional().default('detailed'),
});

interface VariableAnalysisResult {
  file: string;
  variables: VariableInfo[];
  issues: VariableIssue[];
  optimizations: VariableOptimization[];
  metrics: VariableMetrics;
}

interface VariableInfo {
  name: string;
  type: 'const' | 'let' | 'var';
  scope: 'block' | 'function' | 'module' | 'global';
  declarationLine: number;
  usageCount: number;
  reassignmentCount: number;
  firstUseLine: number;
  lastUseLine: number;
  usageSpan: number;
  isParameter: boolean;
  isImported: boolean;
  isExported: boolean;
  lifecycle: VariableLifecycle;
}

interface VariableLifecycle {
  phases: LifecyclePhase[];
  dominantPhase: 'declaration' | 'initialization' | 'usage' | 'modification' | 'disposal';
  complexity: 'simple' | 'moderate' | 'complex';
  riskLevel: 'low' | 'medium' | 'high';
}

interface LifecyclePhase {
  phase: 'declaration' | 'initialization' | 'usage' | 'modification' | 'disposal';
  line: number;
  context: string;
  impact: 'low' | 'medium' | 'high';
}

interface VariableIssue {
  type: 'unused-variable' | 'unnecessary-reassignment' | 'scope-too-wide' | 'premature-optimization' | 'immutability-violation' | 'shadowing' | 'temporal-dead-zone';
  variable: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
  autoFixable: boolean;
}

interface VariableOptimization {
  type: 'const-conversion' | 'let-conversion' | 'scope-reduction' | 'inline-variable' | 'extract-variable' | 'rename-variable';
  variable: string;
  fromType: string;
  toType: string;
  line: number;
  reason: string;
  impact: {
    readability: number;
    performance: number;
    maintainability: number;
  };
  autoApplicable: boolean;
}

interface VariableMetrics {
  totalVariables: number;
  byType: Record<'const' | 'let' | 'var', number>;
  byScope: Record<string, number>;
  unusedCount: number;
  reassignedCount: number;
  scopeIssuesCount: number;
  immutabilityViolations: number;
  averageUsageSpan: number;
  complexLifecycles: number;
}

interface ProjectVariableReport {
  summary: {
    totalFiles: number;
    totalVariables: number;
    issuesFound: number;
    optimizationsAvailable: number;
    qualityScore: number;
  };
  fileAnalysis: VariableAnalysisResult[];
  globalMetrics: VariableMetrics;
  recommendations: VariableRecommendation[];
}

interface VariableRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'scope' | 'immutability' | 'lifecycle' | 'performance' | 'readability';
  title: string;
  description: string;
  filesAffected: string[];
  estimatedImpact: string;
  effort: 'low' | 'medium' | 'high';
}

export async function handleVariableLifecycle(args: any, context: ToolContext) {
  const validated = VariableLifecycleSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting variable lifecycle analysis', {
      operation: validated.operation,
      filePattern: validated.filePattern,
      autoFix: validated.autoFix,
    });

    const fileOps = new FileOperations(logger);
    const astUtils = new ASTUtilsEnhanced(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    // Determine files to analyze
    let filesToAnalyze: string[];
    if (validated.files && validated.files.length > 0) {
      filesToAnalyze = validated.files;
    } else {
      filesToAnalyze = await fileOps.findFiles(validated.filePattern);
    }

    if (filesToAnalyze.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No files found to analyze for variable lifecycle.',
          },
        ],
      };
    }

    let response = `# Variable Lifecycle Analysis\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files analyzed:** ${filesToAnalyze.length}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : validated.autoFix ? 'AUTO-FIX' : 'ANALYSIS'}\n\n`;

    let analysisResults: VariableAnalysisResult[] = [];
    let projectReport: ProjectVariableReport | null = null;

    switch (validated.operation) {
      case 'analyze-usage':
        analysisResults = await performUsageAnalysis(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'optimize-declarations':
        analysisResults = await performDeclarationOptimization(filesToAnalyze, astUtils, fileOps, validated, logger);
        break;
      
      case 'fix-scope':
        analysisResults = await performScopeOptimization(filesToAnalyze, astUtils, fileOps, validated, logger);
        break;
      
      case 'detect-unused':
        analysisResults = await performUnusedDetection(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'suggest-immutable':
        analysisResults = await performImmutabilityAnalysis(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'full-optimization':
        analysisResults = await performFullOptimization(filesToAnalyze, astUtils, fileOps, validated, logger);
        projectReport = generateProjectReport(analysisResults);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    // Generate response based on analysis type
    if (validated.operation === 'full-optimization' && projectReport) {
      response += formatProjectReport(projectReport);
    } else {
      response += generateOperationReport(analysisResults, validated.operation, validated);
    }

    // Apply optimizations if autoFix is enabled and not dry run
    if (validated.autoFix && !validated.dryRun) {
      const optimizationResults = await applyOptimizations(analysisResults, fileOps, validated, logger);
      response += generateOptimizationReport(optimizationResults);
      
      // Record in history
      const historyId = await historyManager.recordOperation(
        'variable_lifecycle',
        `Variable Lifecycle: ${validated.operation}`,
        `Analyzed ${filesToAnalyze.length} files, applied ${optimizationResults.optimizationsApplied} optimizations`,
        optimizationResults.fileSnapshots,
        {
          operation: validated.operation,
          filesAnalyzed: filesToAnalyze.length,
          issuesFound: analysisResults.reduce((sum, r) => sum + r.issues.length, 0),
          optimizationsApplied: optimizationResults.optimizationsApplied,
        }
      );
      
      response += `\n**Operation ID:** ${historyId}\n`;
    } else {
      // Record analysis only
      const historyId = await historyManager.recordOperation(
        'variable_lifecycle',
        `Variable Lifecycle Analysis: ${validated.operation}`,
        `Analyzed ${filesToAnalyze.length} files for variable usage patterns`,
        [],
        {
          operation: validated.operation,
          filesAnalyzed: filesToAnalyze.length,
          issuesFound: analysisResults.reduce((sum, r) => sum + r.issues.length, 0),
          analysisOnly: true,
        }
      );
      
      response += `\n**Analysis ID:** ${historyId}\n`;
    }

    // Cleanup
    astUtils.dispose();

    logger.info('Variable lifecycle analysis completed', {
      filesAnalyzed: filesToAnalyze.length,
      issuesFound: analysisResults.reduce((sum, r) => sum + r.issues.length, 0),
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
    logger.error('Error in variable_lifecycle tool:', error);
    throw error;
  }
}

async function performUsageAnalysis(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  const results: VariableAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      const usagePatterns = await astUtils.analyzeVariableUsage(file);
      const variables = usagePatterns.map(pattern => convertPatternToInfo(pattern, file));
      const issues = analyzeVariableIssues(variables, options);
      const optimizations = generateOptimizations(variables, options);
      const metrics = calculateVariableMetrics(variables);

      results.push({
        file,
        variables,
        issues,
        optimizations,
        metrics
      });
    } catch (error) {
      logger.warn(`Error analyzing usage for ${file}:`, error);
    }
  }

  return results;
}

async function performDeclarationOptimization(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  const results = await performUsageAnalysis(files, astUtils, options, logger);
  
  // Focus on declaration-type optimizations
  results.forEach(result => {
    result.optimizations = result.optimizations.filter(opt => 
      opt.type === 'const-conversion' || opt.type === 'let-conversion'
    );
  });
  
  return results;
}

async function performScopeOptimization(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  const results = await performUsageAnalysis(files, astUtils, options, logger);
  
  // Focus on scope-related issues and optimizations
  results.forEach(result => {
    result.issues = result.issues.filter(issue => 
      issue.type === 'scope-too-wide' || issue.type === 'shadowing'
    );
    
    result.optimizations = result.optimizations.filter(opt => 
      opt.type === 'scope-reduction'
    );
  });
  
  return results;
}

async function performUnusedDetection(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  const results = await performUsageAnalysis(files, astUtils, options, logger);
  
  // Focus on unused variables
  results.forEach(result => {
    result.issues = result.issues.filter(issue => 
      issue.type === 'unused-variable'
    );
    
    result.variables = result.variables.filter(variable => 
      variable.usageCount === 0
    );
  });
  
  return results;
}

async function performImmutabilityAnalysis(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  const results = await performUsageAnalysis(files, astUtils, options, logger);
  
  // Focus on immutability opportunities
  results.forEach(result => {
    result.issues = result.issues.filter(issue => 
      issue.type === 'immutability-violation'
    );
    
    result.optimizations = result.optimizations.filter(opt => 
      opt.type === 'const-conversion'
    );
  });
  
  return results;
}

async function performFullOptimization(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<VariableAnalysisResult[]> {
  return performUsageAnalysis(files, astUtils, options, logger);
}

function convertPatternToInfo(pattern: VariableUsagePattern, file: string): VariableInfo {
  const lifecycle = analyzeVariableLifecycle(pattern);
  
  return {
    name: pattern.name,
    type: pattern.suggestedType as 'const' | 'let' | 'var',
    scope: pattern.scope,
    declarationLine: 1, // Would need actual AST analysis
    usageCount: pattern.declarations + pattern.reassignments,
    reassignmentCount: pattern.reassignments,
    firstUseLine: 1, // Would need actual AST analysis
    lastUseLine: pattern.usageSpan,
    usageSpan: pattern.usageSpan,
    isParameter: false, // Would need AST analysis
    isImported: false, // Would need AST analysis
    isExported: false, // Would need AST analysis
    lifecycle
  };
}

function analyzeVariableLifecycle(pattern: VariableUsagePattern): VariableLifecycle {
  const phases: LifecyclePhase[] = [
    {
      phase: 'declaration',
      line: 1,
      context: `Variable ${pattern.name} declared`,
      impact: 'low'
    }
  ];

  if (pattern.reassignments > 0) {
    phases.push({
      phase: 'modification',
      line: Math.floor(pattern.usageSpan / 2),
      context: `${pattern.reassignments} reassignments`,
      impact: pattern.reassignments > 3 ? 'high' : 'medium'
    });
  }

  const complexity = pattern.reassignments > 3 || pattern.usageSpan > 50 ? 'complex' :
                    pattern.reassignments > 1 || pattern.usageSpan > 20 ? 'moderate' : 'simple';
  
  const riskLevel = pattern.reassignments > 5 ? 'high' :
                   pattern.reassignments > 2 ? 'medium' : 'low';

  return {
    phases,
    dominantPhase: pattern.reassignments > pattern.declarations ? 'modification' : 'usage',
    complexity,
    riskLevel
  };
}

function analyzeVariableIssues(variables: VariableInfo[], options: z.infer<typeof VariableLifecycleSchema>): VariableIssue[] {
  const issues: VariableIssue[] = [];

  variables.forEach(variable => {
    // Unused variable detection
    if (variable.usageCount === 0) {
      issues.push({
        type: 'unused-variable',
        variable: variable.name,
        line: variable.declarationLine,
        severity: 'warning',
        message: `Variable '${variable.name}' is declared but never used`,
        suggestion: 'Remove this unused variable',
        autoFixable: true
      });
    }

    // Unnecessary reassignment
    if (variable.type === 'let' && variable.reassignmentCount === 0) {
      issues.push({
        type: 'unnecessary-reassignment',
        variable: variable.name,
        line: variable.declarationLine,
        severity: 'info',
        message: `Variable '${variable.name}' is declared as 'let' but never reassigned`,
        suggestion: 'Consider using const instead',
        autoFixable: true
      });
    }

    // Scope too wide
    if (variable.scope === 'function' && variable.usageSpan < 10) {
      issues.push({
        type: 'scope-too-wide',
        variable: variable.name,
        line: variable.declarationLine,
        severity: 'info',
        message: `Variable '${variable.name}' has wider scope than necessary`,
        suggestion: 'Consider reducing scope to block level',
        autoFixable: false
      });
    }

    // Immutability violations
    if (variable.type === 'var' && options.avoidVar) {
      issues.push({
        type: 'immutability-violation',
        variable: variable.name,
        line: variable.declarationLine,
        severity: 'warning',
        message: `Variable '${variable.name}' uses 'var' declaration`,
        suggestion: 'Use const or let instead of var',
        autoFixable: true
      });
    }
  });

  return issues;
}

function generateOptimizations(variables: VariableInfo[], options: z.infer<typeof VariableLifecycleSchema>): VariableOptimization[] {
  const optimizations: VariableOptimization[] = [];

  variables.forEach(variable => {
    // Const conversion
    if (variable.type === 'let' && variable.reassignmentCount === 0 && options.preferConst) {
      optimizations.push({
        type: 'const-conversion',
        variable: variable.name,
        fromType: 'let',
        toType: 'const',
        line: variable.declarationLine,
        reason: 'Variable is never reassigned',
        impact: {
          readability: 10,
          performance: 5,
          maintainability: 15
        },
        autoApplicable: true
      });
    }

    // Let conversion (from var)
    if (variable.type === 'var' && options.preferLet) {
      optimizations.push({
        type: 'let-conversion',
        variable: variable.name,
        fromType: 'var',
        toType: variable.reassignmentCount === 0 ? 'const' : 'let',
        line: variable.declarationLine,
        reason: 'Avoid var in favor of let/const',
        impact: {
          readability: 15,
          performance: 0,
          maintainability: 20
        },
        autoApplicable: true
      });
    }

    // Scope reduction
    if (variable.scope === 'function' && variable.usageSpan < 10) {
      optimizations.push({
        type: 'scope-reduction',
        variable: variable.name,
        fromType: variable.scope,
        toType: 'block',
        line: variable.declarationLine,
        reason: 'Variable usage is localized',
        impact: {
          readability: 10,
          performance: 0,
          maintainability: 15
        },
        autoApplicable: false
      });
    }
  });

  return optimizations;
}

function calculateVariableMetrics(variables: VariableInfo[]): VariableMetrics {
  const byType = variables.reduce((acc, v) => {
    acc[v.type]++;
    return acc;
  }, { const: 0, let: 0, var: 0 });

  const byScope = variables.reduce((acc, v) => {
    acc[v.scope] = (acc[v.scope] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const unusedCount = variables.filter(v => v.usageCount === 0).length;
  const reassignedCount = variables.filter(v => v.reassignmentCount > 0).length;
  const scopeIssuesCount = variables.filter(v => v.scope === 'function' && v.usageSpan < 10).length;
  const immutabilityViolations = variables.filter(v => v.type === 'var').length;
  const averageUsageSpan = variables.reduce((sum, v) => sum + v.usageSpan, 0) / variables.length;
  const complexLifecycles = variables.filter(v => v.lifecycle.complexity === 'complex').length;

  return {
    totalVariables: variables.length,
    byType,
    byScope,
    unusedCount,
    reassignedCount,
    scopeIssuesCount,
    immutabilityViolations,
    averageUsageSpan,
    complexLifecycles
  };
}

function generateProjectReport(results: VariableAnalysisResult[]): ProjectVariableReport {
  const totalFiles = results.length;
  const totalVariables = results.reduce((sum, r) => sum + r.metrics.totalVariables, 0);
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const totalOptimizations = results.reduce((sum, r) => sum + r.optimizations.length, 0);
  
  const qualityScore = Math.max(0, 100 - (totalIssues / totalVariables * 100));

  // Aggregate metrics
  const globalMetrics = results.reduce((acc, result) => {
    acc.totalVariables += result.metrics.totalVariables;
    acc.byType.const += result.metrics.byType.const;
    acc.byType.let += result.metrics.byType.let;
    acc.byType.var += result.metrics.byType.var;
    acc.unusedCount += result.metrics.unusedCount;
    acc.reassignedCount += result.metrics.reassignedCount;
    return acc;
  }, {
    totalVariables: 0,
    byType: { const: 0, let: 0, var: 0 },
    byScope: {} as Record<string, number>,
    unusedCount: 0,
    reassignedCount: 0,
    scopeIssuesCount: 0,
    immutabilityViolations: 0,
    averageUsageSpan: 0,
    complexLifecycles: 0
  });

  // Generate recommendations based on findings
  const recommendations: VariableRecommendation[] = [];
  
  if (globalMetrics.byType.var > 0) {
    recommendations.push({
      priority: 'high',
      category: 'immutability',
      title: 'Replace var declarations with const/let',
      description: `Found ${globalMetrics.byType.var} var declarations that should be replaced with const or let`,
      filesAffected: results.filter(r => r.metrics.byType.var > 0).map(r => r.file),
      estimatedImpact: 'Improves code safety and prevents hoisting issues',
      effort: 'low'
    });
  }

  if (globalMetrics.unusedCount > totalVariables * 0.1) {
    recommendations.push({
      priority: 'medium',
      category: 'lifecycle',
      title: 'Remove unused variables',
      description: `${globalMetrics.unusedCount} unused variables found`,
      filesAffected: results.filter(r => r.metrics.unusedCount > 0).map(r => r.file),
      estimatedImpact: 'Reduces bundle size and improves code readability',
      effort: 'low'
    });
  }

  return {
    summary: {
      totalFiles,
      totalVariables,
      issuesFound: totalIssues,
      optimizationsAvailable: totalOptimizations,
      qualityScore
    },
    fileAnalysis: results,
    globalMetrics,
    recommendations
  };
}

function generateOperationReport(results: VariableAnalysisResult[], operation: string, options: z.infer<typeof VariableLifecycleSchema>): string {
  let report = `## ${operation.replace('-', ' ').toUpperCase()} Results\n\n`;
  
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const totalOptimizations = results.reduce((sum, r) => sum + r.optimizations.length, 0);
  
  report += `**Issues found:** ${totalIssues}\n`;
  report += `**Optimizations available:** ${totalOptimizations}\n\n`;

  if (totalIssues > 0) {
    report += `### Files with Most Issues\n`;
    results
      .filter(r => r.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length)
      .slice(0, 5)
      .forEach(result => {
        report += `- **${result.file}**: ${result.issues.length} issues\n`;
      });
    report += '\n';
  }

  if (totalOptimizations > 0 && options.reportFormat === 'detailed') {
    report += `### Top Optimizations\n`;
    const allOptimizations = results.flatMap(r => r.optimizations.map(o => ({ ...o, file: r.file })));
    allOptimizations
      .sort((a, b) => (b.impact.readability + b.impact.maintainability) - (a.impact.readability + a.impact.maintainability))
      .slice(0, 10)
      .forEach(opt => {
        report += `- **${opt.file}**: ${opt.type} for '${opt.variable}' (${opt.reason})\n`;
      });
  }

  return report;
}



function formatProjectReport(report: ProjectVariableReport): string {
  let output = `## Project Variable Analysis Report\n\n`;
  
  // Summary section
  output += `### Summary\n`;
  output += `- **Total Files Analyzed:** ${report.summary.totalFiles}\n`;
  output += `- **Total Variables:** ${report.summary.totalVariables}\n`;
  output += `- **Issues Found:** ${report.summary.issuesFound}\n`;
  output += `- **Optimizations Available:** ${report.summary.optimizationsAvailable}\n`;
  output += `- **Quality Score:** ${report.summary.qualityScore}/100\n\n`;
  
  // Global metrics section with calculated percentages
  output += `### Global Metrics\n`;
  const constPercentage = report.globalMetrics.totalVariables > 0 ? 
    (report.globalMetrics.byType.const / report.globalMetrics.totalVariables * 100) : 0;
  const letPercentage = report.globalMetrics.totalVariables > 0 ? 
    (report.globalMetrics.byType.let / report.globalMetrics.totalVariables * 100) : 0;
  const varPercentage = report.globalMetrics.totalVariables > 0 ? 
    (report.globalMetrics.byType.var / report.globalMetrics.totalVariables * 100) : 0;
  
  output += `- **Const Usage:** ${constPercentage.toFixed(1)}% (${report.globalMetrics.byType.const} variables)\n`;
  output += `- **Let Usage:** ${letPercentage.toFixed(1)}% (${report.globalMetrics.byType.let} variables)\n`;
  output += `- **Var Usage:** ${varPercentage.toFixed(1)}% (${report.globalMetrics.byType.var} variables)\n`;
  output += `- **Unused Variables:** ${report.globalMetrics.unusedCount}\n`;
  output += `- **Average Usage Span:** ${report.globalMetrics.averageUsageSpan.toFixed(1)} lines\n`;
  output += `- **Reassigned Variables:** ${report.globalMetrics.reassignedCount}\n`;
  output += `- **Complex Lifecycles:** ${report.globalMetrics.complexLifecycles}\n\n`;
  
  // Top issues by file
  if (report.fileAnalysis.length > 0) {
    const filesWithIssues = report.fileAnalysis
      .filter(file => file.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length)
      .slice(0, 10);
    
    if (filesWithIssues.length > 0) {
      output += `### Files with Most Issues\n`;
      filesWithIssues.forEach(file => {
        output += `- **${file.file}**: ${file.issues.length} issues\n`;
        file.issues.slice(0, 3).forEach(issue => {
          output += `  - ${issue.type}: ${issue.variable} (${issue.message})\n`;
        });
        if (file.issues.length > 3) {
          output += `  - ... and ${file.issues.length - 3} more issues\n`;
        }
      });
      output += '\n';
    }
  }
  
  // Recommendations
  if (report.recommendations.length > 0) {
    output += `### Recommendations\n`;
    report.recommendations.forEach(rec => {
      const priorityIcon = rec.priority === 'high' ? '🔴' : 
                          rec.priority === 'medium' ? '🟡' : 
                          rec.priority === 'critical' ? '🚨' : '🟢';
      output += `${priorityIcon} **${rec.title}**\n`;
      output += `   - ${rec.description}\n`;
      output += `   - Impact: ${rec.estimatedImpact}\n`;
      output += `   - Effort: ${rec.effort}\n`;
      if (rec.filesAffected.length > 0) {
        output += `   - Files affected: ${rec.filesAffected.length}\n`;
      }
      output += '\n';
    });
  }
  
  // Quality breakdown
  output += `### Quality Analysis\n`;
  const qualityLevel = report.summary.qualityScore >= 80 ? '🟢 Excellent' :
                      report.summary.qualityScore >= 60 ? '🟡 Good' :
                      report.summary.qualityScore >= 40 ? '🟠 Fair' : '🔴 Poor';
  output += `**Overall Quality:** ${qualityLevel} (${report.summary.qualityScore}/100)\n\n`;
  
  // Next steps
  output += `### Next Steps\n`;
  if (report.summary.optimizationsAvailable > 0) {
    output += `- Run with \`autoFix: true\` to apply ${report.summary.optimizationsAvailable} automatic optimizations\n`;
  }
  if (report.globalMetrics.byType.var > 0) {
    output += `- Consider converting ${report.globalMetrics.byType.var} var declarations to const/let\n`;
  }
  if (report.globalMetrics.unusedCount > 0) {
    output += `- Remove ${report.globalMetrics.unusedCount} unused variables\n`;
  }
  output += `- Focus on files with high issue counts for maximum impact\n`;
  
  return output;
}

async function applyOptimizations(
  results: VariableAnalysisResult[],
  fileOps: FileOperations,
  options: z.infer<typeof VariableLifecycleSchema>,
  logger: any
): Promise<{
  filesModified: string[];
  fileSnapshots: FileSnapshot[];
  optimizationsApplied: number;
}> {
  const filesModified: string[] = [];
  const fileSnapshots: FileSnapshot[] = [];
  let optimizationsApplied = 0;

  for (const result of results) {
    const autoApplicableOptimizations = result.optimizations.filter(opt => opt.autoApplicable);
    
    if (autoApplicableOptimizations.length > 0) {
      try {
        const originalContent = await fileOps.readFile(result.file);
        let modifiedContent = originalContent;

        // Apply optimizations (simplified implementation)
        for (const optimization of autoApplicableOptimizations) {
          if (optimization.type === 'const-conversion') {
            modifiedContent = modifiedContent.replace(
              new RegExp(`let\\s+${optimization.variable}`, 'g'),
              `const ${optimization.variable}`
            );
            optimizationsApplied++;
          } else if (optimization.type === 'let-conversion') {
            modifiedContent = modifiedContent.replace(
              new RegExp(`var\\s+${optimization.variable}`, 'g'),
              `${optimization.toType} ${optimization.variable}`
            );
            optimizationsApplied++;
          }
        }

        if (modifiedContent !== originalContent) {
          fileSnapshots.push({
            filePath: result.file,
            contentBefore: originalContent,
            contentAfter: modifiedContent
          });

          if (!options.dryRun) {
            await fileOps.writeFile(result.file, modifiedContent);
          }

          filesModified.push(result.file);
          logger.info(`Applied ${autoApplicableOptimizations.length} optimizations to ${result.file}`);
        }
      } catch (error) {
        logger.warn(`Failed to apply optimizations to ${result.file}:`, error);
      }
    }
  }

  return {
    filesModified,
    fileSnapshots,
    optimizationsApplied
  };
}

function generateOptimizationReport(results: {
  filesModified: string[];
  fileSnapshots: FileSnapshot[];
  optimizationsApplied: number;
}): string {
  let report = `\n## Optimization Results\n\n`;
  
  report += `### Applied Changes\n`;
  report += `- **Optimizations applied:** ${results.optimizationsApplied}\n`;
  report += `- **Files modified:** ${results.filesModified.length}\n`;
  report += `- **Snapshots created:** ${results.fileSnapshots.length}\n\n`;

  if (results.filesModified.length > 0) {
    report += `### Modified Files\n`;
    results.filesModified.forEach(file => {
      report += `- ${file}\n`;
    });
  }

  return report;
}
