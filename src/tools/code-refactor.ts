/**
 * Code Refactor Tool for AIDE MCP Server
 * 
 * Provides advanced refactoring operations like extract function, inline, move, and rename
 */

import { z } from 'zod';
import { FileOperations, type FileEdit } from '../utils/file-operations.js';
import { ASTUtils, type RefactoringResult } from '../utils/ast-utils.js';
import { HistoryManager, type FileSnapshot } from '../utils/history-manager.js';
import type { ToolContext } from './index.js';

const CodeRefactorSchema = z.object({
  operation: z.enum(['extract-function', 'extract-method', 'extract-class', 'inline-function', 'inline-variable', 'move-to-file', 'rename-symbol', 'extract-interface', 'extract-type', 'convert-to-arrow-function']),
  filePath: z.string().min(1, 'File path cannot be empty'),
  
  // For extract operations
  startLine: z.number().min(1).optional(),
  endLine: z.number().min(1).optional(),
  extractedName: z.string().optional(),
  
  // For inline operations
  symbolName: z.string().optional(),
  
  // For rename operations
  oldName: z.string().optional(),
  newName: z.string().optional(),
  
  // For move operations
  targetFile: z.string().optional(),
  exportType: z.enum(['named', 'default']).optional().default('named'),
  updateImports: z.boolean().optional().default(true),
  
  // For extract interface/type operations
  interfaceName: z.string().optional(),
  typeName: z.string().optional(),
  classOrTypeName: z.string().optional(),
  
  // For arrow function conversion
  functionName: z.string().optional(),
  preserveThis: z.boolean().optional().default(true),
  
  // Options
  updateReferences: z.boolean().optional().default(true),
  createBackups: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
});

interface RefactorResult {
  operation: string;
  success: boolean;
  filesModified: string[];
  details: RefactoringResult;
  historyId?: string;
}

export async function handleCodeRefactor(args: any, context: ToolContext) {
  const validated = CodeRefactorSchema.parse(args);
  const { logger } = context;

  try {
    logger.info('Starting code refactoring operation', {
      operation: validated.operation,
      filePath: validated.filePath,
      dryRun: validated.dryRun,
    });

    const fileOps = new FileOperations(logger);
    const astUtils = new ASTUtils(logger);
    const historyManager = new HistoryManager(logger);
    await historyManager.initialize();

    // Validate file exists
    if (!await fileOps.fileExists(validated.filePath)) {
      throw new Error(`File does not exist: ${validated.filePath}`);
    }

    let response = `# Code Refactoring Operation\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**File:** ${validated.filePath}\n`;
    response += `**Mode:** ${validated.dryRun ? 'DRY RUN (Preview)' : 'LIVE REFACTOR'}\n\n`;

    let refactorResult: RefactorResult;

    switch (validated.operation) {
      case 'extract-function':
        refactorResult = await handleExtractFunction(validated, astUtils, fileOps, logger);
        break;
      case 'extract-method':
        refactorResult = await handleExtractMethod(validated, astUtils, fileOps, logger);
        break;
      case 'extract-class':
        refactorResult = await handleExtractClass(validated, astUtils, fileOps, logger);
        break;
      case 'inline-function':
        refactorResult = await handleInlineFunction(validated, astUtils, fileOps, logger);
        break;
      case 'inline-variable':
        refactorResult = await handleInlineVariable(validated, astUtils, fileOps, logger);
        break;
      case 'move-to-file':
        refactorResult = await handleMoveToFile(validated, astUtils, fileOps, logger);
        break;
      case 'rename-symbol':
        refactorResult = await handleRenameSymbol(validated, astUtils, fileOps, logger);
        break;
      case 'extract-interface':
        refactorResult = await handleExtractInterface(validated, astUtils, fileOps, logger);
        break;
      case 'extract-type':
        refactorResult = await handleExtractType(validated, astUtils, fileOps, logger);
        break;
      case 'convert-to-arrow-function':
        refactorResult = await handleConvertToArrowFunction(validated, astUtils, fileOps, logger);
        break;
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    response += `## Refactoring Results\n\n`;
    response += `**Status:** ${refactorResult.success ? '✅ Successful' : '❌ Failed'}\n`;
    response += `**Files to modify:** ${refactorResult.filesModified.length}\n\n`;

    if (refactorResult.details.errors.length > 0) {
      response += `### Errors\n`;
      for (const error of refactorResult.details.errors) {
        response += `- ${error}\n`;
      }
      response += '\n';
    }

    if (refactorResult.details.changes.length > 0) {
      response += `### Changes Applied\n`;
      for (const change of refactorResult.details.changes) {
        response += `- ${change}\n`;
      }
      response += '\n';
    }

    if (validated.dryRun) {
      response += `## Preview\n\n`;
      if (refactorResult.details.newCode) {
        const lines = refactorResult.details.newCode.split('\n');
        const preview = lines.slice(0, 20).join('\n');
        response += `\`\`\`typescript\n${preview}\n${lines.length > 20 ? '... (truncated)' : ''}\n\`\`\`\n\n`;
      }
      response += `To apply this refactoring, run the same command with \`dryRun: false\`\n`;
    } else {
      if (refactorResult.success && refactorResult.details.newCode) {
        // Apply the refactoring
        const originalContent = await fileOps.readFile(validated.filePath);
        
        const fileEdits: FileEdit[] = [{
          filePath: validated.filePath,
          oldContent: originalContent,
          newContent: refactorResult.details.newCode,
        }];

        const fileSnapshots: FileSnapshot[] = [{
          filePath: validated.filePath,
          contentBefore: originalContent,
          contentAfter: refactorResult.details.newCode,
        }];

        const backups = await fileOps.applyMultipleEdits(fileEdits, validated.createBackups);

        // Record in history
        const historyId = await historyManager.recordOperation(
          'code_refactor',
          `Code Refactor: ${validated.operation}`,
          `Applied ${validated.operation} refactoring to ${validated.filePath}`,
          fileSnapshots,
          {
            operation: validated.operation,
            filesModified: refactorResult.filesModified.length,
            backupsCreated: backups.length,
          }
        );

        refactorResult.historyId = historyId;
        
        response += `## ✅ Refactoring Applied Successfully\n\n`;
        response += `**Operation ID:** ${historyId}\n`;
        if (backups.length > 0) {
          response += `**Backups created:** ${backups.length}\n`;
        }
        response += '\n';
        
        response += `## Next Steps\n`;
        response += `- Review the refactored code in your editor\n`;
        response += `- Run TypeScript compiler to check for errors\n`;
        response += `- Run tests to ensure functionality is preserved\n`;
        response += `- Use operation ID ${historyId} to rollback if needed\n`;

        logger.info('Code refactoring completed successfully', {
          operation: validated.operation,
          historyId,
        });
      } else {
        response += `## ❌ Refactoring Failed\n\n`;
        response += `Unable to complete the refactoring operation. Please check the errors above.\n`;
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
    logger.error('Error in code_refactor tool:', error);
    throw error;
  }
}

async function handleExtractFunction(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  _fileOps: FileOperations,
  _logger: any
): Promise<RefactorResult> {
  const { startLine, endLine, extractedName } = validated;
  
  if (!startLine || !endLine || !extractedName) {
    return {
      operation: 'extract-function',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: startLine, endLine, extractedName'],
      },
    };
  }

  const result = await astUtils.extractFunction(
    validated.filePath,
    startLine,
    endLine,
    extractedName
  );

  return {
    operation: 'extract-function',
    success: result.success,
    filesModified: result.success ? [validated.filePath] : [],
    details: result,
  };
}

async function handleExtractMethod(
  _validated: z.infer<typeof CodeRefactorSchema>,
  _astUtils: ASTUtils,
  _fileOps: FileOperations,
  _logger: any
): Promise<RefactorResult> {
  // Similar to extract function but for methods within classes
  return {
    operation: 'extract-method',
    success: false,
    filesModified: [],
    details: {
      success: false,
      changes: [],
      errors: ['Extract method not yet implemented - requires class context analysis'],
    },
  };
}

async function handleExtractClass(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<RefactorResult> {
  const { startLine, endLine, extractedName, targetFile } = validated;
  
  if (!startLine || !endLine || !extractedName) {
    return {
      operation: 'extract-class',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: startLine, endLine, extractedName'],
      },
    };
  }

  try {
    logger.info(`Extracting class ${extractedName} from lines ${startLine}-${endLine}`);
    
    // Step 1: Analyze the source file
    const sourceFile = await astUtils.getSourceFile(validated.filePath);
    const originalContent = await fileOps.readFile(validated.filePath);
    const lines = originalContent.split('\n');
    
    // Step 2: Extract the selected code region
    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      return {
        operation: 'extract-class',
        success: false,
        filesModified: [],
        details: {
          success: false,
          changes: [],
          errors: ['Invalid line range specified'],
        },
      };
    }
    
    const selectedCode = lines.slice(startLine - 1, endLine).join('\n');
    
    // Step 3: Analyze what to extract (methods, properties, dependencies)
    const extractAnalysis = analyzeCodeForClassExtraction(sourceFile, selectedCode, startLine, endLine, extractedName);
    
    if (!extractAnalysis.success) {
      return {
        operation: 'extract-class',
        success: false,
        filesModified: [],
        details: {
          success: false,
          changes: [],
          errors: extractAnalysis.errors || ['Failed to analyze code for extraction'],
        },
      };
    }
    
    // Step 4: Generate the new class
    const newClassCode = generateExtractedClass(
      extractedName,
      extractAnalysis.methods,
      extractAnalysis.properties,
      extractAnalysis.dependencies,
      extractAnalysis.imports
    );
    
    // Step 5: Create the new file or add to target file
    const newFileName = targetFile || `${extractedName}.ts`;
    const targetFilePath = targetFile ? targetFile : `${validated.filePath.replace(/\.ts$/, '')}_${extractedName}.ts`;
    
    await fileOps.writeFile(targetFilePath, newClassCode);
    
    // Step 6: Update the original file
    const updatedOriginalContent = updateOriginalFileAfterExtraction(
      lines,
      startLine,
      endLine,
      extractedName,
      extractAnalysis.replacementCode,
      targetFilePath
    );
    
    if (!validated.dryRun) {
      await fileOps.writeFile(validated.filePath, updatedOriginalContent);
    }
    
    const changes = [
      `Extracted class ${extractedName} with ${extractAnalysis.methods.length} methods and ${extractAnalysis.properties.length} properties`,
      `Created new file: ${targetFilePath}`,
      `Updated original file to use the new class`,
      `Added necessary import statements`
    ];
    
    return {
      operation: 'extract-class',
      success: true,
      filesModified: validated.dryRun ? [] : [validated.filePath, targetFilePath],
      details: {
        success: true,
        changes,
        errors: [],
        newCode: validated.dryRun ? undefined : updatedOriginalContent,
        // Additional debugging info available in implementation
      },
    };
    
  } catch (error) {
    logger.error('Error in handleExtractClass:', error);
    return {
      operation: 'extract-class',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: [`Failed to extract class: ${error}`],
      },
    };
  }
}

// Helper functions for extract class operation
function analyzeCodeForClassExtraction(
  sourceFile: any,
  selectedCode: string,
  startLine: number,
  endLine: number,
  className: string
): {
  success: boolean;
  methods: Array<{name: string, code: string, parameters: string[], returnType: string}>;
  properties: Array<{name: string, type: string, value?: string}>;
  dependencies: string[];
  imports: string[];
  replacementCode: string;
  errors?: string[];
} {
  try {
    const methods: Array<{name: string, code: string, parameters: string[], returnType: string}> = [];
    const properties: Array<{name: string, type: string, value?: string}> = [];
    const dependencies: string[] = [];
    const imports: string[] = [];
    
    // Parse the selected code for functions, methods, and variables
    const lines = selectedCode.split('\n');
    let currentMethod = '';
    let inMethod = false;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmedLine = line.trim();
      
      // Detect function/method declarations
      const functionMatch = trimmedLine.match(/(?:async\s+)?(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{?/);
      const methodMatch = trimmedLine.match(/(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/);
      const arrowFunctionMatch = trimmedLine.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/);
      
      if (functionMatch || methodMatch || arrowFunctionMatch) {
        inMethod = true;
        currentMethod = trimmedLine;
        braceCount = (trimmedLine.match(/\{/g) || []).length - (trimmedLine.match(/\}/g) || []).length;
        
        const methodName = (functionMatch && functionMatch[1]) || (methodMatch && methodMatch[1]) || (arrowFunctionMatch && arrowFunctionMatch[1]) || 'unknown';
        const params = extractParametersFromLine(line);
        const returnType = extractReturnTypeFromLine(trimmedLine);
        
        if (braceCount === 0 && !trimmedLine.includes('=>')) {
          // Single line function
          methods.push({
            name: methodName,
            code: currentMethod,
            parameters: params,
            returnType
          });
          inMethod = false;
          currentMethod = '';
        }
      } else if (inMethod) {
        currentMethod += '\n' + trimmedLine;
        braceCount += (trimmedLine.match(/\{/g) || []).length - (trimmedLine.match(/\}/g) || []).length;
        
        if (braceCount <= 0) {
          // End of method
          const lastMethodName = methods.length > 0 ? `method_${methods.length}` : 'method_0';
          const params = extractParametersFromMethod(currentMethod);
          const returnType = extractReturnTypeFromMethod(currentMethod);
          
          methods.push({
            name: lastMethodName,
            code: currentMethod,
            parameters: params,
            returnType
          });
          inMethod = false;
          currentMethod = '';
        }
      } else {
        // Detect variable declarations that should become properties
        const varMatch = trimmedLine.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::\s*([^=]+))?\s*=\s*(.+)/);
        if (varMatch && varMatch[1]) {
          properties.push({
            name: varMatch[1],
            type: (varMatch[2] && varMatch[2].trim()) || 'any',
            value: (varMatch[3] && varMatch[3].replace(/;$/, '')) || undefined
          });
        }
        
        // Detect dependencies (imported modules, external variables)
        const importMatches = trimmedLine.match(/import.*from\s+['"]([^'"]+)['"]/g);
        if (importMatches) {
          importMatches.forEach(imp => {
            const importMatch = imp.match(/from\s+['"]([^'"]+)['"]/); 
          const match = importMatch ? importMatch[1] : null;
            if (match && !imports.includes(match)) {
              imports.push(match);
            }
          });
        }
      }
    }
    
    // Generate replacement code (instantiation of the new class)
    const replacementCode = `const ${className}Instance = new ${className}();`;
    
    return {
      success: true,
      methods,
      properties,
      dependencies,
      imports,
      replacementCode
    };
    
  } catch (error) {
    return {
      success: false,
      methods: [],
      properties: [],
      dependencies: [],
      imports: [],
      replacementCode: '',
      errors: [`Analysis failed: ${error}`]
    };
  }
}

function extractParametersFromLine(line: string): string[] {
  const match = line.match(/\(([^)]*)\)/);
  if (!match || !match[1]) return [];
  
  return match[1].split(',').map(param => param.trim().split(':')[0]?.trim() || '').filter(p => p);
}

function extractReturnTypeFromLine(line: string): string {
  const match = line.match(/\)\s*:\s*([^{]+)/);
  return (match && match[1] && match[1].trim()) || 'void';
}

function extractParametersFromMethod(methodCode: string): string[] {
  const firstLine = methodCode.split('\n')[0] || '';
  return extractParametersFromLine(firstLine);
}

function extractReturnTypeFromMethod(methodCode: string): string {
  const firstLine = methodCode.split('\n')[0] || '';
  return extractReturnTypeFromLine(firstLine);
}

function generateExtractedClass(
  className: string,
  methods: Array<{name: string, code: string, parameters: string[], returnType: string}>,
  properties: Array<{name: string, type: string, value?: string}>,
  _dependencies: string[],
  imports: string[]
): string {
  let classCode = '';
  
  // Add imports
  if (imports.length > 0) {
    imports.forEach(imp => {
      classCode += `import { } from '${imp}';\n`;
    });
    classCode += '\n';
  }
  
  // Start class declaration
  classCode += `export class ${className} {\n`;
  
  // Add properties
  if (properties.length > 0) {
    properties.forEach(prop => {
      if (prop.value) {
        classCode += `  private ${prop.name}: ${prop.type} = ${prop.value};\n`;
      } else {
        classCode += `  private ${prop.name}: ${prop.type};\n`;
      }
    });
    classCode += '\n';
  }
  
  // Add constructor if needed
  if (properties.some(p => !p.value)) {
    classCode += `  constructor(${properties.filter(p => !p.value).map(p => `${p.name}: ${p.type}`).join(', ')}) {\n`;
    properties.filter(p => !p.value).forEach(prop => {
      classCode += `    this.${prop.name} = ${prop.name};\n`;
    });
    classCode += `  }\n\n`;
  }
  
  // Add methods
  methods.forEach(method => {
    // Convert standalone functions to class methods
    let methodCode = method.code;
    
    // Convert function declarations to methods
    methodCode = methodCode.replace(/^\s*(?:async\s+)?function\s+/m, '  async ');
    methodCode = methodCode.replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/m, '  async method');
    
    // Ensure proper indentation
    const lines = methodCode.split('\n');
    const indentedLines = lines.map((line, index) => {
      if (index === 0 && !line.trim().startsWith('//')) {
        // First line - add method prefix if needed
        if (!line.trim().match(/^\w+\s*\(/)) {
          return `  public ${line.trim()}`;
        }
        return `  ${line.trim()}`;
      }
      // Other lines - maintain relative indentation
      return line ? `  ${line}` : line;
    });
    
    classCode += indentedLines.join('\n') + '\n\n';
  });
  
  // Close class
  classCode += '}\n';
  
  return classCode;
}

function updateOriginalFileAfterExtraction(
  originalLines: string[],
  startLine: number,
  endLine: number,
  className: string,
  replacementCode: string,
  newFilePath: string
): string {
  // Add import for the new class at the top
  const importStatement = `import { ${className} } from './${newFilePath.replace(/\.ts$/, '')}'`;
  
  // Find a good place to insert the import (after existing imports)
  let importInsertIndex = 0;
  for (let i = 0; i < originalLines.length; i++) {
    const line = originalLines[i];
    if (line && line.trim().startsWith('import ')) {
      importInsertIndex = i + 1;
    } else if (line && line.trim() && !line.trim().startsWith('//')) {
      break;
    }
  }
  
  // Create new lines array
  const newLines = [...originalLines];
  
  // Insert import
  newLines.splice(importInsertIndex, 0, importStatement);
  
  // Adjust line numbers due to import insertion
  const adjustedStartLine = startLine + 1;
  const adjustedEndLine = endLine + 1;
  
  // Replace the extracted code with class instantiation
  const replacementLines = replacementCode.split('\n');
  newLines.splice(adjustedStartLine - 1, adjustedEndLine - adjustedStartLine + 1, ...replacementLines);
  
  return newLines.join('\n');
}

async function handleInlineFunction(
  _validated: z.infer<typeof CodeRefactorSchema>,
  _astUtils: ASTUtils,
  _fileOps: FileOperations,
  _logger: any
): Promise<RefactorResult> {
  return {
    operation: 'inline-function',
    success: false,
    filesModified: [],
    details: {
      success: false,
      changes: [],
      errors: ['Inline function not yet implemented - requires call site analysis'],
    },
  };
}

async function handleInlineVariable(
  _validated: z.infer<typeof CodeRefactorSchema>,
  _astUtils: ASTUtils,
  _fileOps: FileOperations,
  _logger: any
): Promise<RefactorResult> {
  return {
    operation: 'inline-variable',
    success: false,
    filesModified: [],
    details: {
      success: false,
      changes: [],
      errors: ['Inline variable not yet implemented - requires usage analysis'],
    },
  };
}

async function handleMoveToFile(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<RefactorResult> {
  const { targetFile, symbolName, exportType, updateImports } = validated;
  
  if (!targetFile || !symbolName) {
    return {
      operation: 'move-to-file',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: targetFile, symbolName'],
      },
    };
  }

  try {
    logger.info('Moving symbol to file', { symbolName, targetFile });

    // Read the source file
    const sourceContent = await fileOps.readFile(validated.filePath);
    
    // Use AST utils to move the symbol
    const result = await astUtils.moveSymbolToFile(
      validated.filePath,
      targetFile,
      symbolName,
      exportType || 'named',
      updateImports || true
    );

    const filesModified = [validated.filePath];
    if (result.success && result.newCode) {
      filesModified.push(targetFile);
    }

    return {
      operation: 'move-to-file',
      success: result.success,
      filesModified: result.success ? filesModified : [],
      details: result,
    };
  } catch (error) {
    logger.error('Error in move-to-file operation:', error);
    return {
      operation: 'move-to-file',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: [`Failed to move symbol: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
}

async function handleRenameSymbol(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  _fileOps: FileOperations,
  _logger: any
): Promise<RefactorResult> {
  const { oldName, newName } = validated;
  
  if (!oldName || !newName) {
    return {
      operation: 'rename-symbol',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: oldName, newName'],
      },
    };
  }

  const result = await astUtils.renameSymbol(validated.filePath, oldName, newName);

  return {
    operation: 'rename-symbol',
    success: result.success,
    filesModified: result.success ? [validated.filePath] : [],
    details: result,
  };
}

async function handleExtractInterface(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<RefactorResult> {
  const { interfaceName, classOrTypeName } = validated;
  
  if (!interfaceName || !classOrTypeName) {
    return {
      operation: 'extract-interface',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: interfaceName, classOrTypeName'],
      },
    };
  }

  try {
    logger.info('Extracting interface', { interfaceName, classOrTypeName });

    const result = await astUtils.extractInterface(
      validated.filePath,
      classOrTypeName,
      interfaceName
    );

    return {
      operation: 'extract-interface',
      success: result.success,
      filesModified: result.success ? [validated.filePath] : [],
      details: result,
    };
  } catch (error) {
    logger.error('Error in extract-interface operation:', error);
    return {
      operation: 'extract-interface',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: [`Failed to extract interface: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
}

async function handleExtractType(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<RefactorResult> {
  const { typeName, classOrTypeName } = validated;
  
  if (!typeName || !classOrTypeName) {
    return {
      operation: 'extract-type',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameters: typeName, classOrTypeName'],
      },
    };
  }

  try {
    logger.info('Extracting type alias', { typeName, classOrTypeName });

    const result = await astUtils.extractTypeAlias(
      validated.filePath,
      classOrTypeName,
      typeName
    );

    return {
      operation: 'extract-type',
      success: result.success,
      filesModified: result.success ? [validated.filePath] : [],
      details: result,
    };
  } catch (error) {
    logger.error('Error in extract-type operation:', error);
    return {
      operation: 'extract-type',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: [`Failed to extract type: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
}

async function handleConvertToArrowFunction(
  validated: z.infer<typeof CodeRefactorSchema>,
  astUtils: ASTUtils,
  fileOps: FileOperations,
  logger: any
): Promise<RefactorResult> {
  const { functionName, preserveThis } = validated;
  
  if (!functionName) {
    return {
      operation: 'convert-to-arrow-function',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: ['Missing required parameter: functionName'],
      },
    };
  }

  try {
    logger.info('Converting to arrow function', { functionName, preserveThis });

    const result = await astUtils.convertToArrowFunction(
      validated.filePath,
      functionName,
      preserveThis || true
    );

    return {
      operation: 'convert-to-arrow-function',
      success: result.success,
      filesModified: result.success ? [validated.filePath] : [],
      details: result,
    };
  } catch (error) {
    logger.error('Error in convert-to-arrow-function operation:', error);
    return {
      operation: 'convert-to-arrow-function',
      success: false,
      filesModified: [],
      details: {
        success: false,
        changes: [],
        errors: [`Failed to convert to arrow function: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
}