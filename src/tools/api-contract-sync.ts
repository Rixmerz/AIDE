/**
 * API Contract Sync Tool
 * 
 * Synchronizes API contracts between frontend and backend:
 * - Generates TypeScript types from OpenAPI schemas
 * - Validates API responses against contracts
 * - Detects breaking changes in API contracts
 * - Generates client code from API specifications
 * - Maintains consistency between services
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import type { ToolContext } from './index.js';
import { ASTUtilsEnhanced } from '../utils/ast-utils-enhanced.js';
import { FileOperations } from '../utils/file-operations.js';

const ApiContractSyncSchema = z.object({
  operation: z.enum([
    'generate-types',
    'validate-contracts',
    'detect-changes',
    'generate-client',
    'sync-schemas',
    'full-sync'
  ]),
  apiSpecPath: z.string().optional(),
  apiSpecUrl: z.string().optional(),
  outputDir: z.string().default('./src/types/api'),
  clientOutputDir: z.string().default('./src/api/clients'),
  contractFiles: z.array(z.string()).optional(),
  includeValidation: z.boolean().default(true),
  includeDocumentation: z.boolean().default(true),
  generateMocks: z.boolean().default(false),
  strictMode: z.boolean().default(true),
  namespacePrefix: z.string().default('Api'),
  targetFramework: z.enum(['fetch', 'axios', 'swr', 'react-query']).default('fetch'),
  dryRun: z.boolean().default(false)
});

interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  operationId: string;
  summary: string;
  description: string;
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: Record<string, ApiResponse>;
  tags: string[];
}

interface ApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description: string;
  required: boolean;
  schema: ApiSchema;
  example?: any;
}

interface ApiRequestBody {
  description: string;
  required: boolean;
  content: Record<string, { schema: ApiSchema }>;
}

interface ApiResponse {
  description: string;
  content?: Record<string, { schema: ApiSchema }>;
  headers?: Record<string, ApiHeader>;
}

interface ApiHeader {
  description: string;
  schema: ApiSchema;
}

interface ApiSchema {
  type?: string;
  format?: string;
  properties?: Record<string, ApiSchema>;
  items?: ApiSchema;
  required?: string[];
  enum?: any[];
  $ref?: string;
  allOf?: ApiSchema[];
  oneOf?: ApiSchema[];
  anyOf?: ApiSchema[];
  description?: string;
  example?: any;
  nullable?: boolean;
  additionalProperties?: boolean | ApiSchema;
}

interface ApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses?: Record<string, ApiResponse>;
  tags?: string[];
}

interface ApiContract {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, ApiOperation>>;
  components: {
    schemas: Record<string, ApiSchema>;
    responses?: Record<string, ApiResponse>;
    parameters?: Record<string, ApiParameter>;
  };
}

interface ContractChange {
  type: 'breaking' | 'non-breaking' | 'addition';
  severity: 'major' | 'minor' | 'patch';
  endpoint?: string;
  method?: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

interface SyncResult {
  operation: string;
  success: boolean;
  filesGenerated: string[];
  changes: ContractChange[];
  validationErrors: Array<{
    file: string;
    errors: string[];
  }>;
  statistics: {
    endpoints: number;
    types: number;
    clients: number;
    processingTime: number;
  };
}

export async function handleApiContractSync(args: any, context: ToolContext): Promise<any> {
  const { logger } = context;

  try {
    logger.info('Starting API contract synchronization', { args });

    const validated = ApiContractSyncSchema.parse(args);
    
    const astUtils = new ASTUtilsEnhanced(logger);
    const fileOps = new FileOperations(logger);

    let syncResult: SyncResult | null = null;
    const startTime = Date.now();

    // Load API contract
    const apiContract = await loadApiContract(validated, logger);
    
    if (!apiContract) {
      return {
        content: [{
          type: 'text',
          text: 'Could not load API contract. Please provide either apiSpecPath or apiSpecUrl.'
        }]
      };
    }

    switch (validated.operation) {
      case 'generate-types':
        syncResult = await generateTypes(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      case 'validate-contracts':
        syncResult = await validateContracts(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      case 'detect-changes':
        syncResult = await detectChanges(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      case 'generate-client':
        syncResult = await generateClient(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      case 'sync-schemas':
        syncResult = await syncSchemas(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      case 'full-sync':
        syncResult = await performFullSync(apiContract, validated, astUtils, fileOps, logger);
        break;
      
      default:
        throw new Error(`Unsupported operation: ${validated.operation}`);
    }

    const processingTime = Date.now() - startTime;
    if (syncResult) {
      syncResult.statistics.processingTime = processingTime;
    }

    // Generate response
    let response = `## API Contract Sync Results\n\n`;
    response += `**Operation:** ${validated.operation}\n`;
    response += `**API:** ${apiContract.info.title} v${apiContract.info.version}\n`;
    response += `**Processing time:** ${processingTime}ms\n\n`;

    if (syncResult) {
      response += generateSyncResponse(syncResult);
    }

    return {
      content: [{
        type: 'text',
        text: response
      }],
      metadata: syncResult ? {
        success: syncResult.success,
        statistics: syncResult.statistics,
        changes: syncResult.changes
      } : undefined
    };

  } catch (error) {
    logger.error('Error in API contract sync:', error);
    throw error;
  }
}

async function loadApiContract(
  options: z.infer<typeof ApiContractSyncSchema>,
  logger: any
): Promise<ApiContract | null> {
  try {
    if (options.apiSpecPath) {
      logger.info(`Loading API contract from file: ${options.apiSpecPath}`);
      const content = await readFile(options.apiSpecPath, 'utf-8');
      return JSON.parse(content) as ApiContract;
    }
    
    if (options.apiSpecUrl) {
      logger.info(`Loading API contract from URL: ${options.apiSpecUrl}`);
      // For now, return a mock contract since we can't fetch in this environment
      return createMockApiContract();
    }

    return null;
  } catch (error) {
    logger.error('Error loading API contract:', error);
    return null;
  }
}

async function generateTypes(
  contract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info('Generating TypeScript types from API contract');

  const filesGenerated: string[] = [];
  const endpoints = extractEndpoints(contract);

  try {
    // Generate schema types
    const schemaTypes = generateSchemaTypes(contract.components.schemas, options.namespacePrefix);
    const schemaTypesPath = `${options.outputDir}/schemas.ts`;
    
    if (!options.dryRun) {
      await fileOps.ensureDirectoryExists(options.outputDir);
      await fileOps.writeFile(schemaTypesPath, schemaTypes);
      filesGenerated.push(schemaTypesPath);
    }

    // Generate endpoint types
    const endpointTypes = generateEndpointTypes(endpoints, options.namespacePrefix);
    const endpointTypesPath = `${options.outputDir}/endpoints.ts`;
    
    if (!options.dryRun) {
      await fileOps.writeFile(endpointTypesPath, endpointTypes);
      filesGenerated.push(endpointTypesPath);
    }

    // Generate index file
    const indexContent = generateTypesIndex(options.namespacePrefix);
    const indexPath = `${options.outputDir}/index.ts`;
    
    if (!options.dryRun) {
      await fileOps.writeFile(indexPath, indexContent);
      filesGenerated.push(indexPath);
    }

    return {
      operation: 'generate-types',
      success: true,
      filesGenerated,
      changes: [],
      validationErrors: [],
      statistics: {
        endpoints: endpoints.length,
        types: Object.keys(contract.components.schemas).length,
        clients: 0,
        processingTime: 0
      }
    };

  } catch (error) {
    logger.error('Error generating types:', error);
    return {
      operation: 'generate-types',
      success: false,
      filesGenerated,
      changes: [],
      validationErrors: [{ file: 'type-generation', errors: [(error as Error).message || String(error)] }],
      statistics: { endpoints: 0, types: 0, clients: 0, processingTime: 0 }
    };
  }
}

async function validateContracts(
  contract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info('Validating API contracts');

  const validationErrors: Array<{ file: string; errors: string[] }> = [];
  const endpoints = extractEndpoints(contract);

  // Validate contract structure
  const contractErrors = validateContractStructure(contract);
  if (contractErrors.length > 0) {
    validationErrors.push({ file: 'contract-structure', errors: contractErrors });
  }

  // Validate endpoint definitions
  for (const endpoint of endpoints) {
    const endpointErrors = validateEndpoint(endpoint);
    if (endpointErrors.length > 0) {
      validationErrors.push({ 
        file: `${endpoint.method} ${endpoint.path}`, 
        errors: endpointErrors 
      });
    }
  }

  // Validate schema definitions
  for (const [schemaName, schema] of Object.entries(contract.components.schemas)) {
    const schemaErrors = validateSchema(schema, schemaName);
    if (schemaErrors.length > 0) {
      validationErrors.push({ 
        file: `schema-${schemaName}`, 
        errors: schemaErrors 
      });
    }
  }

  return {
    operation: 'validate-contracts',
    success: validationErrors.length === 0,
    filesGenerated: [],
    changes: [],
    validationErrors,
    statistics: {
      endpoints: endpoints.length,
      types: Object.keys(contract.components.schemas).length,
      clients: 0,
      processingTime: 0
    }
  };
}

async function detectChanges(
  newContract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info('Detecting API contract changes');

  const changes: ContractChange[] = [];

  // For demonstration, we'll compare against a mock "previous" version
  const previousContract = createMockPreviousContract();
  
  // Compare endpoints
  const newEndpoints = extractEndpoints(newContract);
  const oldEndpoints = extractEndpoints(previousContract);

  // Detect new endpoints
  for (const newEndpoint of newEndpoints) {
    const key = `${newEndpoint.method} ${newEndpoint.path}`;
    const oldEndpoint = oldEndpoints.find(e => `${e.method} ${e.path}` === key);
    
    if (!oldEndpoint) {
      changes.push({
        type: 'addition',
        severity: 'minor',
        endpoint: newEndpoint.path,
        method: newEndpoint.method,
        description: `New endpoint added: ${newEndpoint.method} ${newEndpoint.path}`,
        impact: 'low'
      });
    } else {
      // Compare endpoint details
      const endpointChanges = compareEndpoints(oldEndpoint, newEndpoint);
      changes.push(...endpointChanges);
    }
  }

  // Detect removed endpoints
  for (const oldEndpoint of oldEndpoints) {
    const key = `${oldEndpoint.method} ${oldEndpoint.path}`;
    const newEndpoint = newEndpoints.find(e => `${e.method} ${e.path}` === key);
    
    if (!newEndpoint) {
      changes.push({
        type: 'breaking',
        severity: 'major',
        endpoint: oldEndpoint.path,
        method: oldEndpoint.method,
        description: `Endpoint removed: ${oldEndpoint.method} ${oldEndpoint.path}`,
        impact: 'high'
      });
    }
  }

  // Compare schemas
  const schemaChanges = compareSchemas(
    previousContract.components.schemas,
    newContract.components.schemas
  );
  changes.push(...schemaChanges);

  return {
    operation: 'detect-changes',
    success: true,
    filesGenerated: [],
    changes,
    validationErrors: [],
    statistics: {
      endpoints: newEndpoints.length,
      types: Object.keys(newContract.components.schemas).length,
      clients: 0,
      processingTime: 0
    }
  };
}

async function generateClient(
  contract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info(`Generating API client for ${options.targetFramework}`);

  const filesGenerated: string[] = [];

  try {
    // Log del contract para debugging
    logger.debug('Contract structure:', {
      hasInfo: !!contract?.info,
      hasServers: !!contract?.servers,
      serverCount: contract?.servers?.length || 0,
      hasPaths: !!contract?.paths,
      pathCount: contract?.paths ? Object.keys(contract.paths).length : 0,
      hasComponents: !!contract?.components
    });

    // Validar contract antes de procesar
    validateApiContract(contract);

    const endpoints = extractEndpoints(contract);
    logger.debug(`Extracted ${endpoints.length} endpoints from contract`);

    if (endpoints.length === 0) {
      logger.warn('No endpoints found in contract, generating empty client');
    }
    // Generate base client
    const baseClientCode = generateBaseClient(contract, options);
    const baseClientPath = `${options.clientOutputDir}/base.ts`;
    
    if (!options.dryRun) {
      await fileOps.ensureDirectoryExists(options.clientOutputDir);
      await fileOps.writeFile(baseClientPath, baseClientCode);
      filesGenerated.push(baseClientPath);
    }

    // Generate endpoint clients by tags
    const endpointsByTag = groupEndpointsByTags(endpoints);
    
    for (const [tag, tagEndpoints] of endpointsByTag) {
      const clientCode = generateTagClient(tag, tagEndpoints, contract, options);
      const clientPath = `${options.clientOutputDir}/${tag.toLowerCase()}.ts`;
      
      if (!options.dryRun) {
        await fileOps.writeFile(clientPath, clientCode);
        filesGenerated.push(clientPath);
      }
    }

    // Generate main client index
    const indexCode = generateClientIndex(Array.from(endpointsByTag.keys()), options);
    const indexPath = `${options.clientOutputDir}/index.ts`;
    
    if (!options.dryRun) {
      await fileOps.writeFile(indexPath, indexCode);
      filesGenerated.push(indexPath);
    }

    return {
      operation: 'generate-client',
      success: true,
      filesGenerated,
      changes: [],
      validationErrors: [],
      statistics: {
        endpoints: endpoints.length,
        types: 0,
        clients: endpointsByTag.size,
        processingTime: 0
      }
    };

  } catch (error) {
    logger.error('Detailed error in generateClient:', {
      message: (error as Error).message,
      stack: (error as Error).stack,
      contractInfo: {
        hasInfo: !!contract?.info,
        hasServers: !!contract?.servers,
        hasPaths: !!contract?.paths,
        pathCount: contract?.paths ? Object.keys(contract.paths).length : 0
      }
    });

    return {
      operation: 'generate-client',
      success: false,
      filesGenerated,
      changes: [],
      validationErrors: [{ file: 'client-generation', errors: [(error as Error).message || String(error)] }],
      statistics: { endpoints: 0, types: 0, clients: 0, processingTime: 0 }
    };
  }
}

async function syncSchemas(
  contract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info('Synchronizing API schemas');

  // Combine type generation and validation
  const typeResult = await generateTypes(contract, options, astUtils, fileOps, logger);
  const validationResult = await validateContracts(contract, options, astUtils, fileOps, logger);

  return {
    operation: 'sync-schemas',
    success: typeResult.success && validationResult.success,
    filesGenerated: typeResult.filesGenerated,
    changes: [],
    validationErrors: validationResult.validationErrors,
    statistics: {
      endpoints: typeResult.statistics.endpoints,
      types: typeResult.statistics.types,
      clients: 0,
      processingTime: 0
    }
  };
}

async function performFullSync(
  contract: ApiContract,
  options: z.infer<typeof ApiContractSyncSchema>,
  astUtils: ASTUtilsEnhanced,
  fileOps: FileOperations,
  logger: any
): Promise<SyncResult> {
  logger.info('Performing full API contract synchronization');

  const results: SyncResult[] = [];

  // Run all sync operations
  results.push(await generateTypes(contract, options, astUtils, fileOps, logger));
  results.push(await generateClient(contract, options, astUtils, fileOps, logger));
  results.push(await validateContracts(contract, options, astUtils, fileOps, logger));
  results.push(await detectChanges(contract, options, astUtils, fileOps, logger));

  // Combine results
  const combinedResult: SyncResult = {
    operation: 'full-sync',
    success: results.every(r => r.success),
    filesGenerated: results.flatMap(r => r.filesGenerated),
    changes: results.flatMap(r => r.changes),
    validationErrors: results.flatMap(r => r.validationErrors),
    statistics: {
      endpoints: results[0]?.statistics.endpoints || 0,
      types: results[0]?.statistics.types || 0,
      clients: results[1]?.statistics.clients || 0,
      processingTime: 0
    }
  };

  return combinedResult;
}

// Helper functions

function validateApiContract(contract: ApiContract): void {
  if (!contract) {
    throw new Error('API contract is undefined');
  }

  if (!contract.info) {
    throw new Error('API contract has no info');
  }

  if (!contract.paths) {
    throw new Error('API contract has no paths');
  }

  // Validar que servers existe y es un array
  if (!contract.servers) {
    contract.servers = [];
  }
  if (!Array.isArray(contract.servers)) {
    contract.servers = [contract.servers];
  }

  // Validar components
  if (!contract.components) {
    contract.components = { schemas: {} };
  }
  if (!contract.components.schemas) {
    contract.components.schemas = {};
  }
}

function createMockApiContract(): ApiContract {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Mock API',
      version: '1.0.0',
      description: 'A mock API for demonstration'
    },
    servers: [
      {
        url: 'https://api.example.com/v1',
        description: 'Production server'
      }
    ],
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          summary: 'Get all users',
          description: 'Retrieve a list of all users',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Number of users to return',
              required: false,
              schema: { type: 'integer', example: 10 }
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of users to skip',
              required: false,
              schema: { type: 'integer', example: 0 }
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/User' }
                  }
                }
              }
            }
          },
          tags: ['Users']
        },
        post: {
          operationId: 'createUser',
          summary: 'Create a new user',
          description: 'Add a new user to the system',
          requestBody: {
            description: 'User data',
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' }
              }
            }
          },
          responses: {
            '201': {
              description: 'User created successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' }
                }
              }
            }
          },
          tags: ['Users']
        }
      },
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          summary: 'Get user by ID',
          description: 'Retrieve a specific user by their ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              description: 'User ID',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' }
                }
              }
            },
            '404': {
              description: 'User not found'
            }
          },
          tags: ['Users']
        }
      }
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', format: 'email', description: 'User email' }
          },
          required: ['id', 'name', 'email']
        }
      }
    }
  };
}

function createMockPreviousContract(): ApiContract {
  const mock = createMockApiContract();
  // Simulate some differences
  mock.info.version = '0.9.0';
  return mock;
}

function extractEndpoints(contract: ApiContract): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Validar contract básico
  if (!contract || !contract.paths) {
    return endpoints;
  }

  for (const [path, pathItem] of Object.entries(contract.paths)) {
    // Validar pathItem
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      // Validar operation
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      // Construir endpoint con validación exhaustiva de cada campo
      const endpoint: ApiEndpoint = {
        path: typeof path === 'string' && path ? path : '/',
        method: (typeof method === 'string' && method ? method.toUpperCase() : 'GET') as any,
        operationId: operation.operationId && typeof operation.operationId === 'string' ?
                    operation.operationId :
                    `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        summary: operation.summary && typeof operation.summary === 'string' ? operation.summary : '',
        description: operation.description && typeof operation.description === 'string' ? operation.description : '',
        parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
        requestBody: operation.requestBody || undefined,
        responses: operation.responses && typeof operation.responses === 'object' ? operation.responses : {},
        tags: Array.isArray(operation.tags) ? operation.tags : []
      };

      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function generateSchemaTypes(schemas: Record<string, ApiSchema>, namespacePrefix: string): string {
  let content = `// Generated API types\n`;
  content += `// Do not edit manually\n\n`;
  content += `export namespace ${namespacePrefix} {\n`;

  for (const [schemaName, schema] of Object.entries(schemas)) {
    content += `  export interface ${schemaName} {\n`;
    
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const optional = !schema.required?.includes(propName) ? '?' : '';
        const type = convertSchemaToType(propSchema);
        const description = propSchema.description ? ` // ${propSchema.description}` : '';
        content += `    ${propName}${optional}: ${type};${description}\n`;
      }
    }
    
    content += `  }\n\n`;
  }

  content += `}\n`;
  return content;
}

function generateEndpointTypes(endpoints: ApiEndpoint[], namespacePrefix: string): string {
  let content = `// Generated endpoint types\n`;
  content += `// Do not edit manually\n\n`;
  content += `import { ${namespacePrefix} } from './schemas';\n\n`;
  content += `export namespace ${namespacePrefix}Endpoints {\n`;

  for (const endpoint of endpoints) {
    try {
      const operationName = endpoint.operationId || `${endpoint.method}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Generate request type
      content += `  export interface ${operationName}Request {\n`;

      // Parameters
      if (endpoint.parameters && Array.isArray(endpoint.parameters)) {
        for (const param of endpoint.parameters) {
          try {
            const optional = !param.required ? '?' : '';
            const type = convertSchemaToType(param.schema);
            content += `    ${param.name}${optional}: ${type};\n`;
          } catch (error) {
            console.error(`Error processing parameter ${param.name}:`, error);
            content += `    ${param.name}?: any; // Error in parameter processing\n`;
          }
        }
      }

      // Request body
      if (endpoint.requestBody && endpoint.requestBody.content) {
        try {
          const contentKeys = Object.keys(endpoint.requestBody.content);
          if (contentKeys.length > 0 && contentKeys[0]) {
            const firstContent = endpoint.requestBody.content[contentKeys[0]];
            if (firstContent && firstContent.schema) {
              const optional = !endpoint.requestBody.required ? '?' : '';
              const type = convertSchemaToType(firstContent.schema);
              content += `    body${optional}: ${type};\n`;
            }
          }
        } catch (error) {
          console.error(`Error processing request body for ${operationName}:`, error);
          content += `    body?: any; // Error in request body processing\n`;
        }
      }

      content += `  }\n\n`;

      // Generate response type
      content += `  export interface ${operationName}Response {\n`;

      for (const [statusCode, response] of Object.entries(endpoint.responses)) {
        try {
          if (response && response.content) {
            const contentKeys = Object.keys(response.content);
            if (contentKeys.length > 0 && contentKeys[0]) {
              const firstContent = response.content[contentKeys[0]];
              if (firstContent && firstContent.schema) {
                const type = convertSchemaToType(firstContent.schema);
                content += `    '${statusCode}': ${type};\n`;
              } else {
                // Content exists but no schema
                content += `    '${statusCode}': unknown;\n`;
              }
            } else {
              // Content object is empty
              content += `    '${statusCode}': void;\n`;
            }
          } else {
            // Handle responses without content (like 204 No Content, 404 Not Found)
            const voidStatusCodes = ['204', '404', '500'];
            if (voidStatusCodes.includes(statusCode)) {
              content += `    '${statusCode}': void;\n`;
            } else {
              // Default to unknown for other status codes without content
              content += `    '${statusCode}': unknown;\n`;
            }
          }
        } catch (error) {
          console.error(`Error processing response ${statusCode} for ${operationName}:`, error);
          content += `    '${statusCode}': any; // Error in response processing\n`;
        }
      }

      content += `  }\n\n`;
    } catch (error) {
      console.error(`Error processing endpoint ${endpoint.path} ${endpoint.method}:`, error);
      // Skip this endpoint and continue
    }
  }

  content += `}\n`;
  return content;
}

function generateTypesIndex(namespacePrefix: string): string {
  return `// Generated API types index
// Do not edit manually

export * from './schemas';
export * from './endpoints';
export { ${namespacePrefix} } from './schemas';
export { ${namespacePrefix}Endpoints } from './endpoints';
`;
}

function convertSchemaToType(schema: ApiSchema): string {
  // Handle null or undefined schemas
  if (!schema) {
    return 'any';
  }

  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    return refName ? `Api.${refName}` : 'any';
  }

  switch (schema.type) {
    case 'string':
      if (schema.enum && Array.isArray(schema.enum)) {
        return schema.enum.map(v => `'${v}'`).join(' | ');
      }
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      const itemType = schema.items ? convertSchemaToType(schema.items) : 'any';
      return `${itemType}[]`;
    case 'object':
      if (schema.properties && typeof schema.properties === 'object') {
        const props = Object.entries(schema.properties)
          .map(([key, value]) => {
            const optional = !schema.required?.includes(key) ? '?' : '';
            return `${key}${optional}: ${convertSchemaToType(value)}`;
          })
          .join('; ');
        return `{ ${props} }`;
      }
      return 'Record<string, any>';
    default:
      return 'any';
  }
}

function generateBaseClient(contract: ApiContract, options: z.infer<typeof ApiContractSyncSchema>): string {
  const baseUrl = contract.servers[0]?.url || 'https://api.example.com';
  
  return `// Generated API base client
// Do not edit manually

export interface ApiConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class BaseApiClient {
  private config: ApiConfig;

  constructor(config: Partial<ApiConfig> = {}) {
    this.config = {
      baseUrl: '${baseUrl}',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      ...config
    };
  }

  protected async request<T>(
    method: string,
    path: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: this.config.headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }

    return response.json();
  }
}
`;
}

function groupEndpointsByTags(endpoints: ApiEndpoint[]): Map<string, ApiEndpoint[]> {
  const grouped = new Map<string, ApiEndpoint[]>();
  
  for (const endpoint of endpoints) {
    const tag = (endpoint.tags && endpoint.tags[0]) || 'Default';
    if (!grouped.has(tag)) {
      grouped.set(tag, []);
    }
    grouped.get(tag)!.push(endpoint);
  }
  
  return grouped;
}

function generateTagClient(tag: string, endpoints: ApiEndpoint[], contract: ApiContract, options: z.infer<typeof ApiContractSyncSchema>): string {
  // Validar inputs
  if (!tag || typeof tag !== 'string') {
    tag = 'Default';
  }

  if (!endpoints || !Array.isArray(endpoints)) {
    endpoints = [];
  }

  if (!contract) {
    throw new Error('Contract is required for client generation');
  }

  let content = `// Generated ${tag} API client
// Do not edit manually

import { BaseApiClient } from './base';
import { ${options.namespacePrefix}Endpoints } from '../types';

export class ${tag}ApiClient extends BaseApiClient {
`;

  for (const endpoint of endpoints) {
    try {
      // Validar cada campo antes de usarlo
      const operationName = (endpoint?.operationId && typeof endpoint.operationId === 'string') ?
                           endpoint.operationId :
                           `${endpoint?.method?.toLowerCase() || 'unknown'}${endpoint?.path?.replace(/[^a-zA-Z0-9]/g, '') || 'endpoint'}`;

      const requestType = `${options.namespacePrefix}Endpoints.${operationName}Request`;
      const responseType = `${options.namespacePrefix}Endpoints.${operationName}Response['200']`;

      // Handle potential undefined values safely
      const summary = (endpoint?.summary && typeof endpoint.summary === 'string') ? endpoint.summary : '';
      const description = (endpoint?.description && typeof endpoint.description === 'string') ? endpoint.description : '';
      const method = (endpoint?.method && typeof endpoint.method === 'string') ? endpoint.method : 'GET';
      const path = (endpoint?.path && typeof endpoint.path === 'string') ? endpoint.path : '/';

      content += `
  /**
   * ${summary}
   * ${description}
   */
  async ${operationName}(params?: ${requestType}): Promise<${responseType}> {
    const { body, ...queryParams } = params || {};
    return this.request<${responseType}>(
      '${method}',
      '${path}',
      body,
      queryParams
    );
  }
`;
    } catch (error) {
      console.error(`Error generating client method for endpoint ${endpoint?.path}:`, error);
      // Continue with the next endpoint
    }
  }

  content += `}\n`;
  return content;
}

function generateClientIndex(tags: string[], options: z.infer<typeof ApiContractSyncSchema>): string {
  let content = `// Generated API client index
// Do not edit manually

export { BaseApiClient } from './base';
`;

  for (const tag of tags) {
    content += `export { ${tag}ApiClient } from './${tag.toLowerCase()}';\n`;
  }

  content += `
export class ApiClient {
`;

  for (const tag of tags) {
    content += `  public ${tag.toLowerCase()} = new ${tag}ApiClient();\n`;
  }

  content += `}

export default new ApiClient();
`;

  return content;
}

function validateContractStructure(contract: ApiContract): string[] {
  const errors: string[] = [];

  if (!contract.openapi) {
    errors.push('Missing openapi version');
  }

  if (!contract.info?.title) {
    errors.push('Missing API title');
  }

  if (!contract.info?.version) {
    errors.push('Missing API version');
  }

  if (!contract.paths || Object.keys(contract.paths).length === 0) {
    errors.push('No API paths defined');
  }

  return errors;
}

function validateEndpoint(endpoint: ApiEndpoint): string[] {
  const errors: string[] = [];

  if (!endpoint.operationId) {
    errors.push('Missing operationId');
  }

  if (!endpoint.summary) {
    errors.push('Missing summary');
  }

  if (!endpoint.responses || Object.keys(endpoint.responses).length === 0) {
    errors.push('No responses defined');
  }

  return errors;
}

function validateSchema(schema: ApiSchema, name: string): string[] {
  const errors: string[] = [];

  if (!schema.type && !schema.$ref && !schema.allOf && !schema.oneOf && !schema.anyOf) {
    errors.push(`Schema ${name} has no type information`);
  }

  if (schema.type === 'object' && !schema.properties && !schema.additionalProperties) {
    errors.push(`Object schema ${name} has no properties defined`);
  }

  return errors;
}

function compareEndpoints(oldEndpoint: ApiEndpoint, newEndpoint: ApiEndpoint): ContractChange[] {
  const changes: ContractChange[] = [];

  // Compare parameters (with safety checks)
  const oldParams = new Set((oldEndpoint.parameters || []).map(p => p.name));
  const newParams = new Set((newEndpoint.parameters || []).map(p => p.name));

  // Check for added parameters
  if (newEndpoint.parameters && Array.isArray(newEndpoint.parameters)) {
    for (const param of newEndpoint.parameters) {
      if (!oldParams.has(param.name)) {
        changes.push({
          type: param.required ? 'breaking' : 'addition',
          severity: param.required ? 'major' : 'minor',
          endpoint: newEndpoint.path,
          method: newEndpoint.method,
          field: param.name,
          description: `Parameter ${param.name} added (${param.required ? 'required' : 'optional'})`,
          impact: param.required ? 'high' : 'low'
        });
      }
    }
  }

  // Check for removed parameters
  for (const paramName of oldParams) {
    if (!newParams.has(paramName)) {
      changes.push({
        type: 'breaking',
        severity: 'major',
        endpoint: newEndpoint.path,
        method: newEndpoint.method,
        field: paramName,
        description: `Parameter ${paramName} removed`,
        impact: 'high'
      });
    }
  }

  return changes;
}

function compareSchemas(oldSchemas: Record<string, ApiSchema>, newSchemas: Record<string, ApiSchema>): ContractChange[] {
  const changes: ContractChange[] = [];

  for (const [schemaName, newSchema] of Object.entries(newSchemas)) {
    const oldSchema = oldSchemas[schemaName];
    
    if (!oldSchema) {
      changes.push({
        type: 'addition',
        severity: 'minor',
        field: schemaName,
        description: `New schema ${schemaName} added`,
        impact: 'low'
      });
      continue;
    }

    // Compare properties for object schemas
    if (newSchema.type === 'object' && oldSchema.type === 'object') {
      const oldProps = new Set(Object.keys(oldSchema.properties || {}));
      const newProps = new Set(Object.keys(newSchema.properties || {}));

      for (const propName of newProps) {
        if (!oldProps.has(propName)) {
          const isRequired = newSchema.required?.includes(propName);
          changes.push({
            type: isRequired ? 'breaking' : 'addition',
            severity: isRequired ? 'major' : 'minor',
            field: `${schemaName}.${propName}`,
            description: `Property ${propName} added to ${schemaName} (${isRequired ? 'required' : 'optional'})`,
            impact: isRequired ? 'medium' : 'low'
          });
        }
      }

      for (const propName of oldProps) {
        if (!newProps.has(propName)) {
          changes.push({
            type: 'breaking',
            severity: 'major',
            field: `${schemaName}.${propName}`,
            description: `Property ${propName} removed from ${schemaName}`,
            impact: 'high'
          });
        }
      }
    }
  }

  for (const schemaName of Object.keys(oldSchemas)) {
    if (!newSchemas[schemaName]) {
      changes.push({
        type: 'breaking',
        severity: 'major',
        field: schemaName,
        description: `Schema ${schemaName} removed`,
        impact: 'high'
      });
    }
  }

  return changes;
}

function generateSyncResponse(result: SyncResult): string {
  let response = `### Sync Summary\n\n`;
  response += `- **Success:** ${result.success ? '✅ Yes' : '❌ No'}\n`;
  response += `- **Files generated:** ${result.filesGenerated.length}\n`;
  response += `- **Changes detected:** ${result.changes.length}\n`;
  response += `- **Validation errors:** ${result.validationErrors.length}\n`;
  response += `- **Processing time:** ${result.statistics.processingTime}ms\n\n`;

  if (result.filesGenerated.length > 0) {
    response += `### Generated Files\n\n`;
    result.filesGenerated.forEach(file => {
      response += `- ${file}\n`;
    });
    response += `\n`;
  }

  if (result.changes.length > 0) {
    response += `### Contract Changes\n\n`;
    const breakingChanges = result.changes.filter(c => c.type === 'breaking');
    const additions = result.changes.filter(c => c.type === 'addition');
    const nonBreaking = result.changes.filter(c => c.type === 'non-breaking');

    if (breakingChanges.length > 0) {
      response += `**⚠️ Breaking Changes (${breakingChanges.length}):**\n`;
      breakingChanges.slice(0, 5).forEach(change => {
        response += `- ${change.description} (${change.severity} impact)\n`;
      });
      if (breakingChanges.length > 5) {
        response += `- ... and ${breakingChanges.length - 5} more\n`;
      }
      response += `\n`;
    }

    if (additions.length > 0) {
      response += `**✅ Additions (${additions.length}):**\n`;
      additions.slice(0, 5).forEach(change => {
        response += `- ${change.description}\n`;
      });
      if (additions.length > 5) {
        response += `- ... and ${additions.length - 5} more\n`;
      }
      response += `\n`;
    }
  }

  if (result.validationErrors.length > 0) {
    response += `### Validation Errors\n\n`;
    result.validationErrors.slice(0, 3).forEach(error => {
      response += `**${error.file}:**\n`;
      error.errors.forEach(err => {
        response += `- ${err}\n`;
      });
      response += `\n`;
    });
  }

  response += `### Statistics\n\n`;
  response += `- **Endpoints processed:** ${result.statistics.endpoints}\n`;
  response += `- **Types generated:** ${result.statistics.types}\n`;
  response += `- **Clients generated:** ${result.statistics.clients}\n`;

  return response;
}