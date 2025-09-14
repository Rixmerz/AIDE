/**
 * Enhanced AST Utilities for AIDE MCP Server
 * 
 * Advanced TypeScript AST manipulation capabilities with extended functionality
 */

import { 
  Project, 
  SourceFile, 
  Node, 
  SyntaxKind, 
  ImportDeclaration,
  FunctionDeclaration,
  ArrowFunction,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  VariableDeclaration,
  PropertyAssignment,
  MethodDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
  CallExpression,
  PropertyAccessExpression,
  Identifier,
  ts
} from 'ts-morph';
import type { Logger } from './logger.js';
import { TypeScriptAnalysisError } from './errors.js';

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  maintainabilityIndex: number;
  cognitiveComplexity: number;
}

export interface CodeSmell {
  type: 'long-function' | 'long-class' | 'too-many-parameters' | 'deep-nesting' | 'god-class' | 'complex-conditional' | 'duplicate-conditional' | 'data-clump' | 'feature-envy' | 'magic-number';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  startLine: number;
  endLine: number;
  suggestion?: string;
}

export interface DuplicateCode {
  files: string[];
  startLines: number[];
  endLines: number[];
  similarity: number;
  codeBlock: string;
  suggestion: string;
}

export interface TypeEvolutionSuggestion {
  type: 'interface-to-type' | 'type-to-interface' | 'extract-common' | 'merge-interfaces';
  target: string;
  reason: string;
  before: string;
  after: string;
}

export interface AsyncOpportunity {
  line: number;
  type: 'callback-to-promise' | 'promise-to-async' | 'sync-to-async';
  confidence: number;
  suggestion: string;
}

export interface VariableUsagePattern {
  name: string;
  declarations: number;
  reassignments: number;
  scope: 'block' | 'function' | 'module';
  suggestedType: 'const' | 'let' | 'var';
  usageSpan: number;
}

export interface ImportInfo {
  specifier: string;
  namedImports: string[];
  defaultImport: string | null;
  path: string;
  isUsed: boolean;
}

export class ASTUtilsEnhanced {
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

  // Enhanced source file management
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

  // Complexity analysis
  async analyzeComplexity(filePath: string): Promise<ComplexityMetrics[]> {
    const sourceFile = await this.getSourceFile(filePath);
    const functions = sourceFile.getFunctions();
    const methods = sourceFile.getClasses().flatMap(cls => cls.getMethods());
    
    const allFunctions = [...functions, ...methods];
    
    return allFunctions.map(fn => this.calculateComplexity(fn));
  }

  private calculateComplexity(fn: FunctionDeclaration | MethodDeclaration): ComplexityMetrics {
    let cyclomaticComplexity = 1; // Base complexity
    let cognitiveComplexity = 0;
    
    // Count decision points for cyclomatic complexity
    fn.forEachDescendant((node) => {
      switch (node.getKind()) {
        case SyntaxKind.IfStatement:
        case SyntaxKind.WhileStatement:
        case SyntaxKind.ForStatement:
        case SyntaxKind.ForInStatement:
        case SyntaxKind.ForOfStatement:
        case SyntaxKind.DoStatement:
        case SyntaxKind.SwitchStatement:
        case SyntaxKind.CatchClause:
        case SyntaxKind.ConditionalExpression:
          cyclomaticComplexity++;
          cognitiveComplexity += this.getCognitiveWeight(node);
          break;
        case SyntaxKind.CaseClause:
          cyclomaticComplexity++;
          break;
      }
    });

    const linesOfCode = fn.getEndLineNumber() - fn.getStartLineNumber() + 1;
    const maintainabilityIndex = this.calculateMaintainabilityIndex(cyclomaticComplexity, linesOfCode);

    return {
      cyclomaticComplexity,
      linesOfCode,
      maintainabilityIndex,
      cognitiveComplexity
    };
  }

  private getCognitiveWeight(node: Node): number {
    const depth = this.getNodeDepth(node);
    const baseWeight = 1;
    
    switch (node.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.ForStatement:
        return baseWeight + depth;
      case SyntaxKind.SwitchStatement:
        return baseWeight + depth;
      default:
        return baseWeight;
    }
  }

  private getNodeDepth(node: Node): number {
    let depth = 0;
    let current = node.getParent();
    
    while (current) {
      if (this.isComplexityNode(current)) {
        depth++;
      }
      current = current.getParent();
    }
    
    return depth;
  }

  private isComplexityNode(node: Node): boolean {
    return [
      SyntaxKind.IfStatement,
      SyntaxKind.WhileStatement,
      SyntaxKind.ForStatement,
      SyntaxKind.ForInStatement,
      SyntaxKind.ForOfStatement,
      SyntaxKind.DoStatement,
      SyntaxKind.SwitchStatement,
      SyntaxKind.TryStatement
    ].includes(node.getKind());
  }

  private calculateMaintainabilityIndex(complexity: number, linesOfCode: number): number {
    // Microsoft's Maintainability Index formula (simplified)
    const volume = linesOfCode * Math.log2(complexity + 1);
    const mi = Math.max(0, ((171 - 5.2 * Math.log(volume) - 0.23 * complexity) / 171) * 100);
    return Math.round(mi);
  }

  // Comprehensive code smell detection
  async detectCodeSmells(filePath: string): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = [];

    try {
      const sourceFile = await this.getSourceFile(filePath);
      const content = sourceFile.getFullText();
      const lines = content.split('\n');

      // Multi-strategy detection
      smells.push(...await this.detectWithTsMorph(sourceFile));
      smells.push(...this.detectWithRegexPatterns(content, lines));
      smells.push(...this.detectComplexitySmells(content, lines));
      smells.push(...this.detectStructuralSmells(content, lines));

      // Remove duplicates and sort by severity
      return this.deduplicateSmells(smells);

    } catch (error) {
      this.logger?.warn(`Error in AST analysis for ${filePath}, falling back to regex analysis:`, error);

      // Fallback: pure regex-based analysis
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      smells.push(...this.detectWithRegexPatterns(content, lines));
      smells.push(...this.detectComplexitySmells(content, lines));
      smells.push(...this.detectStructuralSmells(content, lines));

      return this.deduplicateSmells(smells);
    }
  }

  private async detectWithTsMorph(sourceFile: any): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = [];

    try {
      // Check for long functions
      sourceFile.getFunctions().forEach((fn: any) => {
        const lines = fn.getEndLineNumber() - fn.getStartLineNumber() + 1;
        if (lines > 50) {
          smells.push({
            type: 'long-function',
            severity: lines > 100 ? 'critical' : lines > 75 ? 'high' : 'medium',
            message: `Function '${fn.getName() || 'anonymous'}' is too long (${lines} lines)`,
            startLine: fn.getStartLineNumber(),
            endLine: fn.getEndLineNumber(),
            suggestion: 'Consider breaking this function into smaller, more focused functions'
          });
        }

        // Check parameter count
        const params = fn.getParameters().length;
        if (params > 5) {
          smells.push({
            type: 'too-many-parameters',
            severity: params > 8 ? 'high' : 'medium',
            message: `Function '${fn.getName() || 'anonymous'}' has too many parameters (${params})`,
            startLine: fn.getStartLineNumber(),
            endLine: fn.getStartLineNumber(),
            suggestion: 'Consider using an options object or breaking the function apart'
          });
        }
      });

      // Check for long classes
      sourceFile.getClasses().forEach((cls: any) => {
        const lines = cls.getEndLineNumber() - cls.getStartLineNumber() + 1;
        if (lines > 300) {
          smells.push({
            type: 'long-class',
            severity: lines > 500 ? 'critical' : 'high',
            message: `Class '${cls.getName() || 'anonymous'}' is too long (${lines} lines)`,
            startLine: cls.getStartLineNumber(),
            endLine: cls.getEndLineNumber(),
            suggestion: 'Consider splitting this class using composition or inheritance'
          });
        }

        // Check for god classes (too many methods)
        const methods = cls.getMethods().length;
        if (methods > 20) {
          smells.push({
            type: 'god-class',
            severity: methods > 30 ? 'critical' : 'high',
            message: `Class '${cls.getName() || 'anonymous'}' has too many methods (${methods})`,
            startLine: cls.getStartLineNumber(),
            endLine: cls.getStartLineNumber(),
            suggestion: 'Consider using composition to distribute responsibilities'
          });
        }
      });

    } catch (error) {
      this.logger?.warn('Error in ts-morph analysis:', error);
    }

    return smells;
  }

  private detectWithRegexPatterns(content: string, lines: string[]): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Detect functions and methods using regex
    const functionPatterns = [
      /^(\s*)(function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|async\s+function\s+(\w+)|\w+\s*:\s*(?:async\s+)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?:=>\s*)?{)/,
      /^(\s*)(\w+)\s*\([^)]*\)\s*{/,
      /^(\s*)([\w$]+)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Check each function pattern
      for (const pattern of functionPatterns) {
        const match = line.match(pattern);
        if (match) {
          const functionName = match[3] || match[4] || match[5] || match[6] || match[2] || 'anonymous';
          const startLine = i;
          const indentation = match[1]?.length || 0;

          // Find function end
          let endLine = this.findFunctionEnd(lines, startLine, indentation);
          const functionLines = endLine - startLine + 1;

          if (functionLines > 50) {
            smells.push({
              type: 'long-function',
              severity: functionLines > 100 ? 'critical' : functionLines > 75 ? 'high' : 'medium',
              message: `Function '${functionName}' is too long (${functionLines} lines)`,
              startLine: startLine + 1,
              endLine: endLine + 1,
              suggestion: 'Consider breaking this function into smaller, more focused functions'
            });
          }

          // Check parameter count
          const paramMatch = line.match(/\(([^)]*)\)/);
          if (paramMatch) {
            const paramString = paramMatch[1] || '';
            const paramCount = paramString.trim() ? paramString.split(',').length : 0;

            if (paramCount > 5) {
              smells.push({
                type: 'too-many-parameters',
                severity: paramCount > 8 ? 'high' : 'medium',
                message: `Function '${functionName}' has too many parameters (${paramCount})`,
                startLine: startLine + 1,
                endLine: startLine + 1,
                suggestion: 'Consider using an options object or breaking the function apart'
              });
            }
          }
          break;
        }
      }

      // Detect classes
      const classMatch = line.match(/^(\s*)(class\s+(\w+)|export\s+class\s+(\w+))/);
      if (classMatch) {
        const className = classMatch[3] || classMatch[4] || 'anonymous';
        const startLine = i;
        const indentation = classMatch[1]?.length || 0;

        let endLine = this.findFunctionEnd(lines, startLine, indentation);
        const classLines = endLine - startLine + 1;

        if (classLines > 300) {
          smells.push({
            type: 'long-class',
            severity: classLines > 500 ? 'critical' : 'high',
            message: `Class '${className}' is too long (${classLines} lines)`,
            startLine: startLine + 1,
            endLine: endLine + 1,
            suggestion: 'Consider splitting this class using composition or inheritance'
          });
        }

        // Count methods in class
        const classContent = lines.slice(startLine, endLine + 1).join('\n');
        const methodCount = (classContent.match(/^\s*\w+\s*\([^)]*\)\s*[{]/gm) || []).length;

        if (methodCount > 20) {
          smells.push({
            type: 'god-class',
            severity: methodCount > 30 ? 'critical' : 'high',
            message: `Class '${className}' has too many methods (${methodCount})`,
            startLine: startLine + 1,
            endLine: startLine + 1,
            suggestion: 'Consider using composition to distribute responsibilities'
          });
        }
      }
    }

    return smells;
  }

  private detectComplexitySmells(content: string, lines: string[]): CodeSmell[] {
    const smells: CodeSmell[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Detect deeply nested code
      const indentation = line.length - line.trimStart().length;
      if (indentation > 24) { // More than 6 levels deep
        smells.push({
          type: 'deep-nesting',
          severity: indentation > 32 ? 'high' : 'medium',
          message: `Deeply nested code detected (${Math.floor(indentation / 4)} levels)`,
          startLine: i + 1,
          endLine: i + 1,
          suggestion: 'Consider extracting nested logic into separate functions or using guard clauses'
        });
      }

      // Detect complex conditionals
      const conditionalComplexity = (line.match(/&&|\|\|/g) || []).length;
      if (conditionalComplexity > 3) {
        smells.push({
          type: 'complex-conditional',
          severity: conditionalComplexity > 6 ? 'high' : 'medium',
          message: `Complex conditional with ${conditionalComplexity + 1} conditions`,
          startLine: i + 1,
          endLine: i + 1,
          suggestion: 'Consider extracting conditions into separate boolean variables or functions'
        });
      }

      // Detect duplicate conditionals
      if (line.trim().startsWith('if')) {
        const condition = line.match(/if\s*\((.*?)\)/)?.[1];
        if (condition) {
          for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
            const nextLine = lines[j] || '';
            if (nextLine.includes(condition) && nextLine.trim().startsWith('if')) {
              smells.push({
                type: 'duplicate-conditional',
                severity: 'medium',
                message: `Duplicate conditional logic detected`,
                startLine: i + 1,
                endLine: j + 1,
                suggestion: 'Consider extracting common conditional logic into a separate function'
              });
              break;
            }
          }
        }
      }
    }

    return smells;
  }

  private detectStructuralSmells(content: string, lines: string[]): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Detect data clumps (repeated parameter groups)
    const parameterGroups = new Map<string, number[]>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const paramMatch = line.match(/\(([^)]+)\)/);

      if (paramMatch) {
        const params = (paramMatch[1] || '')
          .split(',')
          .map(p => p.trim().split(/\s+/).pop() || '')
          .filter(p => p.length > 0)
          .sort()
          .join(',');

        if (params.split(',').length >= 3) {
          if (!parameterGroups.has(params)) {
            parameterGroups.set(params, []);
          }
          parameterGroups.get(params)?.push(i);
        }
      }
    }

    parameterGroups.forEach((lineNumbers, params) => {
      if (lineNumbers.length > 2) {
        smells.push({
          type: 'data-clump',
          severity: 'medium',
          message: `Data clump detected: parameters (${params}) appear together ${lineNumbers.length} times`,
          startLine: lineNumbers[0]! + 1,
          endLine: lineNumbers[lineNumbers.length - 1]! + 1,
          suggestion: 'Consider creating a data class or object to group these related parameters'
        });
      }
    });

    // Detect feature envy (methods using other class data extensively)
    const accessPatterns = content.match(/\w+\.\w+/g) || [];
    const accessCounts = new Map<string, number>();

    accessPatterns.forEach(pattern => {
      const obj = pattern.split('.')[0];
      if (obj !== 'this') {
        accessCounts.set(obj || '', (accessCounts.get(obj || '') || 0) + 1);
      }
    });

    accessCounts.forEach((count, obj) => {
      if (count > 8) {
        smells.push({
          type: 'feature-envy',
          severity: count > 15 ? 'high' : 'medium',
          message: `Possible feature envy: excessive use of '${obj}' object (${count} accesses)`,
          startLine: 1,
          endLine: lines.length,
          suggestion: `Consider moving functionality closer to the '${obj}' class or extracting a collaboration class`
        });
      }
    });

    // Detect magic numbers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const magicNumbers = line.match(/\b(?!0|1)\d{2,}\b/g);

      if (magicNumbers) {
        magicNumbers.forEach(number => {
          if (!line.includes('//') && !line.includes('VERSION') && !line.includes('PORT')) {
            smells.push({
              type: 'magic-number',
              severity: 'low',
              message: `Magic number detected: ${number}`,
              startLine: i + 1,
              endLine: i + 1,
              suggestion: 'Consider extracting this number into a named constant with descriptive name'
            });
          }
        });
      }
    }

    return smells;
  }

  private findFunctionEnd(lines: string[], startLine: number, baseIndentation: number): number {
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i] || '';

      // Count braces
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            return i;
          }
        }
      }

      // Fallback: check indentation
      if (foundOpenBrace && i > startLine) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          const currentIndentation = line.length - line.trimStart().length;
          if (currentIndentation <= baseIndentation && trimmed !== '}' && !trimmed.startsWith('//')) {
            return i - 1;
          }
        }
      }
    }

    return Math.min(startLine + 100, lines.length - 1); // Cap at 100 lines
  }

  private deduplicateSmells(smells: CodeSmell[]): CodeSmell[] {
    const seen = new Set<string>();
    const uniqueSmells: CodeSmell[] = [];

    // Sort by severity first, then by line
    smells.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return a.startLine - b.startLine;
    });

    for (const smell of smells) {
      const key = `${smell.type}:${smell.startLine}:${smell.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSmells.push(smell);
      }
    }

    return uniqueSmells;
  }

  // Type evolution suggestions
  async analyzeTypeEvolution(filePath: string): Promise<TypeEvolutionSuggestion[]> {
    const sourceFile = await this.getSourceFile(filePath);
    const suggestions: TypeEvolutionSuggestion[] = [];

    // Check interfaces that could be types
    sourceFile.getInterfaces().forEach(iface => {
      const properties = iface.getProperties();
      const hasOnlyProperties = properties.length > 0 && 
        iface.getMethods().length === 0 && 
        iface.getGetAccessors().length === 0 && 
        iface.getSetAccessors().length === 0;

      if (hasOnlyProperties && !this.isExtended(iface)) {
        suggestions.push({
          type: 'interface-to-type',
          target: iface.getName(),
          reason: 'Interface only contains properties and is not extended',
          before: iface.getText(),
          after: this.convertInterfaceToType(iface)
        });
      }
    });

    // Check types that could benefit from being interfaces
    sourceFile.getTypeAliases().forEach(type => {
      const typeNode = type.getTypeNode();
      if (typeNode && Node.isTypeLiteral(typeNode)) {
        const members = typeNode.getMembers();
        if (members.length > 5) {
          suggestions.push({
            type: 'type-to-interface',
            target: type.getName(),
            reason: 'Large type alias would benefit from interface extensibility',
            before: type.getText(),
            after: this.convertTypeToInterface(type)
          });
        }
      }
    });

    return suggestions;
  }

  private isExtended(iface: InterfaceDeclaration): boolean {
    const sourceFile = iface.getSourceFile();
    return sourceFile.getInterfaces().some(other => 
      other !== iface && 
      other.getExtends().some(ext => ext.getExpression().getText() === iface.getName())
    );
  }

  private convertInterfaceToType(iface: InterfaceDeclaration): string {
    const name = iface.getName();
    const properties = iface.getProperties();
    const typeProps = properties.map(prop => prop.getText()).join('\n  ');
    
    return `type ${name} = {\n  ${typeProps}\n};`;
  }

  private convertTypeToInterface(type: TypeAliasDeclaration): string {
    const name = type.getName();
    const typeNode = type.getTypeNode();
    
    if (typeNode && Node.isTypeLiteral(typeNode)) {
      const members = typeNode.getMembers().map(member => member.getText()).join('\n  ');
      return `interface ${name} {\n  ${members}\n}`;
    }
    
    return type.getText();
  }

  // Async opportunity detection
  async detectAsyncOpportunities(filePath: string): Promise<AsyncOpportunity[]> {
    const sourceFile = await this.getSourceFile(filePath);
    const opportunities: AsyncOpportunity[] = [];

    // Find callback patterns
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const args = node.getArguments();
        const lastArg = args[args.length - 1];
        
        // Look for callback patterns
        if (Node.isArrowFunction(lastArg) || Node.isFunctionExpression(lastArg)) {
          const params = lastArg.getParameters();
          if (params.length > 0 && params[0]?.getName().toLowerCase().includes('err')) {
            opportunities.push({
              line: node.getStartLineNumber(),
              type: 'callback-to-promise',
              confidence: 0.8,
              suggestion: 'Convert error-first callback to Promise-based approach'
            });
          }
        }
      }

      // Find Promise chains that could use async/await
      if (Node.isPropertyAccessExpression(node) && node.getName() === 'then') {
        const chains = this.countPromiseChains(node);
        if (chains > 2) {
          opportunities.push({
            line: node.getStartLineNumber(),
            type: 'promise-to-async',
            confidence: 0.9,
            suggestion: `Promise chain with ${chains} .then() calls could use async/await`
          });
        }
      }
    });

    return opportunities;
  }

  private countPromiseChains(node: PropertyAccessExpression): number {
    let count = 1;
    let current = node.getParent();
    
    while (current && Node.isCallExpression(current)) {
      const expression = current.getExpression();
      if (Node.isPropertyAccessExpression(expression) && 
          (expression.getName() === 'then' || expression.getName() === 'catch')) {
        count++;
        current = current.getParent();
      } else {
        break;
      }
    }
    
    return count;
  }

  // Variable usage analysis
  async analyzeVariableUsage(filePath: string): Promise<VariableUsagePattern[]> {
    const sourceFile = await this.getSourceFile(filePath);
    const patterns: VariableUsagePattern[] = [];
    const variableUsage = new Map<string, {
      declarations: number;
      reassignments: number;
      firstLine: number;
      lastLine: number;
      scope: string;
    }>();

    // Collect variable information
    sourceFile.forEachDescendant((node) => {
      if (Node.isVariableDeclaration(node)) {
        const name = node.getName();
        const existing = variableUsage.get(name) || {
          declarations: 0,
          reassignments: 0,
          firstLine: node.getStartLineNumber(),
          lastLine: node.getStartLineNumber(),
          scope: this.getVariableScope(node)
        };
        
        existing.declarations++;
        variableUsage.set(name, existing);
      }

      if (Node.isIdentifier(node) && this.isReassignment(node)) {
        const name = node.getText();
        const existing = variableUsage.get(name);
        if (existing) {
          existing.reassignments++;
          existing.lastLine = Math.max(existing.lastLine, node.getStartLineNumber());
        }
      }
    });

    // Generate patterns
    variableUsage.forEach((usage, name) => {
      const suggestedType = usage.reassignments === 0 ? 'const' : 'let';
      const usageSpan = usage.lastLine - usage.firstLine;
      
      patterns.push({
        name,
        declarations: usage.declarations,
        reassignments: usage.reassignments,
        scope: usage.scope as 'block' | 'function' | 'module',
        suggestedType,
        usageSpan
      });
    });

    return patterns;
  }

  private getVariableScope(node: VariableDeclaration): string {
    let current: Node | undefined = node.getParent();
    
    while (current) {
      if (Node.isFunctionDeclaration(current) || Node.isArrowFunction(current)) {
        return 'function';
      }
      if (Node.isBlock(current)) {
        return 'block';
      }
      const parent = current.getParent();
      current = parent;
    }
    
    return 'module';
  }

  private isReassignment(node: Identifier): boolean {
    const parent = node.getParent();
    return parent && 
           (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken ||
            Node.isPostfixUnaryExpression(parent) || 
            Node.isPrefixUnaryExpression(parent));
  }

  // Enhanced refactoring operations
  async extractInterface(filePath: string, className: string): Promise<{ success: boolean; interfaceName: string; interfaceCode: string; }> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const classDecl = sourceFile.getClass(className);
      
      if (!classDecl) {
        return { success: false, interfaceName: '', interfaceCode: '' };
      }

      const interfaceName = `I${className}`;
      const methods = classDecl.getMethods().filter(method => method.hasModifier(SyntaxKind.PublicKeyword) || !method.getModifiers().length);
      const properties = classDecl.getProperties().filter(prop => prop.hasModifier(SyntaxKind.PublicKeyword) || !prop.getModifiers().length);

      let interfaceCode = `interface ${interfaceName} {\n`;
      
      // Add properties
      properties.forEach(prop => {
        const name = prop.getName();
        const type = prop.getType().getText();
        interfaceCode += `  ${name}: ${type};\n`;
      });

      // Add methods
      methods.forEach(method => {
        const name = method.getName();
        const params = method.getParameters().map(p => `${p.getName()}: ${p.getType().getText()}`).join(', ');
        const returnType = method.getReturnType().getText();
        interfaceCode += `  ${name}(${params}): ${returnType};\n`;
      });

      interfaceCode += '}';

      return { success: true, interfaceName, interfaceCode };
    } catch (error) {
      this.logger.error(`Error extracting interface: ${error}`);
      return { success: false, interfaceName: '', interfaceCode: '' };
    }
  }

  async convertToArrowFunction(filePath: string, functionName: string): Promise<{ success: boolean; newCode: string; }> {
    try {
      const sourceFile = await this.getSourceFile(filePath);
      const func = sourceFile.getFunction(functionName);
      
      if (!func) {
        return { success: false, newCode: '' };
      }

      const params = func.getParameters().map(p => p.getText()).join(', ');
      const body = func.getBody()?.getText() || '{}';
      const returnType = func.getReturnTypeNode()?.getText() || '';
      const returnTypeSuffix = returnType ? `: ${returnType}` : '';
      
      const newCode = `const ${functionName} = (${params})${returnTypeSuffix} => ${body}`;
      
      return { success: true, newCode };
    } catch (error) {
      this.logger.error(`Error converting to arrow function: ${error}`);
      return { success: false, newCode: '' };
    }
  }

  async analyzeImports(filePath: string): Promise<ImportInfo[]> {
    try {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        this.logger.warn(`File not found: ${filePath}`);
        return [];
      }

      const imports: ImportInfo[] = [];
      
      sourceFile.getImportDeclarations().forEach(importDecl => {
        const specifier = importDecl.getModuleSpecifier().getLiteralValue();
        const namedImports = importDecl.getNamedImports().map(ni => ni.getName());
        const defaultImport = importDecl.getDefaultImport()?.getText();
        
        imports.push({
          specifier,
          namedImports,
          defaultImport: defaultImport || null,
          path: filePath,
          isUsed: true // For now, assume all imports are used - could analyze usage later
        });
      });

      return imports;
    } catch (error) {
      this.logger.error(`Error analyzing imports: ${error}`);
      return [];
    }
  }

  // Cleanup
  dispose(): void {
    // Clean up project resources if needed
    this.logger.info('ASTUtilsEnhanced disposed');
  }
}