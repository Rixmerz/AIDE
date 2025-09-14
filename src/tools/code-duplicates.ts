/**
 * Code Duplicates Tool for AIDE MCP Server
 * 
 * Advanced duplicate code detection with refactoring suggestions and automated extraction
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { DuplicateDetector, type DuplicateClone, type DuplicationMetrics } from '../utils/duplicate-detector.js';
import { ASTUtilsEnhanced } from '../utils/ast-utils-enhanced.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const CodeDuplicatesSchema = z.object({
  operation: z.enum(['detect-duplicates', 'extract-common', 'merge-similar', 'analyze-patterns', 'full-deduplication']),
  filePattern: z.string().optional().default('src/**/*.{ts,tsx,js,jsx}'),
  files: z.array(z.string()).optional(),
  
  // Detection parameters
  minLines: z.number().min(3).max(100).optional().default(5),
  minTokens: z.number().min(10).max(500).optional().default(50),
  similarityThreshold: z.number().min(0.1).max(1.0).optional().default(0.8),
  
  // Refactoring options
  autoExtract: z.boolean().optional().default(false),
  extractionStrategy: z.enum(['function', 'class', 'utility', 'component']).optional().default('function'),
  createUtilityFile: z.boolean().optional().default(false),
  utilityFilePath: z.string().optional().default('src/utils/extracted.ts'),
  
  // Output options
  includeRefactoring: z.boolean().optional().default(true),
  generateReport: z.boolean().optional().default(true),
  reportFormat: z.enum(['markdown', 'json', 'html']).optional().default('markdown'),
  
  // Processing options
  dryRun: z.boolean().optional().default(false),
  createBackups: z.boolean().optional().default(true),
  maxDuplicatesToProcess: z.number().optional().default(50),
});

interface DuplicationAnalysisResult {
  duplicates: DuplicateClone[];
  metrics: DuplicationMetrics;
  refactoringPlan: RefactoringPlan;
  extractedCode: ExtractedCodeInfo[];
}

interface RefactoringPlan {
  extractionsRecommended: number;
  mergingOpportunities: number;
  utilityCreations: number;
  estimatedSavings: {
    linesReduced: number;
    filesAffected: number;
    complexityReduction: number;
  };
  prioritizedActions: PrioritizedAction[];
}

interface PrioritizedAction {
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'extract-function' | 'extract-class' | 'create-utility' | 'merge-functions' | 'create-component';
  description: string;
  duplicateId: number;
  estimatedEffort: 'low' | 'medium' | 'high';
  impact: {
    linesReduced: number;
    maintainabilityImprovement: number;
    reuseOpportunity: number;
  };
}

interface ExtractedCodeInfo {
  type: 'function' | 'class' | 'utility' | 'component';
  name: string;
  code: string;
  targetFile: string;
  imports: string[];
  usages: CodeUsage[];
  originalLocations: Array<{
    file: string;
    startLine: number;
    endLine: number;
  }>;
}

interface CodeUsage {
  file: string;
  line: number;
  context: string;
  replacementCode: string;
}

export async function handleCodeDuplicates(args: any, context: ToolContext) {
  const validated = CodeDuplicatesSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting code duplication analysis', {
      operation: validated.operation,
      filePattern: validated.filePattern,
      minLines: validated.minLines,
      similarityThreshold: validated.similarityThreshold,
    });

    const fileOps = new FileOperations(logger);
    const duplicateDetector = new DuplicateDetector(logger, {
      minLines: validated.minLines,
      minTokens: validated.minTokens,
      similarityThreshold: validated.similarityThreshold,
    });
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
            text: 'No files found to analyze for duplicates.',
          },
        ],
      };
    }

    let response = `# Code Duplication Analysis\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**Files analyzed:** ${filesToAnalyze.length}\n`;
    response += `**Detection parameters:** ${validated.minLines} min lines, ${validated.similarityThreshold * 100}% similarity\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE PROCESSING'}\n\n`;

    let analysisResult: DuplicationAnalysisResult;

    switch (validated.operation) {
      case 'detect-duplicates':
        analysisResult = await detectDuplicatesOperation(duplicateDetector, validated, logger);
        break;
      
      case 'extract-common':
        analysisResult = await extractCommonOperation(duplicateDetector, astUtils, fileOps, validated, logger);
        break;
      
      case 'merge-similar':
        analysisResult = await mergeSimilarOperation(duplicateDetector, astUtils, fileOps, validated, logger);
        break;
      
      case 'analyze-patterns':
        analysisResult = await analyzePatternsOperation(duplicateDetector, validated, logger);
        break;
      
      case 'full-deduplication':
        analysisResult = await fullDeduplicationOperation(duplicateDetector, astUtils, fileOps, validated, logger);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    // Generate response based on analysis
    response += generateAnalysisReport(analysisResult, validated);

    // Apply refactoring if not dry run and auto-extract is enabled
    if (!validated.dryRun && validated.autoExtract && analysisResult.extractedCode.length > 0) {
      const extractionResults = await applyExtractions(
        analysisResult.extractedCode,
        fileOps,
        validated,
        logger
      );
      
      response += generateExtractionReport(extractionResults, validated);
      
      // Record in history
      const historyId = await historyManager.recordOperation(
        'code_duplicates',
        `Code Duplication: ${validated.operation}`,
        `Processed ${analysisResult.duplicates.length} duplicates, extracted ${analysisResult.extractedCode.length} code blocks`,
        extractionResults.fileSnapshots,
        {
          operation: validated.operation,
          duplicatesFound: analysisResult.duplicates.length,
          extractionsApplied: analysisResult.extractedCode.length,
          linesReduced: analysisResult.refactoringPlan.estimatedSavings.linesReduced,
          filesModified: extractionResults.filesModified.length,
        }
      );
      
      response += `\n**Operation ID:** ${historyId}\n`;
    } else if (validated.generateReport) {
      // Just record the analysis without modifications
      const historyId = await historyManager.recordOperation(
        'code_duplicates',
        `Code Duplication Analysis: ${validated.operation}`,
        `Analyzed ${filesToAnalyze.length} files, found ${analysisResult.duplicates.length} duplicates`,
        [],
        {
          operation: validated.operation,
          duplicatesFound: analysisResult.duplicates.length,
          estimatedSavings: analysisResult.refactoringPlan.estimatedSavings.linesReduced,
          analysisOnly: true,
        }
      );
      
      response += `\n**Analysis ID:** ${historyId}\n`;
    }

    // Cleanup
    astUtils.dispose();

    logger.info('Code duplication analysis completed', {
      duplicatesFound: analysisResult.duplicates.length,
      extractionsPlanned: analysisResult.extractedCode.length,
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
    logger.error('Error in code_duplicates tool:', error);
    throw error;
  }
}

async function detectDuplicatesOperation(
  duplicateDetector: DuplicateDetector,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<DuplicationAnalysisResult> {
  // Use the filePattern directly since duplicateDetector expects to handle file resolution
  const duplicates = await duplicateDetector.detectDuplicates(options.filePattern);
  const metrics = duplicateDetector.calculateDuplicationMetrics(duplicates, 100); // Estimate 100 files

  return {
    duplicates,
    metrics,
    refactoringPlan: generateRefactoringPlan(duplicates),
    extractedCode: []
  };
}

async function extractCommonOperation(
  duplicateDetector: DuplicateDetector,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<DuplicationAnalysisResult> {
  const duplicates = await duplicateDetector.detectDuplicates(options.filePattern);
  const refactoringPlan = generateRefactoringPlan(duplicates);
  
  // Generate extraction suggestions for high-priority duplicates
  const extractedCode: ExtractedCodeInfo[] = [];
  const highPriorityDuplicates = duplicates
    .filter(d => d.linesOfCode >= options.minLines * 2)
    .slice(0, options.maxDuplicatesToProcess);

  for (const duplicate of highPriorityDuplicates) {
    const extraction = await generateExtraction(duplicate, options, astUtils, fileOps);
    if (extraction) {
      extractedCode.push(extraction);
    }
  }

  return {
    duplicates,
    metrics: duplicateDetector.calculateDuplicationMetrics(duplicates, 100),
    refactoringPlan,
    extractedCode
  };
}

async function mergeSimilarOperation(
  duplicateDetector: DuplicateDetector,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<DuplicationAnalysisResult> {
  const duplicates = await duplicateDetector.detectDuplicates(options.filePattern);
  
  // Focus on similar (not exact) duplicates that can be merged
  const mergableDuplicates = duplicates.filter(d => 
    d.type === 'similar' && 
    d.similarity >= 0.85 && 
    d.files.length === 2 // Only handle pairs for simplicity
  );
  
  const extractedCode: ExtractedCodeInfo[] = [];
  for (const duplicate of mergableDuplicates.slice(0, options.maxDuplicatesToProcess)) {
    const extraction = await generateMergedFunction(duplicate, options, astUtils);
    if (extraction) {
      extractedCode.push(extraction);
    }
  }

  return {
    duplicates: mergableDuplicates,
    metrics: duplicateDetector.calculateDuplicationMetrics(duplicates, 100),
    refactoringPlan: generateRefactoringPlan(mergableDuplicates),
    extractedCode
  };
}

async function analyzePatternsOperation(
  duplicateDetector: DuplicateDetector,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<DuplicationAnalysisResult> {
  const duplicates = await duplicateDetector.detectDuplicates(options.filePattern);
  
  // Analyze patterns in duplicates
  const patterns = analyzeDuplicationPatterns(duplicates);
  
  return {
    duplicates,
    metrics: duplicateDetector.calculateDuplicationMetrics(duplicates, 100),
    refactoringPlan: generatePatternBasedPlan(duplicates, patterns),
    extractedCode: []
  };
}

async function fullDeduplicationOperation(
  duplicateDetector: DuplicateDetector,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<DuplicationAnalysisResult> {
  const duplicates = await duplicateDetector.detectDuplicates(options.filePattern);
  const refactoringPlan = generateRefactoringPlan(duplicates);
  
  // Generate comprehensive extraction plan
  const extractedCode: ExtractedCodeInfo[] = [];
  
  // Process exact duplicates first
  const exactDuplicates = duplicates.filter(d => d.type === 'exact');
  for (const duplicate of exactDuplicates.slice(0, options.maxDuplicatesToProcess / 2)) {
    const extraction = await generateExtraction(duplicate, options, astUtils, fileOps);
    if (extraction) {
      extractedCode.push(extraction);
    }
  }
  
  // Process similar duplicates
  const similarDuplicates = duplicates.filter(d => d.type === 'similar' && d.similarity >= 0.9);
  for (const duplicate of similarDuplicates.slice(0, options.maxDuplicatesToProcess / 2)) {
    const extraction = await generateExtraction(duplicate, options, astUtils, fileOps);
    if (extraction) {
      extractedCode.push(extraction);
    }
  }

  return {
    duplicates,
    metrics: duplicateDetector.calculateDuplicationMetrics(duplicates, 100),
    refactoringPlan,
    extractedCode
  };
}

function generateRefactoringPlan(duplicates: DuplicateClone[]): RefactoringPlan {
  const exactDuplicates = duplicates.filter(d => d.type === 'exact');
  const similarDuplicates = duplicates.filter(d => d.type === 'similar');
  const structuralDuplicates = duplicates.filter(d => d.type === 'structural');
  
  const extractionsRecommended = exactDuplicates.length + Math.floor(similarDuplicates.length * 0.7);
  const mergingOpportunities = Math.floor(similarDuplicates.length * 0.8);
  const utilityCreations = Math.floor(exactDuplicates.length * 0.3);
  
  const linesReduced = duplicates.reduce((sum, d) => 
    sum + (d.linesOfCode * (d.files.length - 1)), 0
  );
  
  const prioritizedActions: PrioritizedAction[] = duplicates
    .map((duplicate, index) => ({
      priority: getPriority(duplicate),
      type: getRefactoringType(duplicate),
      description: `${duplicate.suggestion.description} (${duplicate.files.length} instances, ${duplicate.linesOfCode} lines)`,
      duplicateId: index,
      estimatedEffort: getEstimatedEffort(duplicate),
      impact: {
        linesReduced: duplicate.linesOfCode * (duplicate.files.length - 1),
        maintainabilityImprovement: duplicate.similarity * 100,
        reuseOpportunity: duplicate.files.length * 10
      }
    }))
    .sort((a, b) => {
      const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    });

  return {
    extractionsRecommended,
    mergingOpportunities,
    utilityCreations,
    estimatedSavings: {
      linesReduced,
      filesAffected: new Set(duplicates.flatMap(d => d.files.map(f => f.file))).size,
      complexityReduction: Math.floor(linesReduced * 0.1) // Estimate 10% complexity reduction per line saved
    },
    prioritizedActions
  };
}

function getPriority(duplicate: DuplicateClone): 'critical' | 'high' | 'medium' | 'low' {
  if (duplicate.linesOfCode > 50 && duplicate.files.length > 3) return 'critical';
  if (duplicate.linesOfCode > 30 && duplicate.files.length > 2) return 'high';
  if (duplicate.linesOfCode > 15 || duplicate.files.length > 2) return 'medium';
  return 'low';
}

function getRefactoringType(duplicate: DuplicateClone): 'extract-function' | 'extract-class' | 'create-utility' | 'merge-functions' | 'create-component' {
  if (duplicate.linesOfCode > 100) return 'extract-class';
  if (duplicate.suggestion.type === 'create-component') return 'create-component';
  if (duplicate.files.length > 3) return 'create-utility';
  if (duplicate.type === 'similar') return 'merge-functions';
  return 'extract-function';
}

function getEstimatedEffort(duplicate: DuplicateClone): 'low' | 'medium' | 'high' {
  if (duplicate.type === 'exact' && duplicate.linesOfCode < 20) return 'low';
  if (duplicate.type === 'similar' || duplicate.linesOfCode > 50) return 'high';
  return 'medium';
}

async function generateExtraction(
  duplicate: DuplicateClone,
  options: z.infer<typeof CodeDuplicatesSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations
): Promise<ExtractedCodeInfo | null> {
  try {
    const firstInstance = duplicate.files[0];
    if (!firstInstance) {
      throw new Error('No file instance found in duplicate clone');
    }
    const functionName = duplicate.suggestion.name || `extracted_${Date.now()}`;
    
    // Generate usage replacements
    const usages: CodeUsage[] = duplicate.files.map(file => ({
      file: file.file,
      line: file.startLine,
      context: file.context,
      replacementCode: `${functionName}(${duplicate.suggestion.parameters.join(', ')})`
    }));

    const extractedCode: ExtractedCodeInfo = {
      type: options.extractionStrategy as any,
      name: functionName,
      code: generateExtractedCode(duplicate, options.extractionStrategy),
      targetFile: options.createUtilityFile ? options.utilityFilePath : firstInstance.file,
      imports: extractImports(firstInstance.codeBlock),
      usages,
      originalLocations: duplicate.files.map(f => ({
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine
      }))
    };

    return extractedCode;
  } catch (error) {
    console.warn('Failed to generate extraction:', error);
    return null;
  }
}

async function generateMergedFunction(
  duplicate: DuplicateClone,
  options: z.infer<typeof CodeDuplicatesSchema>,
  astUtils: ASTUtilsEnhanced
): Promise<ExtractedCodeInfo | null> {
  // Merge similar functions by finding common parts and parameterizing differences
  const firstFile = duplicate.files[0];
  const secondFile = duplicate.files[1];
  
  if (!firstFile || !secondFile) {
    throw new Error('Need at least two file instances for merge operation');
  }
  
  // This is a simplified merge - in practice would need sophisticated AST analysis
  const functionName = `merged_${Date.now()}`;
  const mergedCode = generateMergedCode(firstFile.codeBlock, secondFile.codeBlock);
  
  return {
    type: 'function',
    name: functionName,
    code: mergedCode,
    targetFile: firstFile.file,
    imports: extractImports(firstFile.codeBlock),
    usages: duplicate.files.map(f => ({
      file: f.file,
      line: f.startLine,
      context: f.context,
      replacementCode: `${functionName}(/* parameters */)`
    })),
    originalLocations: duplicate.files.map(f => ({
      file: f.file,
      startLine: f.startLine,
      endLine: f.endLine
    }))
  };
}

function generateExtractedCode(duplicate: DuplicateClone, strategy: string): string {
  const firstInstance = duplicate.files[0];
  if (!firstInstance) {
    throw new Error('No file instance found in duplicate clone');
  }
  const parameters = duplicate.suggestion.parameters.join(', ');
  
  switch (strategy) {
    case 'function':
      return `function ${duplicate.suggestion.name}(${parameters}) {\n${firstInstance.codeBlock}\n}`;
    case 'class':
      return `class ${duplicate.suggestion.name} {\n  process(${parameters}) {\n${firstInstance.codeBlock}\n  }\n}`;
    case 'utility':
      return `export const ${duplicate.suggestion.name} = (${parameters}) => {\n${firstInstance.codeBlock}\n};`;
    case 'component':
      return `export const ${duplicate.suggestion.name} = (${parameters}) => {\n  return (\n${firstInstance.codeBlock}\n  );\n};`;
    default:
      return firstInstance.codeBlock;
  }
}

function generateMergedCode(code1: string, code2: string): string {
  // Simplified merge logic - would need sophisticated analysis in practice
  return `function mergedFunction(variant, ...args) {\n  if (variant === 'a') {\n${code1}\n  } else {\n${code2}\n  }\n}`;
}

function extractImports(code: string): string[] {
  const importRegex = /import\s+.*?\s+from\s+['"][^'"]+['"]/g;
  return code.match(importRegex) || [];
}

function analyzeDuplicationPatterns(duplicates: DuplicateClone[]): Record<string, number> {
  const patterns: Record<string, number> = {};
  
  duplicates.forEach(duplicate => {
    const key = `${duplicate.type}-${Math.floor(duplicate.linesOfCode / 10) * 10}-${duplicate.files.length}`;
    patterns[key] = (patterns[key] || 0) + 1;
  });
  
  return patterns;
}

function generatePatternBasedPlan(duplicates: DuplicateClone[], patterns: Record<string, number>): RefactoringPlan {
  // Generate plan based on discovered patterns
  return generateRefactoringPlan(duplicates);
}

async function applyExtractions(
  extractions: ExtractedCodeInfo[],
  fileOps: FileOperations,
  options: z.infer<typeof CodeDuplicatesSchema>,
  logger: any
): Promise<{
  filesModified: string[];
  fileSnapshots: FileSnapshot[];
  extractionsApplied: number;
}> {
  const filesModified: string[] = [];
  const fileSnapshots: FileSnapshot[] = [];
  let extractionsApplied = 0;

  for (const extraction of extractions) {
    try {
      // Create/update the target file with extracted code
      let targetContent = '';
      if (await fileOps.fileExists(extraction.targetFile)) {
        targetContent = await fileOps.readFile(extraction.targetFile);
      }

      const newTargetContent = addExtractedCode(targetContent, extraction);
      
      if (newTargetContent !== targetContent) {
        fileSnapshots.push({
          filePath: extraction.targetFile,
          contentBefore: targetContent,
          contentAfter: newTargetContent
        });
        
        if (!options.dryRun) {
          await fileOps.writeFile(extraction.targetFile, newTargetContent);
        }
        
        if (!filesModified.includes(extraction.targetFile)) {
          filesModified.push(extraction.targetFile);
        }
      }

      // Replace usages in original files
      for (const usage of extraction.usages) {
        if (!filesModified.includes(usage.file)) {
          const originalContent = await fileOps.readFile(usage.file);
          const modifiedContent = replaceCodeWithUsage(originalContent, usage, extraction);
          
          if (modifiedContent !== originalContent) {
            fileSnapshots.push({
              filePath: usage.file,
              contentBefore: originalContent,
              contentAfter: modifiedContent
            });
            
            if (!options.dryRun) {
              await fileOps.writeFile(usage.file, modifiedContent);
            }
            
            filesModified.push(usage.file);
          }
        }
      }

      extractionsApplied++;
      logger.info(`Applied extraction: ${extraction.name}`);
    } catch (error) {
      logger.warn(`Failed to apply extraction ${extraction.name}:`, error);
    }
  }

  return {
    filesModified,
    fileSnapshots,
    extractionsApplied
  };
}

function addExtractedCode(existingContent: string, extraction: ExtractedCodeInfo): string {
  // Add imports if needed
  let content = existingContent;
  
  extraction.imports.forEach(importStatement => {
    if (!content.includes(importStatement)) {
      content = importStatement + '\n' + content;
    }
  });

  // Add the extracted code
  content += '\n\n' + extraction.code;
  
  return content;
}

function replaceCodeWithUsage(content: string, usage: CodeUsage, extraction: ExtractedCodeInfo): string {
  // This is a simplified replacement - would need more sophisticated logic
  const lines = content.split('\n');
  
  // Find and replace the original code block
  // For now, just append the usage (proper implementation would need AST manipulation)
  lines.splice(usage.line - 1, 0, `// TODO: Replace with ${usage.replacementCode}`);
  
  return lines.join('\n');
}

function generateAnalysisReport(result: DuplicationAnalysisResult, options: z.infer<typeof CodeDuplicatesSchema>): string {
  let report = `## Analysis Results\n\n`;
  
  report += `### Summary\n`;
  report += `- **Duplicates found:** ${result.duplicates.length}\n`;
  report += `- **Lines that can be reduced:** ${result.refactoringPlan.estimatedSavings.linesReduced}\n`;
  report += `- **Files affected:** ${result.refactoringPlan.estimatedSavings.filesAffected}\n`;
  report += `- **Duplication percentage:** ${result.metrics.duplicatedPercentage.toFixed(1)}%\n\n`;

  if (result.duplicates.length > 0) {
    report += `### Top Duplicates\n`;
    result.duplicates.slice(0, 10).forEach((duplicate, index) => {
      report += `#### ${index + 1}. ${duplicate.suggestion.type} (${duplicate.linesOfCode} lines, ${(duplicate.similarity * 100).toFixed(1)}% similar)\n`;
      report += `**Files:**\n`;
      duplicate.files.forEach(file => {
        report += `- ${file.file}:${file.startLine}-${file.endLine}\n`;
      });
      report += `**Suggestion:** ${duplicate.suggestion.description}\n\n`;
    });
  }

  if (options.includeRefactoring && result.refactoringPlan.prioritizedActions.length > 0) {
    report += `### Refactoring Recommendations\n`;
    result.refactoringPlan.prioritizedActions.slice(0, 5).forEach((action, index) => {
      report += `#### ${index + 1}. ${action.description} (${action.priority} priority)\n`;
      report += `- **Type:** ${action.type}\n`;
      report += `- **Effort:** ${action.estimatedEffort}\n`;
      report += `- **Impact:** ${action.impact.linesReduced} lines reduced\n\n`;
    });
  }

  return report;
}

function generateExtractionReport(results: {
  filesModified: string[];
  fileSnapshots: FileSnapshot[];
  extractionsApplied: number;
}, options: z.infer<typeof CodeDuplicatesSchema>): string {
  let report = `\n## Extraction Results\n\n`;
  
  report += `### Applied Extractions\n`;
  report += `- **Extractions applied:** ${results.extractionsApplied}\n`;
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