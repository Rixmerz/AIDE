/**
 * AST Utilities for AIDE MCP Server
 * 
 * Provides TypeScript AST manipulation capabilities using ts-morph
 */

import { Project, SourceFile, Node, SyntaxKind, ImportDeclaration, VariableDeclaration, FunctionDeclaration, ClassDeclaration } from 'ts-morph';
import type { Logger } from './logger.js';
import { TypeScriptAnalysisError } from './errors.js';

export interface ImportInfo {
  specifier: string;
  isUsed: boolean;
  isTypeOnly: boolean;
  namedImports: string[];
  defaultImport?: string;
  namespaceImport?: string;
}

export interface ExtractedFunction {
  name: string;
  parameters: string[];
  returnType: string;
  body: string;
  originalCode: string;
}

export interface RefactoringResult {
  success: boolean;
  changes: string[];
  errors: string[];
  newCode?: string;
}

export class ASTUtils {
  private project: Project;
  private logger: Logger;

  constructor(logger: Logger, tsConfigPath?: string) {
    this.logger = logger;
    this.project = new Project({
      tsConfigFilePath: tsConfigPath,
      useInMemoryFileSystem: false,
      skipLoadingLibFiles: true,
    });
  }

  async getSourceFile(filePath: string): Promise<SourceFile> {
    try {
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
      return sourceFile;
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to get source file ${filePath}: ${error}`);
    }
  }

  async analyzeImports(filePath: string): Promise<ImportInfo[]> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const imports: ImportInfo[] = [];

      sourceFile.getImportDeclarations().forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const namedImports = importDecl.getNamedImports().map(ni => ni.getName());
        const defaultImport = importDecl.getDefaultImport()?.getText();
        const namespaceImport = importDecl.getNamespaceImport()?.getText();

        // Enhanced import usage detection
        const allImportNames = [
          ...namedImports,
          ...(defaultImport ? [defaultImport] : []),
          ...(namespaceImport ? [namespaceImport] : [])
        ];
        
        // Check named imports individually
        const usedNamedImports = namedImports.filter(name => 
          this.isIdentifierUsed(sourceFile, name)
        );
        
        // Check default import
        const isDefaultUsed = defaultImport ? 
          this.isIdentifierUsed(sourceFile, defaultImport) : false;
          
        // Check namespace import
        const isNamespaceUsed = namespaceImport ? 
          this.isIdentifierUsed(sourceFile, namespaceImport) : false;
          
        // Side-effect only imports (no imports specified)
        const isSideEffectOnly = !defaultImport && !namespaceImport && namedImports.length === 0;
        
        // Type-only imports need special handling
        const isTypeOnlyImport = importDecl.isTypeOnly();
        
        let isUsed = usedNamedImports.length > 0 || isDefaultUsed || isNamespaceUsed || isSideEffectOnly;
        
        // For type-only imports, check if used in type contexts
        if (isTypeOnlyImport && !isUsed) {
          isUsed = this.isUsedInTypeContext(sourceFile, allImportNames);
        }

        imports.push({
          specifier: moduleSpecifier,
          isUsed,
          isTypeOnly: importDecl.isTypeOnly(),
          namedImports,
          defaultImport,
          namespaceImport,
        });
      });

      return imports;
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to analyze imports in ${filePath}: ${error}`);
    }
  }

  private isIdentifierUsed(sourceFile: SourceFile, name: string): boolean {
    // Enhanced identifier usage detection using TypeScript compiler API
    try {
      const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
      
      for (const identifier of identifiers) {
        if (identifier.getText() !== name) continue;
        if (this.isInImportDeclaration(identifier)) continue;
        
        // Check various usage contexts
        const parent = identifier.getParent();
        if (!parent) continue;
        
        const parentKind = parent.getKind();
        
        // 1. Variable/function references
        if (parentKind === SyntaxKind.VariableDeclaration ||
            parentKind === SyntaxKind.CallExpression ||
            parentKind === SyntaxKind.NewExpression) {
          return true;
        }
        
        // 2. Property access (e.g., Utils.method)
        if (parentKind === SyntaxKind.PropertyAccessExpression) {
          const propAccess = parent as any;
          if (propAccess.getExpression() === identifier) {
            return true;
          }
        }
        
        // 3. JSX element usage (React components)
        if (parentKind === SyntaxKind.JsxOpeningElement ||
            parentKind === SyntaxKind.JsxSelfClosingElement) {
          return true;
        }
        
        // 4. Type annotations and type references
        if (parentKind === SyntaxKind.TypeReference ||
            parentKind === SyntaxKind.InterfaceDeclaration ||
            parentKind === SyntaxKind.TypeAliasDeclaration) {
          return true;
        }
        
        // 5. Template literal expressions
        if (parentKind === SyntaxKind.TemplateExpression) {
          return true;
        }
        
        // 6. Object shorthand properties
        if (parentKind === SyntaxKind.ShorthandPropertyAssignment) {
          return true;
        }
        
        // 7. Destructuring patterns
        if (parentKind === SyntaxKind.ArrayBindingPattern ||
            parentKind === SyntaxKind.ObjectBindingPattern) {
          return true;
        }
        
        // 8. Function/method calls as arguments - check if identifier is child of call expression
        if (parent.getKind() === SyntaxKind.CallExpression) {
          return true;
        }
        
        // 9. Generic type parameters
        if (parentKind === SyntaxKind.TypeParameter) {
          return true;
        }
        
        // 10. Export declarations
        if (parentKind === SyntaxKind.ExportSpecifier) {
          return true;
        }
        
        // 11. Binary expressions and conditionals
        if (parentKind === SyntaxKind.BinaryExpression ||
            parentKind === SyntaxKind.ConditionalExpression) {
          return true;
        }
        
        // Prefix/postfix unary expressions
        if (parentKind === SyntaxKind.PrefixUnaryExpression ||
            parentKind === SyntaxKind.PostfixUnaryExpression) {
          return true;
        }
        
        // 12. Return statements
        if (parentKind === SyntaxKind.ReturnStatement) {
          return true;
        }
        
        // 13. Array literals and object literals
        if (parentKind === SyntaxKind.ArrayLiteralExpression ||
            parentKind === SyntaxKind.ObjectLiteralExpression) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      // Fallback to simple string matching if AST analysis fails
      const content = sourceFile.getFullText();
      const lines = content.split('\n');
      
      // Skip import lines and look for usage patterns
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('import ')) continue;
        
        // Check for various usage patterns
        const patterns = [
          new RegExp(`\\b${name}\\b(?!\.)`), // Direct usage
          new RegExp(`\\b${name}\\.\\w+`),     // Property access
          new RegExp(`<${name}[\\s/>]`),        // JSX usage
          new RegExp(`${name}\\(`),             // Function call
          new RegExp(`new\\s+${name}\\(`),      // Constructor
          new RegExp(`:\\s*${name}\\b`),        // Type annotation
        ];
        
        if (patterns.some(pattern => pattern.test(trimmedLine))) {
          return true;
        }
      }
      
      return false;
    }
  }

  private isInImportDeclaration(node: Node): boolean {
    let current: Node | undefined = node;
    while (current) {
      if (current.getKind() === SyntaxKind.ImportDeclaration) {
        return true;
      }
      current = current.getParent();
    }
    return false;
  }
  
  private isUsedInTypeContext(sourceFile: SourceFile, importNames: string[]): boolean {
    // Check if type imports are used in type-only contexts
    try {
      const typeReferences = sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference);
      const typeAliases = sourceFile.getDescendantsOfKind(SyntaxKind.TypeAliasDeclaration);
      const interfaceDecls = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
      const functionParams = sourceFile.getDescendantsOfKind(SyntaxKind.Parameter);
      const functionDecls = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      const methodDecls = sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration);
      
      const allTypeNodes = [
        ...typeReferences,
        ...typeAliases,
        ...interfaceDecls,
        ...functionParams,
        ...functionDecls,
        ...methodDecls
      ];
      
      for (const node of allTypeNodes) {
        const nodeText = node.getText();
        if (importNames.some(name => nodeText.includes(name))) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      // Fallback to text-based analysis
      const content = sourceFile.getFullText();
      const typePatterns = importNames.map(name => 
        new RegExp(`:\\s*${name}\\b|<${name}\\b|extends\\s+${name}\\b|implements\\s+${name}\\b`, 'g')
      );
      
      return typePatterns.some(pattern => pattern.test(content));
    }
  }

  async removeUnusedImports(filePath: string): Promise<string> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const imports = await this.analyzeImports(filePath);

      // Remove unused imports
      imports.forEach((importInfo, index) => {
        if (!importInfo.isUsed) {
          const importDecl = sourceFile.getImportDeclarations()[index];
          if (importDecl) {
            importDecl.remove();
          }
        }
      });

      return sourceFile.getFullText();
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to remove unused imports from ${filePath}: ${error}`);
    }
  }

  async sortImports(filePath: string): Promise<string> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const importDeclarations = sourceFile.getImportDeclarations();

      if (importDeclarations.length === 0) {
        return sourceFile.getFullText();
      }

      // Group imports by type
      const nodeModuleImports: ImportDeclaration[] = [];
      const relativeImports: ImportDeclaration[] = [];
      const absoluteImports: ImportDeclaration[] = [];

      importDeclarations.forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        
        if (moduleSpecifier.startsWith('.')) {
          relativeImports.push(importDecl);
        } else if (moduleSpecifier.startsWith('/') || moduleSpecifier.match(/^[A-Za-z]:/)) {
          absoluteImports.push(importDecl);
        } else {
          nodeModuleImports.push(importDecl);
        }
      });

      // Sort each group alphabetically
      const sortByModuleSpecifier = (a: ImportDeclaration, b: ImportDeclaration) => 
        a.getModuleSpecifierValue().localeCompare(b.getModuleSpecifierValue());

      nodeModuleImports.sort(sortByModuleSpecifier);
      absoluteImports.sort(sortByModuleSpecifier);
      relativeImports.sort(sortByModuleSpecifier);

      // Remove all existing imports
      importDeclarations.forEach(importDecl => importDecl.remove());

      // Add sorted imports back with proper spacing
      const allSortedImports = [...nodeModuleImports, ...absoluteImports, ...relativeImports];
      
      for (let i = 0; i < allSortedImports.length; i++) {
        const importText = allSortedImports[i]!.getText();
        sourceFile.insertText(0, importText + '\n');
        
        // Add extra newline between groups
        if (i === nodeModuleImports.length - 1 || i === nodeModuleImports.length + absoluteImports.length - 1) {
          if (i < allSortedImports.length - 1) {
            sourceFile.insertText(importText.length + 1, '\n');
          }
        }
      }

      return sourceFile.getFullText();
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to sort imports in ${filePath}: ${error}`);
    }
  }

  async extractFunction(filePath: string, startLine: number, endLine: number, functionName: string): Promise<RefactoringResult> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const lines = sourceFile.getFullText().split('\n');
      
      if (startLine < 1 || endLine > lines.length || startLine > endLine) {
        return {
          success: false,
          changes: [],
          errors: ['Invalid line range'],
        };
      }

      const selectedCode = lines.slice(startLine - 1, endLine).join('\n');
      
      // Analyze variables used in selection
      const usedVariables = this.analyzeVariableUsage(sourceFile, startLine, endLine);
      const parameters = usedVariables.external;
      const returnVariables = usedVariables.returned;

      // Generate function
      const returnType = returnVariables.length > 0 ? 
        (returnVariables.length === 1 ? 'any' : `{ ${returnVariables.join(', ')} }`) : 
        'void';

      const extractedFunction = `
function ${functionName}(${parameters.map(p => `${p}: any`).join(', ')}): ${returnType} {
${selectedCode.split('\n').map(line => '  ' + line).join('\n')}
${returnVariables.length > 0 ? `  return ${returnVariables.length === 1 ? returnVariables[0] : `{ ${returnVariables.join(', ')} }`};` : ''}
}`;

      // Replace original code with function call
      const functionCall = returnVariables.length > 0 ? 
        `const ${returnVariables.length === 1 ? returnVariables[0] : `{ ${returnVariables.join(', ')} }`} = ${functionName}(${parameters.join(', ')});` :
        `${functionName}(${parameters.join(', ')});`;

      // Apply changes
      const newLines = [...lines];
      newLines.splice(startLine - 1, endLine - startLine + 1, functionCall);
      
      // Insert function at the end of the file
      newLines.push('', extractedFunction);

      return {
        success: true,
        changes: [`Extracted function ${functionName}`, `Replaced ${endLine - startLine + 1} lines with function call`],
        errors: [],
        newCode: newLines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to extract function: ${error}`],
      };
    }
  }

  private analyzeVariableUsage(sourceFile: SourceFile, startLine: number, endLine: number): {
    external: string[];
    returned: string[];
  } {
    // Simplified variable analysis - in a real implementation, this would use AST
    const selectedText = sourceFile.getFullText().split('\n').slice(startLine - 1, endLine).join('\n');
    const allText = sourceFile.getFullText();
    
    // Find variables that might be used from outside the selection
    const variableMatches = selectedText.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
    const uniqueVariables = [...new Set(variableMatches)];
    
    // Filter to variables that are likely external (this is simplified)
    const external = uniqueVariables.filter(variable => 
      allText.indexOf(variable) < allText.indexOf(selectedText) && 
      !['const', 'let', 'var', 'function', 'class', 'interface', 'type'].includes(variable)
    );

    // Find variables that might need to be returned (simplified)
    const returned = uniqueVariables.filter(variable => 
      selectedText.includes(`${variable} =`) && 
      allText.indexOf(selectedText) + selectedText.length < allText.lastIndexOf(variable)
    );

    return { external: external.slice(0, 5), returned: returned.slice(0, 3) }; // Limit complexity
  }

  async renameSymbol(filePath: string, oldName: string, newName: string): Promise<RefactoringResult> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find all references to the symbol
      const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
        .filter(identifier => identifier.getText() === oldName);

      if (identifiers.length === 0) {
        return {
          success: false,
          changes: [],
          errors: [`Symbol '${oldName}' not found in file`],
        };
      }

      // Rename all occurrences
      identifiers.forEach(identifier => {
        identifier.replaceWithText(newName);
      });

      return {
        success: true,
        changes: [`Renamed ${identifiers.length} occurrences of '${oldName}' to '${newName}'`],
        errors: [],
        newCode: sourceFile.getFullText(),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to rename symbol: ${error}`],
      };
    }
  }

  async convertToAsyncAwait(filePath: string): Promise<string> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find promise chains (.then() calls)
      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      
      callExpressions.forEach(callExpr => {
        const expression = callExpr.getExpression();
        if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
          const propAccess = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
          if (propAccess.getName() === 'then') {
            // Convert .then() to await (simplified)
            const parent = callExpr.getParent();
            if (parent) {
              const awaitExpression = `await ${propAccess.getExpression().getText()}`;
              callExpr.replaceWithText(awaitExpression);
            }
          }
        }
      });

      return sourceFile.getFullText();
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to convert to async/await in ${filePath}: ${error}`);
    }
  }

  async addTypeAssertions(filePath: string): Promise<string> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find array literals that could benefit from 'as const'
      const arrayLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression);
      
      arrayLiterals.forEach(arrayLiteral => {
        const text = arrayLiteral.getText();
        // Add 'as const' to arrays with string/number literals
        if (text.match(/^\[[\s\S]*['"`]\s*,?\s*[\s\S]*\]$/) && !text.includes('as const')) {
          arrayLiteral.replaceWithText(`${text} as const`);
        }
      });

      // Find object literals that could benefit from 'as const'
      const objectLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
      
      objectLiterals.forEach(objectLiteral => {
        const text = objectLiteral.getText();
        // Add 'as const' to objects with literal values
        if (text.includes(':') && !text.includes('as const') && text.length < 200) {
          objectLiteral.replaceWithText(`${text} as const`);
        }
      });

      return sourceFile.getFullText();
    } catch (error) {
      throw new TypeScriptAnalysisError(`Failed to add type assertions in ${filePath}: ${error}`);
    }
  }

  async moveSymbolToFile(
    sourceFile: string,
    targetFile: string,
    symbolName: string,
    exportType: 'named' | 'default' = 'named',
    updateImports: boolean = true
  ): Promise<RefactoringResult> {
    try {
      const sourceFileObj = await this.getSourceFile(sourceFile);
      
      // Find the symbol to move
      const functions = sourceFileObj.getFunctions().filter(f => f.getName() === symbolName);
      const classes = sourceFileObj.getClasses().filter(c => c.getName() === symbolName);
      const interfaces = sourceFileObj.getInterfaces().filter(i => i.getName() === symbolName);
      const typeAliases = sourceFileObj.getTypeAliases().filter(t => t.getName() === symbolName);
      const variables = sourceFileObj.getVariableDeclarations().filter(v => v.getName() === symbolName);

      const symbols = [...functions, ...classes, ...interfaces, ...typeAliases, ...variables];
      
      if (symbols.length === 0) {
        return {
          success: false,
          changes: [],
          errors: [`Symbol '${symbolName}' not found in ${sourceFile}`],
        };
      }

      const symbol = symbols[0];
      if (!symbol) {
        return {
          success: false,
          changes: [],
          errors: [`Could not process symbol '${symbolName}'`],
        };
      }

      const symbolText = symbol.getText();
      
      // Create or get target file
      let targetFileObj: SourceFile;
      try {
        targetFileObj = await this.getSourceFile(targetFile);
      } catch {
        targetFileObj = this.project.createSourceFile(targetFile, '');
      }

      // Add export to symbol text
      const exportPrefix = exportType === 'default' ? 'export default ' : 'export ';
      const exportedSymbolText = symbolText.startsWith('export') ? symbolText : exportPrefix + symbolText;

      // Add symbol to target file
      targetFileObj.insertText(targetFileObj.getFullText().length, '\n' + exportedSymbolText + '\n');

      // Remove symbol from source file
      symbol.remove();

      // Add import to source file if updateImports is true
      if (updateImports) {
        const importText = exportType === 'default' 
          ? `import ${symbolName} from '${targetFile.replace(/\.(ts|js)$/, '')}';`
          : `import { ${symbolName} } from '${targetFile.replace(/\.(ts|js)$/, '')}';`;
        
        sourceFileObj.insertText(0, importText + '\n');
      }

      return {
        success: true,
        changes: [
          `Moved ${symbolName} to ${targetFile}`,
          updateImports ? `Added import statement to ${sourceFile}` : 'Import not updated'
        ],
        errors: [],
        newCode: sourceFileObj.getFullText(),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to move symbol: ${error}`],
      };
    }
  }

  async extractInterface(
    filePath: string,
    className: string,
    interfaceName: string
  ): Promise<RefactoringResult> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find the class
      const classDecl = sourceFile.getClass(className);
      if (!classDecl) {
        return {
          success: false,
          changes: [],
          errors: [`Class '${className}' not found in file`],
        };
      }

      // Extract public methods and properties
      const publicMethods = classDecl.getMethods().filter(m => 
        !m.hasModifier(SyntaxKind.PrivateKeyword) && 
        !m.hasModifier(SyntaxKind.ProtectedKeyword)
      );
      
      const publicProperties = classDecl.getProperties().filter(p => 
        !p.hasModifier(SyntaxKind.PrivateKeyword) && 
        !p.hasModifier(SyntaxKind.ProtectedKeyword)
      );

      // Generate interface
      let interfaceText = `interface ${interfaceName} {\n`;
      
      publicProperties.forEach(prop => {
        const name = prop.getName();
        const type = prop.getType()?.getText() || 'any';
        interfaceText += `  ${name}: ${type};\n`;
      });

      publicMethods.forEach(method => {
        const name = method.getName();
        const params = method.getParameters().map(p => `${p.getName()}: ${p.getType()?.getText() || 'any'}`).join(', ');
        const returnType = method.getReturnType()?.getText() || 'void';
        interfaceText += `  ${name}(${params}): ${returnType};\n`;
      });

      interfaceText += '}\n\n';

      // Insert interface before class
      const classStart = classDecl.getStart();
      sourceFile.insertText(classStart, interfaceText);

      return {
        success: true,
        changes: [
          `Extracted interface ${interfaceName} from class ${className}`,
          `Added ${publicMethods.length} methods and ${publicProperties.length} properties to interface`
        ],
        errors: [],
        newCode: sourceFile.getFullText(),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to extract interface: ${error}`],
      };
    }
  }

  async extractTypeAlias(
    filePath: string,
    sourceTypeName: string,
    newTypeName: string
  ): Promise<RefactoringResult> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find type alias or interface to extract from
      const typeAlias = sourceFile.getTypeAlias(sourceTypeName);
      const interfaceDecl = sourceFile.getInterface(sourceTypeName);
      
      const sourceDecl = typeAlias || interfaceDecl;
      if (!sourceDecl) {
        return {
          success: false,
          changes: [],
          errors: [`Type '${sourceTypeName}' not found in file`],
        };
      }

      let typeText: string;
      if (typeAlias) {
        typeText = `type ${newTypeName} = ${typeAlias.getTypeNode()?.getText() || 'any'};\n\n`;
      } else if (interfaceDecl) {
        // Convert interface to type alias
        const members = interfaceDecl.getMembers().map(m => m.getText()).join('\n  ');
        typeText = `type ${newTypeName} = {\n  ${members}\n};\n\n`;
      } else {
        typeText = `type ${newTypeName} = any;\n\n`;
      }

      // Insert new type alias before the source declaration
      const sourceStart = sourceDecl.getStart();
      sourceFile.insertText(sourceStart, typeText);

      return {
        success: true,
        changes: [`Extracted type alias ${newTypeName} from ${sourceTypeName}`],
        errors: [],
        newCode: sourceFile.getFullText(),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to extract type alias: ${error}`],
      };
    }
  }

  async convertToArrowFunction(
    filePath: string,
    functionName: string,
    preserveThis: boolean = true
  ): Promise<RefactoringResult> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      
      // Find the function declaration
      const functionDecl = sourceFile.getFunction(functionName);
      if (!functionDecl) {
        return {
          success: false,
          changes: [],
          errors: [`Function '${functionName}' not found in file`],
        };
      }

      // Check if function uses 'this' and preserveThis is true
      const functionText = functionDecl.getText();
      if (preserveThis && functionText.includes('this.')) {
        return {
          success: false,
          changes: [],
          errors: [`Function '${functionName}' uses 'this' context. Set preserveThis to false to convert anyway.`],
        };
      }

      // Get function details
      const params = functionDecl.getParameters().map(p => p.getText()).join(', ');
      const returnType = functionDecl.getReturnTypeNode()?.getText();
      const body = functionDecl.getBody()?.getText();
      
      if (!body) {
        return {
          success: false,
          changes: [],
          errors: [`Function '${functionName}' has no body`],
        };
      }

      // Generate arrow function
      const returnTypeText = returnType ? `: ${returnType}` : '';
      const arrowFunction = `const ${functionName} = (${params})${returnTypeText} => ${body};`;

      // Replace function declaration with arrow function
      functionDecl.replaceWithText(arrowFunction);

      return {
        success: true,
        changes: [`Converted function '${functionName}' to arrow function`],
        errors: [],
        newCode: sourceFile.getFullText(),
      };
    } catch (error) {
      return {
        success: false,
        changes: [],
        errors: [`Failed to convert to arrow function: ${error}`],
      };
    }
  }

  dispose(): void {
    // Clean up ts-morph project
    this.project = new Project();
  }
}