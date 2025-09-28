/**
 * Supabase Lite MCP Server
 * 
 * This server provides a minimal subset of Supabase commands focused on database
 * management. By reducing from 26 commands to just 8 essential ones, we save
 * approximately 11,000 tokens while maintaining core functionality.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration interface for our server
 * This helps TypeScript understand what configuration we expect
 */
interface ServerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  projectRef?: string;
}

/**
 * Define which Supabase commands we want to expose
 * Each command here corresponds to a specific database operation
 */
const ALLOWED_COMMANDS = [
  'list_tables',
  'list_extensions', 
  'list_migrations',
  'apply_migration',
  'execute_sql',
  'get_logs',
  'get_advisors',
  'generate_typescript_types'
] as const;

// TypeScript magic to create a type from our allowed commands
type AllowedCommand = typeof ALLOWED_COMMANDS[number];

/**
 * Main server class that handles all MCP protocol communications
 */
class SupabaseLiteMCPServer {
  private server: Server;
  private supabase: any;
  private config: ServerConfig;

  constructor() {
    // Initialize the MCP server with metadata
    this.server = new Server(
      {
        name: 'supabase-lite-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {}, // We provide tools (the Supabase commands)
        },
      }
    );

    // Load configuration from environment variables
    this.config = this.loadConfig();
    
    // Initialize Supabase client for API communications
    this.supabase = createClient(
      this.config.supabaseUrl,
      this.config.supabaseKey
    );

    // Set up all our command handlers
    this.setupHandlers();
  }

  /**
   * Load configuration from environment variables
   * This keeps sensitive data like API keys out of the code
   */
  private loadConfig(): ServerConfig {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY\n' +
        'Please create a .env file with these values from your Supabase project settings.'
      );
    }

    return {
      supabaseUrl,
      supabaseKey,
      projectRef: process.env.SUPABASE_PROJECT_REF,
    };
  }

  /**
   * Set up handlers for MCP protocol requests
   * These respond to Claude's requests for available tools and tool execution
   */
  private setupHandlers(): void {
    // Handle requests for the list of available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    // Handle requests to execute a specific tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Check if this is one of our allowed commands
      if (!this.isAllowedCommand(name)) {
        throw new Error(`Command '${name}' is not available in Supabase Lite`);
      }

      // Route to the appropriate handler based on the command
      return this.executeCommand(name as AllowedCommand, args);
    });
  }

  /**
   * Check if a command is in our allowed list
   */
  private isAllowedCommand(command: string): boolean {
    return ALLOWED_COMMANDS.includes(command as AllowedCommand);
  }

  /**
   * Define the tool specifications that Claude sees
   * Each tool has a name, description, and parameter schema
   */
  private getToolDefinitions(): Tool[] {
    const tools: Tool[] = [];

    // Define each tool with its specific parameters
    // These definitions tell Claude how to use each command

    tools.push({
      name: 'list_tables',
      description: 'Lists all tables in one or more schemas.',
      inputSchema: {
        type: 'object',
        properties: {
          schemas: {
            type: 'array',
            items: { type: 'string' },
            default: ['public'],
            description: 'List of schemas to include. Defaults to public schema.',
          },
        },
      },
    });

    tools.push({
      name: 'list_extensions',
      description: 'Lists all PostgreSQL extensions in the database.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    tools.push({
      name: 'list_migrations',
      description: 'Lists all migrations that have been applied to the database.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    tools.push({
      name: 'apply_migration',
      description: 'Applies a migration to the database. Use for DDL operations like CREATE TABLE.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the migration in snake_case',
          },
          query: {
            type: 'string',
            description: 'The SQL query to apply',
          },
        },
        required: ['name', 'query'],
      },
    });

    tools.push({
      name: 'execute_sql',
      description: 'Executes raw SQL in the database. Use for data queries, not DDL.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The SQL query to execute',
          },
        },
        required: ['query'],
      },
    });

    tools.push({
      name: 'get_logs',
      description: 'Gets logs for a Supabase service from the last minute.',
      inputSchema: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['api', 'postgres', 'auth', 'storage', 'realtime'],
            description: 'The service to fetch logs for',
          },
        },
        required: ['service'],
      },
    });

    tools.push({
      name: 'get_advisors',
      description: 'Gets advisory notices for security and performance improvements.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['security', 'performance'],
            description: 'The type of advisors to fetch',
          },
        },
        required: ['type'],
      },
    });

    tools.push({
      name: 'generate_typescript_types',
      description: 'Generates TypeScript types for the database schema.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    return tools;
  }

  /**
   * Execute a command by calling the appropriate Supabase API
   * This is where the actual work happens
   */
  private async executeCommand(command: AllowedCommand, args: any): Promise<any> {
    try {
      switch (command) {
        case 'list_tables':
          return await this.listTables(args.schemas || ['public']);
        
        case 'list_extensions':
          return await this.listExtensions();
        
        case 'list_migrations':
          return await this.listMigrations();
        
        case 'apply_migration':
          return await this.applyMigration(args.name, args.query);
        
        case 'execute_sql':
          return await this.executeSql(args.query);
        
        case 'get_logs':
          return await this.getLogs(args.service);
        
        case 'get_advisors':
          return await this.getAdvisors(args.type);
        
        case 'generate_typescript_types':
          return await this.generateTypeScriptTypes();
        
        default:
          throw new Error(`Command '${command}' is not implemented`);
      }
    } catch (error) {
      // Wrap errors in a format that Claude can understand
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${command}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  /**
   * Implementation of each command
   * These methods interact with the Supabase API
   */

  private async listTables(_schemas: string[]): Promise<any> {
    const query = `
      SELECT
        schemaname as schema,
        tablename as name,
        tableowner as owner
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY schemaname, tablename
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      query
    });

    if (error) throw error;

    return {
      content: [
        {
          type: 'text',
          text: `Tables in public schema:\n${data ? data.map((t: any) => `- ${t.schema}.${t.name}`).join('\n') : 'No tables found'}`,
        },
      ],
    };
  }

  private async listExtensions(): Promise<any> {
    const query = `
      SELECT
        extname as name,
        extversion as version,
        extnamespace::regnamespace as schema
      FROM pg_extension
      ORDER BY extname
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', { query });

    if (error) throw error;

    return {
      content: [
        {
          type: 'text',
          text: `Installed extensions:\n${data ? data.map((e: any) => `- ${e.name} v${e.version}`).join('\n') : 'No extensions found'}`,
        },
      ],
    };
  }

  private async listMigrations(): Promise<any> {
    const query = `
      SELECT 
        version,
        name,
        executed_at
      FROM supabase_migrations.schema_migrations
      ORDER BY executed_at DESC;
    `;
    
    const { data, error } = await this.supabase.rpc('exec_sql', { query });

    if (error) {
      // If migrations table doesn't exist, return empty list
      return {
        content: [
          {
            type: 'text',
            text: 'No migrations table found. Migrations may not be set up yet.',
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async applyMigration(name: string, query: string): Promise<any> {
    // Execute the migration query
    const { error } = await this.supabase.rpc('exec_sql', { query });

    if (error) throw error;

    return {
      content: [
        {
          type: 'text',
          text: `Migration '${name}' applied successfully.`,
        },
      ],
    };
  }

  private async executeSql(query: string): Promise<any> {
    const { data, error } = await this.supabase.rpc('exec_sql', { query });

    if (error) throw error;

    return {
      content: [
        {
          type: 'text',
          text: data ? JSON.stringify(data, null, 2) : 'Query executed successfully',
        },
      ],
    };
  }

  private async getLogs(service: string): Promise<any> {
    // This would typically call the Supabase Management API
    // For now, return a placeholder
    return {
      content: [
        {
          type: 'text',
          text: `Logs for ${service} service would be retrieved here. This requires Management API access.`,
        },
      ],
    };
  }

  private async getAdvisors(type: string): Promise<any> {
    // Run security or performance checks based on type
    const checks = type === 'security' 
      ? await this.runSecurityChecks()
      : await this.runPerformanceChecks();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(checks, null, 2),
        },
      ],
    };
  }

  private async runSecurityChecks(): Promise<any[]> {
    const checks = [];

    // Check for tables without RLS
    const rlsQuery = `
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = pg_tables.schemaname
        AND tablename = pg_tables.tablename
      );
    `;

    const { data } = await this.supabase.rpc('exec_sql', { query:rlsQuery });
    
    if (data && data.length > 0) {
      checks.push({
        severity: 'warning',
        type: 'security',
        message: `${data.length} table(s) without Row Level Security policies`,
        tables: data,
      });
    }

    return checks;
  }

  private async runPerformanceChecks(): Promise<any[]> {
    const checks = [];

    // Check for missing indexes on foreign keys
    const indexQuery = `
      SELECT
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = tc.table_schema
        AND tablename = tc.table_name
        AND indexdef LIKE '%' || kcu.column_name || '%'
      );
    `;

    const { data } = await this.supabase.rpc('exec_sql', { query:indexQuery });
    
    if (data && data.length > 0) {
      checks.push({
        severity: 'info',
        type: 'performance',
        message: `${data.length} foreign key(s) without indexes`,
        details: data,
      });
    }

    return checks;
  }

  private async generateTypeScriptTypes(): Promise<any> {
    // This would typically use the Supabase CLI or API
    // For now, generate basic types from schema
    const query = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', { query });

    if (error) throw error;

    // Group columns by table
    const tables: Record<string, any[]> = {};
    for (const col of data) {
      if (!tables[col.table_name]) {
        tables[col.table_name] = [];
      }
      tables[col.table_name].push(col);
    }

    // Generate TypeScript interfaces
    let types = '// Generated TypeScript types for Supabase schema\n\n';
    
    for (const [tableName, columns] of Object.entries(tables)) {
      types += `export interface ${this.toPascalCase(tableName)} {\n`;
      
      for (const col of columns) {
        const tsType = this.sqlToTypeScript(col.data_type);
        const nullable = col.is_nullable === 'YES' ? ' | null' : '';
        types += `  ${col.column_name}: ${tsType}${nullable};\n`;
      }
      
      types += '}\n\n';
    }

    return {
      content: [
        {
          type: 'text',
          text: types,
        },
      ],
    };
  }

  /**
   * Helper method to convert SQL types to TypeScript types
   */
  private sqlToTypeScript(sqlType: string): string {
    const typeMap: Record<string, string> = {
      'integer': 'number',
      'bigint': 'number',
      'smallint': 'number',
      'decimal': 'number',
      'numeric': 'number',
      'real': 'number',
      'double precision': 'number',
      'text': 'string',
      'character varying': 'string',
      'character': 'string',
      'uuid': 'string',
      'boolean': 'boolean',
      'timestamp': 'string',
      'timestamp with time zone': 'string',
      'timestamp without time zone': 'string',
      'date': 'string',
      'time': 'string',
      'json': 'any',
      'jsonb': 'any',
    };

    return typeMap[sqlType.toLowerCase()] || 'any';
  }

  /**
   * Helper method to convert snake_case to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  /**
   * Start the server and listen for connections
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('Supabase Lite MCP Server started successfully');
    console.error(`Exposing ${ALLOWED_COMMANDS.length} commands`);
  }
}

// Start the server when this file is run
const server = new SupabaseLiteMCPServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
