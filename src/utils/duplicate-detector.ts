/**
 * Enhanced DuplicateDetector for AIDE MCP Server
 * 
 * Detects code duplicates using multiple similarity algorithms:
 * - Token-based analysis with Jaccard similarity
 * - Line-based similarity with Levenshtein distance  
 * - Hash-based exact matching
 * - Configurable thresholds and filtering
 */

export interface CodeBlock {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string;
  tokens: string[];
  ast?: any;
}

export interface DuplicateInstance {
  file: string;
  startLine: number;
  endLine: number;
  codeBlock: string;
  hash: string;
  context: string;
}

export interface RefactoringSuggestion {
  type: 'extract-function' | 'extract-class' | 'extract-utility' | 'create-component';
  name: string;
  description: string;
  extractedCode: string;
  parameters: string[];
  benefit: string;
}

export interface DuplicateClone {
  files: DuplicateInstance[];
  similarity: number;
  linesOfCode: number;
  tokenCount: number;
  type: 'exact' | 'similar' | 'structural';
  suggestion: RefactoringSuggestion;
}

export interface DuplicationMetrics {
  totalFiles: number;
  duplicateBlocks: number;
  duplicateLines: number;
  duplicationPercentage: number;
  duplicatedPercentage: number;
  avgBlockSize: number;
  riskScore: number;
}

export class DuplicateDetector {
  private logger: any;
  private options: {
    minLines: number;
    minTokens: number;
    ignoreWhitespace: boolean;
    ignoreComments: boolean;
    ignoreImports: boolean;
    similarityThreshold: number;
  };

  constructor(logger?: any, options: any = {}) {
    this.logger = logger || console;
    this.options = {
      minLines: options.minLines || 5,
      minTokens: options.minTokens || 50,
      ignoreWhitespace: options.ignoreWhitespace !== false,
      ignoreComments: options.ignoreComments !== false,
      ignoreImports: options.ignoreImports !== false,
      similarityThreshold: options.similarityThreshold || 0.85,
      ...options
    };
  }

  async detectDuplicates(filePattern: string): Promise<DuplicateClone[]> {
    try {
      // Get files to analyze
      const glob = await import('glob');
      const fs = await import('fs');
      const path = await import('path');
      
      const files = glob.globSync(filePattern);
      this.logger.info(`Analyzing ${files.length} files for duplicates`);
      
      if (files.length === 0) {
        return [];
      }

      // Extract code blocks from all files
      const allBlocks: CodeBlock[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          this.logger.info(`Processing file ${file}, content length: ${content.length}`);
          const blocks = this.extractCodeBlocks(file, content);
          this.logger.info(`Extracted ${blocks.length} blocks from ${file}`);
          allBlocks.push(...blocks);
        } catch (error) {
          this.logger.warn(`Failed to process file ${file}:`, error);
        }
      }

      this.logger.info(`Total extracted ${allBlocks.length} code blocks`);

      // Find duplicates using similarity analysis
      const clones = this.findSimilarBlocks(allBlocks);

      this.logger.info(`Found ${clones.length} duplicate groups`);
      return clones;
      
    } catch (error) {
      this.logger.error('Error detecting duplicates:', error);
      return [];
    }
  }

  private extractCodeBlocks(filePath: string, content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const lines = content.split('\n');

    this.logger?.debug(`Extracting blocks from ${filePath} with ${lines.length} lines`);

    // Strategy 1: Extract function and method blocks
    const functionBlocks = this.extractFunctionBlocks(filePath, content, lines);
    this.logger?.debug(`Found ${functionBlocks.length} function blocks`);
    blocks.push(...functionBlocks);

    // Strategy 2: Extract class blocks
    const classBlocks = this.extractClassBlocks(filePath, content, lines);
    this.logger?.debug(`Found ${classBlocks.length} class blocks`);
    blocks.push(...classBlocks);

    // Strategy 3: Extract statement blocks (if/else, loops, try/catch)
    const statementBlocks = this.extractStatementBlocks(filePath, content, lines);
    this.logger?.debug(`Found ${statementBlocks.length} statement blocks`);
    blocks.push(...statementBlocks);

    // Strategy 4: Multi-size sliding window (improved)
    const windowBlocks = this.extractSlidingWindowBlocks(filePath, content, lines);
    this.logger?.debug(`Found ${windowBlocks.length} sliding window blocks`);
    blocks.push(...windowBlocks);

    // Remove duplicates and sort by quality
    const finalBlocks = this.deduplicateAndRankBlocks(blocks);
    this.logger?.debug(`Final block count after deduplication: ${finalBlocks.length}`);

    return finalBlocks;
  }

  private extractFunctionBlocks(filePath: string, content: string, lines: string[]): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    // Simplified and more inclusive regex for function detection
    const functionRegex = /^(\s*)(function\s+\w+|const\s+\w+\s*=|async\s+function|\w+\s*\([^)]*\)\s*{|function\s*\([^)]*\)|[\w$]+\s*:\s*function)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const match = line.match(functionRegex);

      if (match) {
        this.logger?.debug(`Function match found on line ${i + 1}: ${line.trim()}`);
      } else if (line.trim().startsWith('function')) {
        this.logger?.debug(`Function keyword found but no regex match on line ${i + 1}: ${line.trim()}`);
      }

      if (match) {
        const startLine = i;
        const indentation = match[1]?.length || 0;
        let endLine = this.findBlockEnd(lines, startLine, indentation);

        this.logger?.debug(`Block end found: line ${startLine + 1} to ${endLine + 1} (${endLine - startLine + 1} lines)`);

        if (endLine > startLine + 3) { // Minimum function size
          const blockContent = lines.slice(startLine, endLine + 1).join('\n');
          const processedContent = this.preprocessContent(blockContent);

          this.logger?.debug(`Block content length: ${blockContent.length}, processed length: ${processedContent.length}`);

          this.logger?.debug(`Checking block validity: lines ${startLine + 1}-${endLine + 1}`);
          if (this.isValidBlock(blockContent, processedContent)) {
            const tokens = this.tokenizeCode(processedContent);

            this.logger?.debug(`Block tokens: ${tokens.length}, required: ${this.options.minTokens}, valid block passed`);
            this.logger?.debug(`First 10 tokens: [${tokens.slice(0, 10).join(', ')}]`);

            if (tokens.length >= this.options.minTokens) {
              this.logger?.debug(`Adding block: ${startLine + 1}-${endLine + 1} with ${tokens.length} tokens`);
              blocks.push({
                file: filePath,
                startLine: startLine + 1,
                endLine: endLine + 1,
                content: blockContent,
                hash: this.createHash(processedContent),
                tokens,
                ast: undefined
              });
            } else {
              this.logger?.debug(`Block rejected: only ${tokens.length} tokens, need ${this.options.minTokens}`);
            }
          }
        }
      }
    }

    return blocks;
  }

  private extractClassBlocks(filePath: string, content: string, lines: string[]): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const classRegex = /^(\s*)(class\s+\w+|export\s+class\s+\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line?.match(classRegex);

      if (match) {
        const startLine = i;
        const indentation = match[1]?.length || 0;
        let endLine = this.findBlockEnd(lines, startLine, indentation);

        if (endLine > startLine + 5) { // Minimum class size
          const blockContent = lines.slice(startLine, endLine + 1).join('\n');
          const processedContent = this.preprocessContent(blockContent);

          if (this.isValidBlock(blockContent, processedContent)) {
            const tokens = this.tokenizeCode(processedContent);

            if (tokens.length >= this.options.minTokens) {
              blocks.push({
                file: filePath,
                startLine: startLine + 1,
                endLine: endLine + 1,
                content: blockContent,
                hash: this.createHash(processedContent),
                tokens,
                ast: undefined
              });
            }
          }
        }
      }
    }

    return blocks;
  }

  private extractStatementBlocks(filePath: string, content: string, lines: string[]): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const statementRegex = /^(\s*)(if\s*\(|for\s*\(|while\s*\(|try\s*{|switch\s*\()/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line?.match(statementRegex);

      if (match) {
        const startLine = i;
        const indentation = match[1]?.length || 0;
        let endLine = this.findStatementBlockEnd(lines, startLine, indentation);

        if (endLine > startLine + 2 && (endLine - startLine) >= this.options.minLines) {
          const blockContent = lines.slice(startLine, endLine + 1).join('\n');
          const processedContent = this.preprocessContent(blockContent);

          if (this.isValidBlock(blockContent, processedContent)) {
            const tokens = this.tokenizeCode(processedContent);

            if (tokens.length >= this.options.minTokens) {
              blocks.push({
                file: filePath,
                startLine: startLine + 1,
                endLine: endLine + 1,
                content: blockContent,
                hash: this.createHash(processedContent),
                tokens,
                ast: undefined
              });
            }
          }
        }
      }
    }

    return blocks;
  }

  private extractSlidingWindowBlocks(filePath: string, content: string, lines: string[]): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const windowSizes = [10, 15]; // Reduced window sizes
    const stepSize = 3; // Skip positions to reduce overlap
    const maxBlocks = 50; // Limit total blocks from sliding window

    for (const windowSize of windowSizes) {
      if (windowSize < this.options.minLines) continue;
      if (blocks.length >= maxBlocks) break;

      for (let i = 0; i < lines.length - windowSize; i += stepSize) {
        if (blocks.length >= maxBlocks) break;

        const blockLines = lines.slice(i, i + windowSize);
        const blockContent = blockLines.join('\n');
        const processedContent = this.preprocessContent(blockContent);

        if (this.isValidBlock(blockContent, processedContent)) {
          const tokens = this.tokenizeCode(processedContent);

          if (tokens.length >= this.options.minTokens) {
            blocks.push({
              file: filePath,
              startLine: i + 1,
              endLine: i + windowSize,
              content: blockContent,
              hash: this.createHash(processedContent),
              tokens,
              ast: undefined
            });
          }
        }
      }
    }

    return blocks;
  }

  private findBlockEnd(lines: string[], startLine: number, baseIndentation: number): number {
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
    }

    // Fallback: find by indentation
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();

      if (trimmed.length === 0) continue;

      const currentIndentation = line.length - line.trimStart().length;
      if (currentIndentation <= baseIndentation && trimmed !== '}') {
        return i - 1;
      }
    }

    return Math.min(startLine + 50, lines.length - 1); // Cap at 50 lines
  }

  private findStatementBlockEnd(lines: string[], startLine: number, baseIndentation: number): number {
    const startLine_safe = lines[startLine] || '';

    // For single-line statements
    if (!startLine_safe.includes('{')) {
      return startLine;
    }

    return this.findBlockEnd(lines, startLine, baseIndentation);
  }

  private deduplicateAndRankBlocks(blocks: CodeBlock[]): CodeBlock[] {
    const seen = new Set<string>();
    const uniqueBlocks: CodeBlock[] = [];

    // Sort by token count (prefer larger blocks) then by line count
    blocks.sort((a, b) => {
      const tokenDiff = b.tokens.length - a.tokens.length;
      if (tokenDiff !== 0) return tokenDiff;
      return (b.endLine - b.startLine) - (a.endLine - a.startLine);
    });

    for (const block of blocks) {
      const key = `${block.file}:${block.startLine}-${block.endLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueBlocks.push(block);
      }
    }

    return uniqueBlocks;
  }

  private preprocessContent(content: string): string {
    let processed = content;
    
    if (this.options.ignoreComments) {
      // Remove single-line comments
      processed = processed.replace(/\/\/.*$/gm, '');
      // Remove multi-line comments
      processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
    }
    
    if (this.options.ignoreImports) {
      // Remove import statements
      processed = processed.replace(/^import\s+.*$/gm, '');
      processed = processed.replace(/^export\s+.*$/gm, '');
    }
    
    if (this.options.ignoreWhitespace) {
      // Normalize whitespace
      processed = processed.replace(/\s+/g, ' ').trim();
    }
    
    return processed;
  }

  private isValidBlock(originalContent: string, processedContent?: string): boolean {
    const contentToCheck = processedContent || originalContent;
    const trimmed = contentToCheck.trim();

    // Basic length check
    this.logger?.debug(`Validation step 1 - length check: ${trimmed.length} chars (need >= 10)`);
    if (trimmed.length < 10) {
      this.logger?.debug('Block rejected: too short');
      return false;
    }

    // Count original lines in content (before processing)
    const originalLines = originalContent.split('\n');
    this.logger?.debug(`Validation step 2 - line count: ${originalLines.length} lines (need >= 2)`);

    // Skip blocks that are just empty or single lines
    if (originalLines.length < 2) {
      this.logger?.debug('Block rejected: too few lines');
      return false;
    }

    // Count meaningful tokens/elements in processed content
    const meaningfulElements = contentToCheck.match(/\w+|[{}();,=+\-*/<>!&|]/g) || [];
    this.logger?.debug(`Validation step 3 - meaningful elements: ${meaningfulElements.length} elements (need >= 8)`);

    // Basic complexity check - need at least some code elements
    if (meaningfulElements.length < 8) {
      this.logger?.debug('Block rejected: too few meaningful elements');
      return false;
    }

    // Skip blocks that are just comments (check original content)
    const nonCommentLines = originalLines.filter(line => {
      const clean = line.trim();
      return clean.length > 0 &&
             !clean.startsWith('//') &&
             !clean.startsWith('/*') &&
             !clean.startsWith('*') &&
             clean !== '*/';
    });

    this.logger?.debug(`Validation step 4 - non-comment lines: ${nonCommentLines.length} lines (need >= 2)`);
    const isValid = nonCommentLines.length >= 2;

    if (!isValid) {
      this.logger?.debug(`Block rejected: ${nonCommentLines.length} non-comment lines, ${meaningfulElements.length} elements`);
    } else {
      this.logger?.debug(`Block accepted: ${nonCommentLines.length} lines, ${meaningfulElements.length} elements`);
    }

    return isValid;
  }

  private tokenizeCode(content: string): string[] {
    // Advanced tokenization that preserves semantic meaning
    const tokens: string[] = [];

    // Remove strings and comments first but keep placeholders
    let cleaned = content
      .replace(/"([^"\\]|\\.)*"/g, '"STRING"')
      .replace(/'([^'\\]|\\.)*'/g, "'STRING'")
      .replace(/`([^`\\]|\\.)*`/g, '`TEMPLATE`')
      .replace(/\/\*[\s\S]*?\*\//g, '/*COMMENT*/')
      .replace(/\/\/.*$/gm, '//COMMENT');

    // Tokenize preserving meaningful constructs
    const tokenRegex = /(\w+(?:\.\w+)*|\w+\[[\w\s]*\]|\w+\(|\w+\+\+|--\w+|\w+--|\+\+\w+|&&|\|\||===|!==|==|!=|<=|>=|=>|>>|<<|\*\*|\+\+|--|[a-zA-Z_$][\w$]*|[0-9]+(?:\.[0-9]+)?|[{}()\[\];,\.!&|+\-*/%=<>?:])/g;

    let match;
    while ((match = tokenRegex.exec(cleaned)) !== null) {
      const token = match[0].toLowerCase().trim();

      // Skip very short tokens and pure punctuation
      if (token.length > 0 && !token.match(/^[{}();,\.]+$/)) {
        tokens.push(token);
      }
    }

    // Add n-grams for better similarity detection
    const nGrams = this.generateNGrams(tokens, 2);
    tokens.push(...nGrams);

    return tokens.filter(token => token.length > 0);
  }

  private generateNGrams(tokens: string[], n: number): string[] {
    const nGrams: string[] = [];

    for (let i = 0; i <= tokens.length - n; i++) {
      const nGram = tokens.slice(i, i + n).join('_');
      nGrams.push(nGram);
    }

    return nGrams;
  }

  private createHash(content: string): string {
    // Simple hash function for content comparison
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private findSimilarBlocks(blocks: CodeBlock[]): DuplicateClone[] {
    const clones: DuplicateClone[] = [];
    const processed = new Set<string>();
    
    // Group blocks by hash first (exact matches)
    const hashGroups = new Map<string, CodeBlock[]>();
    blocks.forEach(block => {
      const hash = block.hash;
      if (!hashGroups.has(hash)) {
        hashGroups.set(hash, []);
      }
      hashGroups.get(hash)!.push(block);
    });

    // Process exact matches
    for (const [hash, group] of hashGroups) {
      if (group.length > 1) {
        clones.push(this.createClone(group, 1.0, 'exact'));
        group.forEach(block => processed.add(`${block.file}:${block.startLine}`));
      }
    }

    // Find similar blocks (not exact matches)
    const remainingBlocks = blocks.filter(block => 
      !processed.has(`${block.file}:${block.startLine}`)
    );

    for (let i = 0; i < remainingBlocks.length; i++) {
      for (let j = i + 1; j < remainingBlocks.length; j++) {
        const block1 = remainingBlocks[i]!;
        const block2 = remainingBlocks[j]!;
        
        // Skip if same file and overlapping lines
        if (block1.file === block2.file && this.isOverlapping(block1, block2)) {
          continue;
        }
        
        const similarity = this.calculateSimilarity(block1, block2);
        
        if (similarity >= this.options.similarityThreshold) {
          const existingClone = clones.find(clone => 
            clone.files.some(f => 
              (f.file === block1.file && f.startLine === block1.startLine) ||
              (f.file === block2.file && f.startLine === block2.startLine)
            )
          );
          
          if (existingClone) {
            // Add to existing clone if not already present
            if (!existingClone.files.some(f => f.file === block1.file && f.startLine === block1.startLine)) {
              existingClone.files.push(this.blockToInstance(block1));
            }
            if (!existingClone.files.some(f => f.file === block2.file && f.startLine === block2.startLine)) {
              existingClone.files.push(this.blockToInstance(block2));
            }
            existingClone.similarity = Math.max(existingClone.similarity, similarity);
          } else {
            clones.push(this.createClone([block1, block2], similarity, similarity > 0.95 ? 'similar' : 'structural'));
          }
        }
      }
    }
    
    return clones;
  }

  private calculateSimilarity(block1: CodeBlock, block2: CodeBlock): number {
    // Multi-layered similarity calculation

    // 1. Jaccard similarity for token-based comparison
    const tokens1 = new Set(block1.tokens);
    const tokens2 = new Set(block2.tokens);

    const intersection = new Set([...tokens1].filter(token => tokens2.has(token)));
    const union = new Set([...tokens1, ...tokens2]);

    const jaccardSimilarity = intersection.size / (union.size || 1);

    // 2. Line-based similarity with fuzzy matching
    const lines1 = block1.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const lines2 = block2.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const commonLines = lines1.filter(line =>
      lines2.some(line2 => this.lineSimilarity(line, line2) > 0.7)
    ).length;

    const lineSimilarity = commonLines / Math.max(lines1.length, lines2.length, 1);

    // 3. Structural similarity (analyze code patterns)
    const structuralSimilarity = this.calculateStructuralSimilarity(block1, block2);

    // 4. Sequence similarity (order of operations)
    const sequenceSimilarity = this.calculateSequenceSimilarity(block1.tokens, block2.tokens);

    // 5. Size similarity (prefer blocks of similar size)
    const sizeSimilarity = this.calculateSizeSimilarity(block1, block2);

    // Weighted combination
    return (
      jaccardSimilarity * 0.4 +
      lineSimilarity * 0.25 +
      structuralSimilarity * 0.2 +
      sequenceSimilarity * 0.1 +
      sizeSimilarity * 0.05
    );
  }

  private calculateStructuralSimilarity(block1: CodeBlock, block2: CodeBlock): number {
    // Analyze code structure patterns
    const patterns1 = this.extractStructuralPatterns(block1.content);
    const patterns2 = this.extractStructuralPatterns(block2.content);

    const commonPatterns = patterns1.filter(p => patterns2.includes(p));
    const totalPatterns = new Set([...patterns1, ...patterns2]);

    return commonPatterns.length / (totalPatterns.size || 1);
  }

  private extractStructuralPatterns(content: string): string[] {
    const patterns: string[] = [];

    // Control flow patterns
    if (content.includes('if')) patterns.push('conditional');
    if (content.includes('for') || content.includes('while')) patterns.push('loop');
    if (content.includes('try')) patterns.push('exception');
    if (content.includes('function') || content.includes('=>')) patterns.push('function_def');
    if (content.includes('class')) patterns.push('class_def');
    if (content.includes('return')) patterns.push('return_stmt');

    // Complexity patterns
    const braceCount = (content.match(/{/g) || []).length;
    if (braceCount > 3) patterns.push('nested_blocks');

    const paramCount = (content.match(/\w+\s*\(/g) || []).length;
    if (paramCount > 2) patterns.push('multiple_calls');

    // Variable patterns
    const assignmentCount = (content.match(/\w+\s*=/g) || []).length;
    if (assignmentCount > 2) patterns.push('multiple_assignments');

    return patterns;
  }

  private calculateSequenceSimilarity(tokens1: string[], tokens2: string[]): number {
    // Use longest common subsequence for sequence similarity
    const lcs = this.longestCommonSubsequence(tokens1, tokens2);
    return (2 * lcs) / (tokens1.length + tokens2.length || 1);
  }

  private longestCommonSubsequence(seq1: string[], seq2: string[]): number {
    const m = seq1.length;
    const n = seq2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1] === seq2[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        } else {
          dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
        }
      }
    }

    return dp[m]![n]!;
  }

  private calculateSizeSimilarity(block1: CodeBlock, block2: CodeBlock): number {
    const size1 = block1.endLine - block1.startLine;
    const size2 = block2.endLine - block2.startLine;

    const minSize = Math.min(size1, size2);
    const maxSize = Math.max(size1, size2);

    return minSize / (maxSize || 1);
  }

  private lineSimilarity(line1: string, line2: string): number {
    // Simple edit distance based similarity
    if (line1 === line2) return 1.0;
    
    const maxLen = Math.max(line1.length, line2.length);
    if (maxLen === 0) return 1.0;
    
    const distance = this.levenshteinDistance(line1, line2);
    return 1 - (distance / maxLen);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0]![i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j]![0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1,     // deletion
          matrix[j - 1]![i]! + 1,     // insertion
          matrix[j - 1]![i - 1]! + indicator  // substitution
        );
      }
    }
    
    return matrix[str2.length]![str1.length]!;
  }

  private isOverlapping(block1: CodeBlock, block2: CodeBlock): boolean {
    return !(block1.endLine < block2.startLine || block2.endLine < block1.startLine);
  }

  private createClone(blocks: CodeBlock[], similarity: number, type: 'exact' | 'similar' | 'structural'): DuplicateClone {
    const instances = blocks.map(block => this.blockToInstance(block));
    const avgLines = blocks.reduce((sum, block) => sum + (block.endLine - block.startLine + 1), 0) / blocks.length;
    const avgTokens = blocks.reduce((sum, block) => sum + block.tokens.length, 0) / blocks.length;
    
    return {
      files: instances,
      similarity,
      linesOfCode: Math.round(avgLines),
      tokenCount: Math.round(avgTokens),
      type,
      suggestion: this.generateRefactoringSuggestion(blocks, type)
    };
  }

  private blockToInstance(block: CodeBlock): DuplicateInstance {
    return {
      file: block.file,
      startLine: block.startLine,
      endLine: block.endLine,
      codeBlock: block.content,
      hash: block.hash,
      context: this.generateContext(block)
    };
  }

  private generateContext(block: CodeBlock): string {
    const lines = block.content.split('\n');
    const firstMeaningfulLine = lines.find(line => line.trim().length > 0)?.trim() || '';
    return firstMeaningfulLine.substring(0, 50) + (firstMeaningfulLine.length > 50 ? '...' : '');
  }

  private generateRefactoringSuggestion(blocks: CodeBlock[], type: 'exact' | 'similar' | 'structural'): RefactoringSuggestion {
    const firstBlock = blocks[0]!;
    const avgLines = blocks.reduce((sum, block) => sum + (block.endLine - block.startLine + 1), 0) / blocks.length;
    
    // Analyze content to suggest appropriate refactoring
    const content = firstBlock.content.toLowerCase();
    
    if (content.includes('class ') || content.includes('interface ')) {
      return {
        type: 'extract-class',
        name: 'CommonBase',
        description: 'Extract common class or interface structure',
        extractedCode: firstBlock.content,
        parameters: [],
        benefit: 'Reduces code duplication and improves maintainability'
      };
    } else if (content.includes('function ') || content.includes('=>') || avgLines <= 15) {
      return {
        type: 'extract-function',
        name: 'extractedFunction',
        description: 'Extract duplicate logic into a shared function',
        extractedCode: firstBlock.content,
        parameters: this.extractParameters(firstBlock.content),
        benefit: 'Centralizes logic and reduces duplication'
      };
    } else if (avgLines > 15) {
      return {
        type: 'extract-utility',
        name: 'SharedUtility',
        description: 'Extract complex logic into a utility module',
        extractedCode: firstBlock.content,
        parameters: [],
        benefit: 'Improves code organization and reusability'
      };
    } else {
      return {
        type: 'create-component',
        name: 'SharedComponent',
        description: 'Create a reusable component or module',
        extractedCode: firstBlock.content,
        parameters: [],
        benefit: 'Enhances modularity and reduces duplication'
      };
    }
  }

  private extractParameters(content: string): string[] {
    // Simple parameter extraction from function signatures
    const functionMatch = content.match(/function\s+\w+\s*\(([^)]*)\)/) || 
                         content.match(/\(([^)]*)\)\s*=>/);
    
    if (functionMatch && functionMatch[1]) {
      return functionMatch[1]
        .split(',')
        .map(param => param.trim())
        .filter(param => param.length > 0);
    }
    
    return [];
  }

  calculateDuplicationMetrics(clones: DuplicateClone[], totalFiles: number): DuplicationMetrics {
    const duplicateBlocks = clones.reduce((sum, clone) => sum + clone.files.length, 0);
    const duplicateLines = clones.reduce((sum, clone) => sum + (clone.linesOfCode * clone.files.length), 0);
    
    // Estimate total lines in project (simplified)
    const estimatedTotalLines = totalFiles * 100; // Rough estimate
    const duplicationPercentage = Math.min((duplicateLines / estimatedTotalLines) * 100, 100);
    
    const avgBlockSize = duplicateBlocks > 0 ? duplicateLines / duplicateBlocks : 0;
    
    // Calculate risk score based on amount and complexity of duplication
    const exactClones = clones.filter(c => c.type === 'exact').length;
    const highSimilarityClones = clones.filter(c => c.similarity > 0.9).length;
    const riskScore = Math.min(
      ((exactClones * 10) + (highSimilarityClones * 5) + (clones.length * 2)) / totalFiles * 10,
      100
    );
    
    return {
      totalFiles,
      duplicateBlocks,
      duplicateLines,
      duplicationPercentage,
      duplicatedPercentage: (clones.length / totalFiles) * 100,
      avgBlockSize,
      riskScore
    };
  }

  generateDuplicationReport(clones: DuplicateClone[], metrics: DuplicationMetrics): string {
    let report = `# Code Duplication Analysis Report\n\n`;
    
    report += `## Summary\n`;
    report += `- **Duplicate Groups Found:** ${clones.length}\n`;
    report += `- **Duplicate Code Blocks:** ${metrics.duplicateBlocks}\n`;
    report += `- **Lines of Duplicated Code:** ${metrics.duplicateLines}\n`;
    report += `- **Duplication Percentage:** ${metrics.duplicationPercentage.toFixed(1)}%\n`;
    report += `- **Average Block Size:** ${metrics.avgBlockSize.toFixed(1)} lines\n`;
    report += `- **Risk Score:** ${metrics.riskScore.toFixed(1)}/100\n\n`;
    
    if (clones.length > 0) {
      report += `## Top Duplicate Groups\n\n`;
      
      const sortedClones = clones
        .sort((a, b) => (b.linesOfCode * b.files.length) - (a.linesOfCode * a.files.length))
        .slice(0, 10);
      
      sortedClones.forEach((clone, index) => {
        report += `### ${index + 1}. ${clone.type.toUpperCase()} Duplication\n`;
        report += `- **Similarity:** ${(clone.similarity * 100).toFixed(1)}%\n`;
        report += `- **Lines:** ${clone.linesOfCode}\n`;
        report += `- **Occurrences:** ${clone.files.length}\n`;
        report += `- **Suggested Fix:** ${clone.suggestion.type} - ${clone.suggestion.description}\n`;
        
        report += `\n**Locations:**\n`;
        clone.files.forEach(file => {
          report += `- ${file.file}:${file.startLine}-${file.endLine}\n`;
        });
        
        report += `\n**Preview:**\n\`\`\`\n${clone.files[0]!.context}\n\`\`\`\n\n`;
      });
      
      report += `## Recommendations\n`;
      report += `1. **High Priority:** Address exact duplicates first\n`;
      report += `2. **Medium Priority:** Refactor similar code blocks\n`;
      report += `3. **Consider:** Creating utility functions for repeated patterns\n`;
      report += `4. **Long-term:** Establish code review processes to prevent duplication\n`;
    } else {
      report += `## ✅ No Significant Duplicates Found\n\n`;
      report += `Great! Your codebase shows minimal code duplication.\n`;
    }
    
    return report;
  }
}