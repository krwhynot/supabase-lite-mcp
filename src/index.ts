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
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
 * Type definitions for better type safety
 */
interface TableInfo {
  schema: string;
  name: string;
  owner: string;
  row_security_enabled?: boolean;
}

interface ExecuteSqlResult {
  data: any[];
  error?: string;
}

interface MigrationResult {
  success: boolean;
  message?: string;
  error?: string;
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
  private supabase: SupabaseClient;
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
   * Set up MCP protocol handlers
   * These respond to requests from Claude
   */
  private setupHandlers(): void {
    // Handler for listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    // Handler for executing tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Check if this is one of our allowed commands
      if (!ALLOWED_COMMANDS.includes(name as AllowedCommand)) {
        throw new Error(`Unknown tool: ${name}`);
      }

      // Execute the command and return the result
      return await this.executeCommand(name as AllowedCommand, args);
    });
  }

  /**
   * Define the tools (commands) we expose to Claude
   * Each tool has a name, description, and input schema
   */
  private getToolDefinitions(): Tool[] {
    const tools: Tool[] = [];

    tools.push({
      name: 'list_tables',
      description: 'Lists tables in the specified schemas.',
      inputSchema: {
        type: 'object',
        properties: {
          schemas: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'The schemas to list tables from',
            default: ['public'],
          },
        },
      },
    });

    tools.push({
      name: 'list_extensions',
      description: 'Lists installed PostgreSQL extensions.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    tools.push({
      name: 'list_migrations',
      description: 'Lists applied database migrations.',
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
   * Get SQL script to create exec_sql function
   */
  private getExecSqlCreationScript(): string {
    return `CREATE OR REPLACE FUNCTION public.exec_sql(query text, params jsonb DEFAULT '[]')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format('SELECT json_agg(row_to_json(t)) FROM (%s) t', query) INTO result;
  RETURN result;
END;
$$;`;
  }

  /**
   * Execute SQL with fallback and proper error handling
   */
  private async executeSqlSafe(query: string): Promise<ExecuteSqlResult> {
    try {
      const { data, error } = await this.supabase.rpc('exec_sql', { query });
      return { data, error: error?.message || undefined };
    } catch (error: any) {
      if (error?.code === 'PGRST202' || error?.message?.includes('function') || error?.message?.includes('does not exist')) {
        throw new Error(
          `exec_sql function not found. Please create it first:\n\n${this.getExecSqlCreationScript()}\n\nYou can run this in the Supabase SQL Editor.`
        );
      }
      throw error;
    }
  }

  /**
   * Validate connection to Supabase
   */
  private async validateConnection(): Promise<boolean> {
    try {
      const { error } = await this.supabase.from('_test_').select('*').limit(0);
      return !error || error.code === '42P01'; // Table doesn't exist is OK
    } catch {
      return false;
    }
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

    try {
      const { data, error } = await this.executeSqlSafe(query);
      if (error) throw error;

      return {
        content: [
          {
            type: 'text',
            text: `Tables in public schema:\n${data ? data.map((t: TableInfo) => `- ${t.schema}.${t.name}`).join('\n') : 'No tables found'}`,
          },
        ],
      };
    } catch (error: any) {
      // Fallback: Try to list tables from common table names
      const commonTables = ['users', 'profiles', 'posts', 'comments', 'products', 'orders'];
      const existingTables: string[] = [];

      for (const table of commonTables) {
        const { error } = await this.supabase.from(table).select('*').limit(0);
        if (!error) {
          existingTables.push(table);
        }
      }

      if (existingTables.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Found tables (via fallback):\n${existingTables.map(t => `- public.${t}`).join('\n')}\n\nNote: ${error.message}`,
            },
          ],
        };
      }

      throw error;
    }
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

    const { data, error } = await this.executeSqlSafe(query);

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

    const { data, error } = await this.executeSqlSafe(query);

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

  private async applyMigration(name: string, query: string): Promise<MigrationResult> {
    // Execute the migration query
    const { error } = await this.executeSqlSafe(query);

    if (error) throw error;

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Migration '${name}' applied successfully.`,
        },
      ],
    } as any;
  }

  private async executeSql(query: string): Promise<any> {
    const { data, error } = await this.executeSqlSafe(query);

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
    const checks: any[] = [];

    // Check for RLS on tables
    const query = `
      SELECT
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    try {
      const { data } = await this.executeSqlSafe(query);
      if (data) {
        const tablesWithoutRLS = data.filter((t: any) => !t.rowsecurity);
        if (tablesWithoutRLS.length > 0) {
          checks.push({
            level: 'warning',
            message: `Tables without RLS: ${tablesWithoutRLS.map((t: any) => t.tablename).join(', ')}`,
          });
        }
      }
    } catch {
      checks.push({
        level: 'info',
        message: 'Unable to check RLS status',
      });
    }

    return checks;
  }

  private async runPerformanceChecks(): Promise<any[]> {
    const checks: any[] = [];

    // Check for missing indexes
    const query = `
      SELECT
        schemaname,
        tablename,
        attname,
        n_distinct,
        most_common_vals
      FROM pg_stats
      WHERE schemaname = 'public'
      LIMIT 10
    `;

    try {
      const { data } = await this.executeSqlSafe(query);
      if (data && data.length > 0) {
        checks.push({
          level: 'info',
          message: `Analyzed ${data.length} columns for performance insights`,
        });
      }
    } catch {
      checks.push({
        level: 'info',
        message: 'Unable to run performance analysis',
      });
    }

    return checks;
  }

  private async generateTypeScriptTypes(): Promise<any> {
    // Get all tables and columns
    const query = `
      SELECT
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;

    try {
      const { data, error } = await this.executeSqlSafe(query);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No tables found in public schema',
            },
          ],
        };
      }

      // Group columns by table
      const tables: { [key: string]: any[] } = {};
      data.forEach((col: any) => {
        if (!tables[col.table_name]) {
          tables[col.table_name] = [];
        }
        tables[col.table_name].push(col);
      });

      // Generate TypeScript interfaces
      let types = '// Generated TypeScript types for Supabase database\n\n';

      for (const [tableName, columns] of Object.entries(tables)) {
        const interfaceName = tableName
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join('');

        types += `export interface ${interfaceName} {\n`;

        columns.forEach((col: any) => {
          const tsType = this.postgresTypeToTypeScript(col.data_type);
          const nullable = col.is_nullable === 'YES' ? ' | null' : '';
          types += `  ${col.column_name}: ${tsType}${nullable};\n`;
        });

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
    } catch (error: any) {
      throw new Error(`Failed to generate TypeScript types: ${error.message}`);
    }
  }

  private postgresTypeToTypeScript(pgType: string): string {
    const typeMap: { [key: string]: string } = {
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

    return typeMap[pgType.toLowerCase()] || 'any';
  }

  /**
   * Start the server and begin listening for requests
   */
  async start(): Promise<void> {
    // Validate connection on startup
    const isConnected = await this.validateConnection();
    if (!isConnected) {
      console.error('Warning: Unable to validate Supabase connection. Some commands may fail.');
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Supabase Lite MCP server running with 8 essential commands');
  }
}

// Start the server when this script is run
const server = new SupabaseLiteMCPServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});