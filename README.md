# AIDE MCP Server 🚀

**A**dvanced **I**ntelligent **D**evelopment **E**nvironment - A powerful MCP (Model Context Protocol) server designed to supercharge TypeScript development with intelligent error analysis, batch editing, and automated fixes.

## ✨ Features

AIDE provides 11 comprehensive tools to dramatically improve your TypeScript development workflow:

### 🔍 **error_diff** - TypeScript Error Comparison
Compare TypeScript build outputs to see exactly which errors were resolved, introduced, or persist between builds.

**Key Benefits:**
- See progress in real-time as you fix errors
- Identify which changes introduced new problems  
- Get categorized error reports with actionable insights

### ✏️ **multi_file_edit** - Atomic Multi-File Editing
Edit multiple files in a single atomic operation with full validation and rollback support.

**Key Benefits:**
- Apply consistent changes across multiple files safely
- Automatic validation prevents breaking changes
- Built-in backup and rollback capabilities
- Dry-run mode to preview changes before applying

### 🔄 **pattern_replace** - Project-Wide Pattern Replacement  
Replace patterns across your entire codebase using powerful regex with intelligent file filtering.

**Key Benefits:**
- Refactor code patterns across the entire project
- Support for complex regex with capture groups
- File glob patterns for targeted replacements
- Safe preview mode with backup creation

### 🛠️ **typescript_auto_fix** - Automated Error Fixes
Automatically fix common TypeScript errors by category with intelligent analysis.

**Key Benefits:**
- Remove unused imports and variables automatically
- Add basic null checks where needed
- Process specific files or entire project
- Preview fixes before applying

## 🏗️ Architecture

```
AIDE/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── tools/                # Tool implementations
│   │   ├── index.ts          # Tool registration
│   │   ├── error-diff.ts     # Error comparison tool
│   │   ├── multi-file-edit.ts # Batch editing tool
│   │   ├── pattern-replace.ts # Pattern replacement tool
│   │   └── typescript-fix-simple.ts # Auto-fix tool
│   ├── utils/                # Utility functions
│   │   ├── logger.ts         # Structured logging
│   │   ├── errors.ts         # Error handling
│   │   ├── file-operations.ts # File system operations
│   │   └── typescript-utils-simple.ts # TypeScript analysis
│   └── analyzers/            # Advanced analysis
│       └── typescript.ts     # Error pattern detection
├── dist/                     # Compiled JavaScript
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── mcp-config.json           # MCP client configuration
```

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Install Dependencies
```bash
npm install
```

### Build the Project
```bash
npm run build
```

### Test the MCP Server
```bash
npm run test:mcp
```

## 📖 Usage Examples

### 1. Compare TypeScript Errors Between Builds

```json
{
  "name": "error_diff",
  "arguments": {
    "beforeBuild": "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/utils.ts(8,1): error TS6133: 'unused' is declared but its value is never read.",
    "afterBuild": "src/utils.ts(8,1): error TS6133: 'unused' is declared but its value is never read.\nsrc/components.ts(15,3): error TS2531: Object is possibly 'null'.",
    "includeReport": true
  }
}
```

**Result:** Detailed diff showing 1 resolved error, 1 new error, 1 persistent error with actionable recommendations.

### 2. Edit Multiple Files Atomically

```json
{
  "name": "multi_file_edit", 
  "arguments": {
    "edits": [
      {
        "file": "src/types.ts",
        "old": "interface User {",
        "new": "interface User {\n  id: string;"
      },
      {
        "file": "src/api.ts", 
        "old": "const user = response.data",
        "new": "const user: User = response.data"
      }
    ],
    "dryRun": false,
    "createBackups": true
  }
}
```

**Result:** Both files updated atomically with backups created for rollback if needed.

### 3. Replace Patterns Across Project

```json
{
  "name": "pattern_replace",
  "arguments": {
    "pattern": "console\\.log\\(([^)]+)\\)",
    "replacement": "logger.info($1)", 
    "fileGlob": "src/**/*.ts",
    "dryRun": false
  }
}
```

**Result:** All console.log calls replaced with logger.info across TypeScript files.

### 4. Auto-Fix TypeScript Errors

```json
{
  "name": "typescript_auto_fix",
  "arguments": {
    "errorType": "unused-imports",
    "dryRun": false,
    "createBackups": true
  }
}
```

**Result:** All unused import statements removed automatically with backups.

## 🔧 Configuration

### MCP Client Configuration
Update your MCP client configuration to include AIDE:

```json
{
  "mcpServers": {
    "aide-mcp-server": {
      "command": "node",
      "args": ["/path/to/AIDE/dist/index.js"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Environment Variables
- `LOG_LEVEL`: Set logging level (debug, info, warn, error)
- `NODE_ENV`: Set environment (development, production)

## 🛡️ Safety Features

- **Atomic Operations**: Multi-file edits are all-or-nothing
- **Automatic Backups**: Files are backed up before modifications
- **Dry Run Mode**: Preview changes before applying them
- **Input Validation**: All parameters are validated with Zod schemas
- **Error Recovery**: Automatic rollback on failures
- **Comprehensive Logging**: Detailed logs for debugging and monitoring

## 📊 Error Analysis Capabilities

AIDE categorizes TypeScript errors into actionable groups:

- **Unused Variables/Imports**: Automatically removable
- **Missing Properties**: Type definition issues  
- **Null Checks**: Potential null pointer errors
- **Type Errors**: Type mismatch problems
- **Syntax Errors**: Compilation blockers
- **Other**: Miscellaneous issues

## 🎯 Use Cases

### Daily Development
- Compare errors after making changes
- Clean up unused imports/variables
- Apply consistent refactoring patterns
- Fix common TypeScript issues automatically

### Code Reviews
- Identify error trends and patterns
- Ensure consistent code style
- Validate that changes don't introduce regressions

### Large Refactoring
- Apply changes across multiple files safely
- Update patterns throughout the codebase  
- Maintain code quality during major changes

### Team Productivity
- Standardize error fixing workflows
- Reduce manual grunt work
- Focus on business logic instead of boilerplate

## 🔄 Development Workflow

1. **Build your project** and capture TypeScript errors
2. **Use error_diff** to analyze error changes over time
3. **Apply typescript_auto_fix** for safe, automated cleanup
4. **Use multi_file_edit** for precise, targeted changes
5. **Apply pattern_replace** for project-wide refactoring
6. **Repeat** and watch your error count decrease!

## 🤝 Contributing

AIDE is designed to be extensible. To add new tools:

1. Create tool implementation in `src/tools/`
2. Add tool registration in `src/tools/index.ts`
3. Add proper TypeScript types and Zod validation
4. Include comprehensive error handling
5. Add tests and documentation

## 📝 License

MIT License - see LICENSE file for details.

## 🙋‍♂️ Support

Having issues? Check the logs (stderr) for detailed error information. All operations are logged with timestamps and context for easy debugging.

---

## 🛠️ Complete Tool Reference

AIDE now includes **11 comprehensive tools**:

### Core Tools (4)
1. **error_diff** - Compare TypeScript errors between builds
2. **multi_file_edit** - Atomic multi-file editing with rollback
3. **pattern_replace** - Project-wide regex pattern replacement  
4. **typescript_auto_fix** - Basic automated TypeScript error fixes

### Enhanced Tools (3)
5. **typescript_auto_fix_advanced** - Advanced fixes with AST manipulation, import sorting, ESLint integration
6. **pattern_replace_advanced** - Advanced replacement with exclude patterns and conditional logic
7. **code_formatter** - Comprehensive Prettier/ESLint formatting with parallel processing

### New Specialized Tools (4)
8. **code_refactor** - Extract functions, rename symbols, inline variables, move code
9. **import_organizer** - Auto-import dependencies, remove unused imports, organize by groups
10. **dependency_manager** - Install/update packages, security audits, NPM script management

### Features Across All Tools
- ✅ **Dry run mode** for safe previewing
- ✅ **Automatic backups** before modifications  
- ✅ **History tracking** with unique operation IDs
- ✅ **Rollback capabilities** for failed operations
- ✅ **Comprehensive error handling** with detailed reports
- ✅ **Input validation** using Zod schemas
- ✅ **Parallel processing** where applicable
- ✅ **Progress reporting** with real-time updates

---

**Made with ❤️ for TypeScript developers who want to spend more time building features and less time fixing errors.**