/**
 * Code Structure Analyzer Tool for AIDE MCP Server
 * 
 * Comprehensive analysis of code structure, quality, and architectural patterns
 */

import { z } from 'zod';
import { SyntaxKind } from 'ts-morph';
import { FileOperations } from '../utils/file-operations.js';
import { ASTUtilsEnhanced, type CodeSmell, type ComplexityMetrics } from '../utils/ast-utils-enhanced.js';
import { ComplexityAnalyzer, type ComplexityReport } from '../utils/complexity-analyzer.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const CodeStructureAnalyzerSchema = z.object({
  operation: z.enum(['analyze-structure', 'detect-smells', 'complexity-analysis', 'dependency-analysis', 'architecture-review', 'full-analysis']),
  files: z.array(z.string()).optional(),
  filePattern: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  
  // Analysis options
  includeComplexity: z.boolean().optional().default(true),
  includeCodeSmells: z.boolean().optional().default(true),
  includeDependencies: z.boolean().optional().default(true),
  includeArchitecture: z.boolean().optional().default(true),
  
  // Thresholds
  complexityThreshold: z.number().optional().default(10),
  functionLengthThreshold: z.number().optional().default(50),
  classLengthThreshold: z.number().optional().default(300),
  
  // Output options
  generateReport: z.boolean().optional().default(true),
  exportFormat: z.enum(['markdown', 'json', 'html']).optional().default('markdown'),
  includeRecommendations: z.boolean().optional().default(true),
});

interface StructureAnalysisResult {
  file: string;
  metrics: {
    linesOfCode: number;
    functions: number;
    classes: number;
    interfaces: number;
    complexity: ComplexityMetrics[];
  };
  smells: CodeSmell[];
  dependencies: DependencyInfo[];
  architecture: ArchitecturalInsight[];
  quality: QualityScore;
}

interface DependencyInfo {
  type: 'internal' | 'external' | 'circular';
  source: string;
  target: string;
  strength: number;
  risk: 'low' | 'medium' | 'high';
}

interface ArchitecturalInsight {
  pattern: 'singleton' | 'factory' | 'observer' | 'mvc' | 'layered' | 'repository' | 'service-layer' | 'dependency-injection' | 'strategy' | 'decorator' | 'module' | 'procedural' | 'unknown';
  confidence: number;
  description: string;
  location: string;
  adherence: number;
}

interface QualityScore {
  overall: number;
  maintainability: number;
  complexity: number;
  testability: number;
  reusability: number;
  breakdown: {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
}

interface ProjectStructureReport {
  summary: {
    totalFiles: number;
    totalLines: number;
    averageComplexity: number;
    overallQuality: number;
  };
  fileAnalysis: StructureAnalysisResult[];
  projectMetrics: {
    codeSmellsByType: Record<string, number>;
    complexityDistribution: Record<string, number>;
    dependencyGraph: DependencyInfo[];
    architecturalPatterns: ArchitecturalInsight[];
  };
  recommendations: ProjectRecommendation[];
}

interface ProjectRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'structure' | 'complexity' | 'dependencies' | 'architecture' | 'quality';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  files: string[];
}

export async function handleCodeStructureAnalyzer(args: any, context: ToolContext) {
  const validated = CodeStructureAnalyzerSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting code structure analysis', {
      operation: validated.operation,
      filePattern: validated.filePattern,
      includeComplexity: validated.includeComplexity,
    });

    const fileOps = new FileOperations(logger);
    const astUtils = new ASTUtilsEnhanced(logger);
    const complexityAnalyzer = new ComplexityAnalyzer(logger);
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
            text: 'No files found to analyze.',
          },
        ],
      };
    }

    let response = `# Code Structure Analysis\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files analyzed:** ${filesToAnalyze.length}\n`;
    response += `**Analysis scope:** ${validated.includeComplexity ? 'Complexity, ' : ''}${validated.includeCodeSmells ? 'Code Smells, ' : ''}${validated.includeDependencies ? 'Dependencies, ' : ''}${validated.includeArchitecture ? 'Architecture' : ''}\n\n`;

    let analysisResults: StructureAnalysisResult[] = [];
    let projectReport: ProjectStructureReport | null = null;

    switch (validated.operation) {
      case 'analyze-structure':
        analysisResults = await performStructureAnalysis(filesToAnalyze, astUtils, complexityAnalyzer, validated, logger);
        break;
      
      case 'detect-smells':
        analysisResults = await performSmellDetection(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'complexity-analysis':
        analysisResults = await performComplexityAnalysis(filesToAnalyze, complexityAnalyzer, validated, logger);
        break;
      
      case 'dependency-analysis':
        analysisResults = await performDependencyAnalysis(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'architecture-review':
        analysisResults = await performArchitectureReview(filesToAnalyze, astUtils, validated, logger);
        break;
      
      case 'full-analysis':
        analysisResults = await performFullAnalysis(filesToAnalyze, astUtils, complexityAnalyzer, validated, logger);
        projectReport = generateProjectReport(analysisResults);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    // Generate response based on analysis type
    if (validated.operation === 'full-analysis' && projectReport) {
      response += generateFullAnalysisReport(projectReport, validated);
    } else {
      response += generateOperationReport(analysisResults, validated.operation, validated);
    }

    // Record operation in history
    if (validated.generateReport) {
      const historyId = await historyManager.recordOperation(
        'code_structure_analyzer',
        `Code Structure Analysis: ${validated.operation}`,
        `Analyzed ${filesToAnalyze.length} files for structure and quality`,
        [], // No file modifications
        {
          operation: validated.operation,
          filesAnalyzed: filesToAnalyze.length,
          totalIssues: analysisResults.reduce((sum, r) => sum + r.smells.length, 0),
          averageQuality: analysisResults.reduce((sum, r) => sum + r.quality.overall, 0) / analysisResults.length,
        }
      );
      
      response += `\n**Analysis ID:** ${historyId}\n`;
    }

    // Cleanup
    astUtils.dispose();

    logger.info('Code structure analysis completed', {
      filesAnalyzed: filesToAnalyze.length,
      issuesFound: analysisResults.reduce((sum, r) => sum + r.smells.length, 0),
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
    logger.error('Error in code_structure_analyzer tool:', error);
    throw error;
  }
}

async function performStructureAnalysis(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  complexityAnalyzer: ComplexityAnalyzer,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  const results: StructureAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      logger.debug(`Analyzing structure of ${file}`);
      
      const result: StructureAnalysisResult = {
        file,
        metrics: await analyzeFileMetrics(file, astUtils),
        smells: options.includeCodeSmells ? await astUtils.detectCodeSmells(file) : [],
        dependencies: options.includeDependencies ? await analyzeDependencies(file, astUtils) : [],
        architecture: options.includeArchitecture ? await analyzeArchitecture(file, astUtils) : [],
        quality: { overall: 0, maintainability: 0, complexity: 0, testability: 0, reusability: 0, breakdown: { strengths: [], weaknesses: [], recommendations: [] } }
      };

      if (options.includeComplexity) {
        const complexityReport = await complexityAnalyzer.analyzeFile(file);
        result.metrics.complexity = complexityReport.functions.map(f => ({
          cyclomaticComplexity: f.cyclomaticComplexity,
          linesOfCode: f.linesOfCode,
          maintainabilityIndex: f.maintainabilityIndex,
          cognitiveComplexity: f.cognitiveComplexity
        }));
      }

      result.quality = calculateQualityScore(result, options);
      results.push(result);
    } catch (error) {
      logger.warn(`Error analyzing ${file}:`, error);
    }
  }

  return results;
}

async function performSmellDetection(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  const results: StructureAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      const smells = await astUtils.detectCodeSmells(file);
      const metrics = await analyzeFileMetrics(file, astUtils);
      
      results.push({
        file,
        metrics,
        smells,
        dependencies: [],
        architecture: [],
        quality: { overall: 100 - (smells.length * 10), maintainability: 0, complexity: 0, testability: 0, reusability: 0, breakdown: { strengths: [], weaknesses: [], recommendations: [] } }
      });
    } catch (error) {
      logger.warn(`Error detecting smells in ${file}:`, error);
    }
  }

  return results;
}

async function performComplexityAnalysis(
  files: string[],
  complexityAnalyzer: ComplexityAnalyzer,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  const results: StructureAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      const complexityReport = await complexityAnalyzer.analyzeFile(file);
      
      results.push({
        file,
        metrics: {
          linesOfCode: complexityReport.overall.linesOfCode,
          functions: complexityReport.functions.length,
          classes: complexityReport.classes?.length || 0,
          interfaces: 0,
          complexity: complexityReport.functions.map(f => ({
            cyclomaticComplexity: f.cyclomaticComplexity,
            linesOfCode: f.linesOfCode,
            maintainabilityIndex: f.maintainabilityIndex,
            cognitiveComplexity: f.cognitiveComplexity
          }))
        },
        smells: [],
        dependencies: [],
        architecture: [],
        quality: { 
          overall: complexityReport.overall.maintainabilityIndex, 
          maintainability: complexityReport.overall.maintainabilityIndex, 
          complexity: 100 - Math.min(complexityReport.overall.cyclomaticComplexity * 5, 100), 
          testability: 0, 
          reusability: 0, 
          breakdown: { strengths: [], weaknesses: [], recommendations: [] } 
        }
      });
    } catch (error) {
      logger.warn(`Error analyzing complexity for ${file}:`, error);
    }
  }

  return results;
}

async function performDependencyAnalysis(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  const results: StructureAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      const dependencies = await analyzeDependencies(file, astUtils);
      const metrics = await analyzeFileMetrics(file, astUtils);
      
      results.push({
        file,
        metrics,
        smells: [],
        dependencies,
        architecture: [],
        quality: { overall: 0, maintainability: 0, complexity: 0, testability: 0, reusability: 0, breakdown: { strengths: [], weaknesses: [], recommendations: [] } }
      });
    } catch (error) {
      logger.warn(`Error analyzing dependencies for ${file}:`, error);
    }
  }

  return results;
}

async function performArchitectureReview(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  const results: StructureAnalysisResult[] = [];
  
  for (const file of files) {
    try {
      const architecture = await analyzeArchitecture(file, astUtils);
      const metrics = await analyzeFileMetrics(file, astUtils);
      
      results.push({
        file,
        metrics,
        smells: [],
        dependencies: [],
        architecture,
        quality: { overall: 0, maintainability: 0, complexity: 0, testability: 0, reusability: 0, breakdown: { strengths: [], weaknesses: [], recommendations: [] } }
      });
    } catch (error) {
      logger.warn(`Error reviewing architecture for ${file}:`, error);
    }
  }

  return results;
}

async function performFullAnalysis(
  files: string[],
  astUtils: ASTUtilsEnhanced,
  complexityAnalyzer: ComplexityAnalyzer,
  options: z.infer<typeof CodeStructureAnalyzerSchema>,
  logger: any
): Promise<StructureAnalysisResult[]> {
  return performStructureAnalysis(files, astUtils, complexityAnalyzer, options, logger);
}

async function analyzeFileMetrics(file: string, astUtils: ASTUtilsEnhanced): Promise<{
  linesOfCode: number;
  functions: number;
  classes: number;
  interfaces: number;
  complexity: ComplexityMetrics[];
}> {
  try {
    const fs = await import('fs');
    const content = fs.readFileSync(file, 'utf-8');
    
    // Calculate lines of code (non-empty, non-comment lines)
    const lines = content.split('\n');
    const linesOfCode = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && 
             !trimmed.startsWith('//') && 
             !trimmed.startsWith('/*') && 
             !trimmed.startsWith('*') &&
             trimmed !== '}';
    }).length;

    // Use AST analysis to count constructs
    const sourceFile = await astUtils.getSourceFile(file);
    const functions = sourceFile.getFunctions().length + 
                     sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).length;
    const classes = sourceFile.getClasses().length;
    const interfaces = sourceFile.getInterfaces().length + sourceFile.getTypeAliases().length;

    // Calculate complexity metrics for each function
    const complexity: ComplexityMetrics[] = [];
    
    sourceFile.getFunctions().forEach(func => {
      const funcName = func.getName() || 'anonymous';
      const body = func.getBody();
      
      if (body) {
        const cyclomaticComplexity = calculateCyclomaticComplexity(body);
        const cognitiveComplexity = calculateCognitiveComplexity(body);
        
        complexity.push({
          cyclomaticComplexity,
          cognitiveComplexity,
          linesOfCode: body.getText().split('\n').length,
          maintainabilityIndex: Math.max(0, 171 - 5.2 * Math.log(body.getText().split('\n').length) - 0.23 * cyclomaticComplexity)
        });
      }
    });

    // Also analyze arrow functions
    sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach((arrowFunc, index) => {
      const body = arrowFunc.getBody();
      if (body && body.getKind() === SyntaxKind.Block) {
        const cyclomaticComplexity = calculateCyclomaticComplexity(body);
        const cognitiveComplexity = calculateCognitiveComplexity(body);
        
        complexity.push({
          cyclomaticComplexity,
          cognitiveComplexity,
          linesOfCode: body.getText().split('\n').length,
          maintainabilityIndex: Math.max(0, 171 - 5.2 * Math.log(body.getText().split('\n').length) - 0.23 * cyclomaticComplexity)
        });
      }
    });

    return {
      linesOfCode,
      functions,
      classes,
      interfaces,
      complexity
    };
  } catch (error) {
    // Fallback to basic file analysis if AST fails
    const fs = await import('fs');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    
    return {
      linesOfCode: lines.filter(line => line.trim().length > 0).length,
      functions: (content.match(/function\s+\w+/g) || []).length + (content.match(/=>\s*{/g) || []).length,
      classes: (content.match(/class\s+\w+/g) || []).length,
      interfaces: (content.match(/interface\s+\w+/g) || []).length + (content.match(/type\s+\w+/g) || []).length,
      complexity: []
    };
  }
}

async function analyzeDependencies(file: string, astUtils: ASTUtilsEnhanced): Promise<DependencyInfo[]> {
  // This would analyze import statements and usage patterns
  const imports = await astUtils.analyzeImports(file);
  
  return imports.map(imp => ({
    type: imp.specifier.startsWith('.') ? 'internal' : 'external',
    source: file,
    target: imp.specifier,
    strength: imp.namedImports.length + (imp.defaultImport ? 1 : 0),
    risk: imp.isUsed ? 'low' : 'medium'
  }));
}

async function analyzeArchitecture(file: string, astUtils: ASTUtilsEnhanced): Promise<ArchitecturalInsight[]> {
  const insights: ArchitecturalInsight[] = [];
  
  try {
    const fs = await import('fs');
    const content = fs.readFileSync(file, 'utf-8');
    const sourceFile = await astUtils.getSourceFile(file);
    
    // Detect common architectural patterns
    
    // 1. Singleton Pattern
    if (content.includes('getInstance') && content.includes('private constructor')) {
      insights.push({
        pattern: 'singleton',
        confidence: 0.85,
        description: 'Singleton pattern detected with getInstance method',
        location: file,
        adherence: content.includes('static instance') ? 0.9 : 0.7
      });
    }
    
    // 2. Factory Pattern
    if (content.includes('create') && (content.includes('Factory') || content.includes('Builder'))) {
      insights.push({
        pattern: 'factory',
        confidence: 0.8,
        description: 'Factory or Builder pattern detected',
        location: file,
        adherence: sourceFile.getClasses().some(c => c.getName()?.includes('Factory')) ? 0.85 : 0.7
      });
    }
    
    // 3. Observer Pattern
    if (content.includes('subscribe') || content.includes('addEventListener') || content.includes('emit')) {
      insights.push({
        pattern: 'observer',
        confidence: 0.75,
        description: 'Observer pattern detected with event handling',
        location: file,
        adherence: 0.8
      });
    }
    
    // 4. Repository Pattern
    if (content.includes('Repository') || (content.includes('find') && content.includes('save'))) {
      insights.push({
        pattern: 'repository',
        confidence: 0.8,
        description: 'Repository pattern for data access detected',
        location: file,
        adherence: content.includes('interface') ? 0.9 : 0.7
      });
    }
    
    // 5. MVC Pattern
    if (file.includes('controller') || file.includes('Controller')) {
      insights.push({
        pattern: 'mvc',
        confidence: 0.7,
        description: 'MVC pattern - Controller detected',
        location: file,
        adherence: 0.8
      });
    }
    
    // 6. Service Layer Pattern
    if (file.includes('service') || file.includes('Service')) {
      insights.push({
        pattern: 'service-layer',
        confidence: 0.75,
        description: 'Service layer pattern detected',
        location: file,
        adherence: sourceFile.getClasses().some(c => c.getName()?.endsWith('Service')) ? 0.85 : 0.7
      });
    }
    
    // 7. Dependency Injection
    if (content.includes('@inject') || content.includes('@Injectable') || content.includes('container')) {
      insights.push({
        pattern: 'dependency-injection',
        confidence: 0.9,
        description: 'Dependency injection pattern detected',
        location: file,
        adherence: 0.9
      });
    }
    
    // 8. Strategy Pattern
    if (content.includes('Strategy') || (content.includes('algorithm') && content.includes('interface'))) {
      insights.push({
        pattern: 'strategy',
        confidence: 0.75,
        description: 'Strategy pattern for algorithm selection',
        location: file,
        adherence: 0.8
      });
    }
    
    // 9. Decorator Pattern
    if (content.includes('@') && content.includes('class ')) {
      const decoratorCount = (content.match(/@\w+/g) || []).length;
      if (decoratorCount > 0) {
        insights.push({
          pattern: 'decorator',
          confidence: 0.8,
          description: `Decorator pattern with ${decoratorCount} decorators`,
          location: file,
          adherence: 0.85
        });
      }
    }
    
    // 10. Module Pattern
    if (content.includes('export') || content.includes('import')) {
      const exports = (content.match(/export\s+(class|function|const|interface)/g) || []).length;
      const imports = (content.match(/import\s+.*from/g) || []).length;
      
      insights.push({
        pattern: 'module',
        confidence: 0.9,
        description: `Module pattern with ${exports} exports and ${imports} imports`,
        location: file,
        adherence: exports > 0 && imports > 0 ? 0.9 : 0.7
      });
    }
    
    // If no patterns detected
    if (insights.length === 0) {
      insights.push({
        pattern: 'procedural',
        confidence: 0.6,
        description: 'Procedural or simple functional code structure',
        location: file,
        adherence: 0.6
      });
    }
    
    return insights;
  } catch (error) {
    return [{
      pattern: 'unknown',
      confidence: 0.3,
      description: 'Unable to analyze architectural patterns due to parsing error',
      location: file,
      adherence: 0.3
    }];
  }
}

function calculateCyclomaticComplexity(node: any): number {
  let complexity = 1; // Base complexity
  
  try {
    // Count decision points that increase complexity
    const decisionNodes = [
      SyntaxKind.IfStatement,
      SyntaxKind.DoStatement,
      SyntaxKind.WhileStatement,
      SyntaxKind.ForStatement,
      SyntaxKind.ForInStatement,
      SyntaxKind.ForOfStatement,
      SyntaxKind.SwitchStatement,
      SyntaxKind.ConditionalExpression,
      SyntaxKind.BinaryExpression,
      SyntaxKind.CatchClause,
    ];
    
    node.forEachDescendant((child: any) => {
      const kind = child.getKind();
      
      if (decisionNodes.includes(kind)) {
        complexity++;
      }
      
      // Special handling for logical operators
      if (kind === SyntaxKind.BinaryExpression) {
        const operator = child.getOperatorToken().getText();
        if (operator === '&&' || operator === '||') {
          complexity++;
        }
      }
      
      // Case statements in switch
      if (kind === SyntaxKind.CaseClause) {
        complexity++;
      }
    });
    
  } catch (error) {
    // Fallback to simple text analysis if AST fails
    const text = node.getText();
    const patterns = [/\bif\b/g, /\belse\s+if\b/g, /\bwhile\b/g, /\bfor\b/g, 
                     /\bswitch\b/g, /\bcase\b/g, /\bcatch\b/g, /\&\&/g, /\|\|/g];
    
    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) complexity += matches.length;
    });
  }
  
  return Math.max(complexity, 1);
}

function calculateCognitiveComplexity(node: any): number {
  let complexity = 0;
  let nestingLevel = 0;
  
  try {
    node.forEachDescendant((child: any, traversal: any) => {
      const kind = child.getKind();
      
      // Increment nesting for certain constructs
      if ([SyntaxKind.IfStatement, SyntaxKind.DoStatement, SyntaxKind.WhileStatement, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement, SyntaxKind.SwitchStatement, SyntaxKind.TryStatement].includes(kind)) { // Control structures
        nestingLevel++;
        complexity += nestingLevel; // Cognitive load increases with nesting
        
        traversal.visitChildren();
        nestingLevel--;
      } else {
        // Other complexity-adding constructs
        if ([SyntaxKind.ConditionalExpression, SyntaxKind.CatchClause].includes(kind)) { // Ternary, catch
          complexity += 1;
        }
        
        if (kind === SyntaxKind.BinaryExpression) { // BinaryExpression
          const operator = child.getOperatorToken().getText();
          if (operator === '&&' || operator === '||') {
            complexity += 1;
          }
        }
      }
    });
  } catch (error) {
    // Fallback to cyclomatic complexity if cognitive calculation fails
    complexity = calculateCyclomaticComplexity(node);
  }
  
  return complexity;
}

function calculateNestingDepth(node: any): number {
  let maxDepth = 0;
  let currentDepth = 0;
  
  try {
    node.forEachDescendant((child: any, traversal: any) => {
      const kind = child.getKind();
      
      // Nesting constructs
      if ([SyntaxKind.IfStatement, SyntaxKind.DoStatement, SyntaxKind.WhileStatement, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement, SyntaxKind.SwitchStatement, SyntaxKind.TryStatement, SyntaxKind.Block].includes(kind)) { // Control + Block
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
        
        traversal.visitChildren();
        currentDepth--;
      }
    });
  } catch (error) {
    // Fallback to text-based analysis
    const text = node.getText();
    const lines = text.split('\n');
    let depth = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith('{')) depth++;
      if (trimmed.startsWith('}')) depth--;
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  
  return maxDepth;
}

function calculateQualityScore(result: StructureAnalysisResult, options: z.infer<typeof CodeStructureAnalyzerSchema>): QualityScore {
  let maintainability = 100;
  let complexity = 100;
  let testability = 100;
  let reusability = 100;
  
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  // Adjust scores based on code smells
  const highSeveritySmells = result.smells.filter(s => s.severity === 'high' || s.severity === 'critical').length;
  maintainability -= highSeveritySmells * 20;
  
  if (result.smells.length === 0) {
    strengths.push('No code smells detected');
  } else {
    weaknesses.push(`${result.smells.length} code smells found`);
    recommendations.push('Address code smells to improve maintainability');
  }

  // Adjust based on complexity
  const avgComplexity = result.metrics.complexity.reduce((sum, c) => sum + c.cyclomaticComplexity, 0) / Math.max(result.metrics.complexity.length, 1);
  if (avgComplexity > options.complexityThreshold) {
    complexity -= (avgComplexity - options.complexityThreshold) * 10;
    weaknesses.push('High cyclomatic complexity');
    recommendations.push('Refactor complex functions into smaller units');
  } else {
    strengths.push('Good complexity levels');
  }

  // Adjust based on dependencies
  const externalDeps = result.dependencies.filter(d => d.type === 'external').length;
  if (externalDeps > 10) {
    reusability -= (externalDeps - 10) * 5;
    weaknesses.push('High external dependency count');
  }

  const overall = Math.round((maintainability + complexity + testability + reusability) / 4);

  return {
    overall: Math.max(0, overall),
    maintainability: Math.max(0, maintainability),
    complexity: Math.max(0, complexity),
    testability: Math.max(0, testability),
    reusability: Math.max(0, reusability),
    breakdown: {
      strengths,
      weaknesses,
      recommendations
    }
  };
}

function generateProjectReport(results: StructureAnalysisResult[]): ProjectStructureReport {
  const totalFiles = results.length;
  const totalLines = results.reduce((sum, r) => sum + r.metrics.linesOfCode, 0);
  const averageComplexity = results.reduce((sum, r) => {
    const fileComplexity = r.metrics.complexity.reduce((s, c) => s + c.cyclomaticComplexity, 0);
    return sum + fileComplexity;
  }, 0) / totalFiles;
  const overallQuality = results.reduce((sum, r) => sum + r.quality.overall, 0) / totalFiles;

  // Aggregate code smells by type
  const codeSmellsByType: Record<string, number> = {};
  results.forEach(r => {
    r.smells.forEach(smell => {
      codeSmellsByType[smell.type] = (codeSmellsByType[smell.type] || 0) + 1;
    });
  });

  // Generate recommendations
  const recommendations: ProjectRecommendation[] = [];
  
  if (averageComplexity > 10) {
    recommendations.push({
      priority: 'high',
      category: 'complexity',
      title: 'Reduce Overall Code Complexity',
      description: 'The project has high average complexity which affects maintainability',
      impact: 'Improved maintainability and reduced bug risk',
      effort: 'high',
      files: results.filter(r => r.metrics.complexity.some(c => c.cyclomaticComplexity > 10)).map(r => r.file)
    });
  }

  return {
    summary: {
      totalFiles,
      totalLines,
      averageComplexity,
      overallQuality
    },
    fileAnalysis: results,
    projectMetrics: {
      codeSmellsByType,
      complexityDistribution: {},
      dependencyGraph: results.flatMap(r => r.dependencies),
      architecturalPatterns: results.flatMap(r => r.architecture)
    },
    recommendations
  };
}

function generateFullAnalysisReport(report: ProjectStructureReport, options: z.infer<typeof CodeStructureAnalyzerSchema>): string {
  let response = `## Project Structure Analysis Summary\n\n`;
  
  response += `### Overall Metrics\n`;
  response += `- **Files analyzed:** ${report.summary.totalFiles}\n`;
  response += `- **Total lines of code:** ${report.summary.totalLines}\n`;
  response += `- **Average complexity:** ${report.summary.averageComplexity.toFixed(2)}\n`;
  response += `- **Overall quality score:** ${report.summary.overallQuality.toFixed(1)}%\n\n`;

  response += `### Code Quality Distribution\n`;
  const qualityRanges = { excellent: 0, good: 0, fair: 0, poor: 0 };
  report.fileAnalysis.forEach(file => {
    if (file.quality.overall >= 90) qualityRanges.excellent++;
    else if (file.quality.overall >= 70) qualityRanges.good++;
    else if (file.quality.overall >= 50) qualityRanges.fair++;
    else qualityRanges.poor++;
  });
  
  response += `- **Excellent (90%+):** ${qualityRanges.excellent} files\n`;
  response += `- **Good (70-89%):** ${qualityRanges.good} files\n`;
  response += `- **Fair (50-69%):** ${qualityRanges.fair} files\n`;
  response += `- **Poor (<50%):** ${qualityRanges.poor} files\n\n`;

  response += `### Code Smells Summary\n`;
  Object.entries(report.projectMetrics.codeSmellsByType).forEach(([type, count]) => {
    response += `- **${type.replace('-', ' ')}:** ${count}\n`;
  });

  if (options.includeRecommendations && report.recommendations.length > 0) {
    response += `\n### Priority Recommendations\n`;
    report.recommendations.slice(0, 5).forEach((rec, index) => {
      response += `\n#### ${index + 1}. ${rec.title} (${rec.priority} priority)\n`;
      response += `${rec.description}\n`;
      response += `**Impact:** ${rec.impact}\n`;
      response += `**Effort:** ${rec.effort}\n`;
    });
  }

  return response;
}

function generateOperationReport(results: StructureAnalysisResult[], operation: string, options: z.infer<typeof CodeStructureAnalyzerSchema>): string {
  let response = `## ${operation.replace('-', ' ').toUpperCase()} Results\n\n`;
  
  switch (operation) {
    case 'detect-smells':
      const totalSmells = results.reduce((sum, r) => sum + r.smells.length, 0);
      response += `**Total code smells found:** ${totalSmells}\n\n`;
      
      if (totalSmells > 0) {
        response += `### Files with Most Issues\n`;
        results
          .filter(r => r.smells.length > 0)
          .sort((a, b) => b.smells.length - a.smells.length)
          .slice(0, 5)
          .forEach(result => {
            response += `- **${result.file}**: ${result.smells.length} issues\n`;
          });
      }
      break;
      
    case 'complexity-analysis':
      const avgComplexity = results.reduce((sum, r) => {
        const fileComplexity = r.metrics.complexity.reduce((s, c) => s + c.cyclomaticComplexity, 0);
        return sum + fileComplexity;
      }, 0) / results.length;
      
      response += `**Average complexity:** ${avgComplexity.toFixed(2)}\n\n`;
      
      response += `### Most Complex Files\n`;
      results
        .sort((a, b) => {
          const aMax = Math.max(...a.metrics.complexity.map(c => c.cyclomaticComplexity), 0);
          const bMax = Math.max(...b.metrics.complexity.map(c => c.cyclomaticComplexity), 0);
          return bMax - aMax;
        })
        .slice(0, 5)
        .forEach(result => {
          const maxComplexity = Math.max(...result.metrics.complexity.map(c => c.cyclomaticComplexity), 0);
          response += `- **${result.file}**: max complexity ${maxComplexity}\n`;
        });
      break;
      
    default:
      response += `Analysis completed for ${results.length} files.\n`;
  }
  
  return response;
}