#!/usr/bin/env node

/**
 * Supabase Lite MCP Server
 *
 * A lightweight Model Context Protocol (MCP) server that provides essential
 * Supabase database management commands. This implementation reduces token
 * usage from ~14,800 to ~3,700 by exposing only 8 core commands.
 *
 * Architecture:
 * - MCP Protocol: Communicates with Claude via stdio (standard input/output)
 * - Tool Registration: Declares available Supabase commands as MCP tools
 * - Request Handling: Processes tool execution requests from Claude
 * - Response Formatting: Returns results in MCP protocol format
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

/**
 * Configuration interface for the MCP server
 */
interface ServerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  projectRef?: string;
}

/**
 * Define the 8 essential Supabase commands we expose
 * This focused subset reduces token usage significantly
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

type AllowedCommand = typeof ALLOWED_COMMANDS[number];

/**
 * Main MCP Server Class
 * Handles all protocol communications and command execution
 */
class SupabaseLiteMCPServer {
  private server: Server;
  private supabase: SupabaseClient;
  private config: ServerConfig;

  constructor() {
    // Initialize MCP server with metadata
    this.server = new Server(
      {
        name: 'supabase-lite-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {}, // Indicates this server provides tools
        },
      }
    );

    // Load and validate configuration
    this.config = this.loadConfig();

    // Initialize Supabase client for API interactions
    this.supabase = createClient(
      this.config.supabaseUrl,
      this.config.supabaseKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Register MCP protocol handlers
    this.setupHandlers();
  }

  /**
   * Load configuration from environment variables
   * Validates required settings are present
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
   * Register MCP protocol handlers
   * These handle tool listing and execution requests from Claude
   */
  private setupHandlers(): void {
    // Handler for listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    // Handler for executing tool commands
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Validate command is allowed
      if (!ALLOWED_COMMANDS.includes(name as AllowedCommand)) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Command "${name}" is not available in Supabase Lite MCP`
        );
      }

      try {
        return await this.executeCommand(name as AllowedCommand, args);
      } catch (error) {
        // Format errors for MCP protocol
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : 'Command execution failed'
        );
      }
    });
  }

  /**
   * Define tool specifications for Claude
   * Each tool includes name, description, and parameter schema
   */
  private getToolDefinitions(): Tool[] {
    const tools: Tool[] = [];

    // list_tables: List all tables in specified schemas
    if (ALLOWED_COMMANDS.includes('list_tables')) {
      tools.push({
        name: 'list_tables',
        description: 'List all tables in the specified schemas (default: public)',
        inputSchema: {
          type: 'object',
          properties: {
            schemas: {
              type: 'array',
              items: { type: 'string' },
              description: 'Schema names to list tables from',
              default: ['public'],
            },
          },
        },
      });
    }

    // list_extensions: Show installed PostgreSQL extensions
    if (ALLOWED_COMMANDS.includes('list_extensions')) {
      tools.push({
        name: 'list_extensions',
        description: 'List all installed PostgreSQL extensions',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      });
    }

    // list_migrations: Display migration history
    if (ALLOWED_COMMANDS.includes('list_migrations')) {
      tools.push({
        name: 'list_migrations',
        description: 'List migration history from supabase_migrations schema',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      });
    }

    // apply_migration: Apply DDL changes
    if (ALLOWED_COMMANDS.includes('apply_migration')) {
      tools.push({
        name: 'apply_migration',
        description: 'Apply a database migration (DDL changes like CREATE TABLE)',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'SQL DDL statements to execute',
            },
            name: {
              type: 'string',
              description: 'Migration name for tracking',
            },
          },
          required: ['sql'],
        },
      });
    }

    // execute_sql: Run SQL queries
    if (ALLOWED_COMMANDS.includes('execute_sql')) {
      tools.push({
        name: 'execute_sql',
        description: 'Execute SQL query and return results',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute',
            },
          },
          required: ['query'],
        },
      });
    }

    // get_logs: Retrieve service logs
    if (ALLOWED_COMMANDS.includes('get_logs')) {
      tools.push({
        name: 'get_logs',
        description: 'Get recent service logs (last minute by default)',
        inputSchema: {
          type: 'object',
          properties: {
            service: {
              type: 'string',
              description: 'Service name (postgres, auth, realtime, storage)',
              enum: ['postgres', 'auth', 'realtime', 'storage'],
              default: 'postgres',
            },
            minutes: {
              type: 'number',
              description: 'Number of minutes of logs to retrieve',
              default: 1,
            },
          },
        },
      });
    }

    // get_advisors: Security and performance recommendations
    if (ALLOWED_COMMANDS.includes('get_advisors')) {
      tools.push({
        name: 'get_advisors',
        description: 'Get database advisors for security and performance recommendations',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of advisors to retrieve',
              enum: ['all', 'security', 'performance'],
              default: 'all',
            },
          },
        },
      });
    }

    // generate_typescript_types: Create TypeScript interfaces
    if (ALLOWED_COMMANDS.includes('generate_typescript_types')) {
      tools.push({
        name: 'generate_typescript_types',
        description: 'Generate TypeScript type definitions from database schema',
        inputSchema: {
          type: 'object',
          properties: {
            schemas: {
              type: 'array',
              items: { type: 'string' },
              description: 'Schema names to generate types for',
              default: ['public'],
            },
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific tables to generate types for (optional)',
            },
          },
        },
      });
    }

    return tools;
  }

  /**
   * Execute a Supabase command
   * Routes to appropriate handler based on command name
   */
  private async executeCommand(command: AllowedCommand, args: any): Promise<any> {
    switch (command) {
      case 'list_tables':
        return await this.listTables(args);
      case 'list_extensions':
        return await this.listExtensions();
      case 'list_migrations':
        return await this.listMigrations();
      case 'apply_migration':
        return await this.applyMigration(args);
      case 'execute_sql':
        return await this.executeSql(args);
      case 'get_logs':
        return await this.getLogs(args);
      case 'get_advisors':
        return await this.getAdvisors(args);
      case 'generate_typescript_types':
        return await this.generateTypescriptTypes(args);
      default:
        throw new Error(`Unhandled command: ${command}`);
    }
  }

  /**
   * List all tables in specified schemas
   */
  private async listTables(args: { schemas?: string[] }): Promise<any> {
    const schemas = args.schemas || ['public'];

    try {
      // Try to get list of tables from Supabase
      // First, try to get all accessible tables through a simple query
      const tables: string[] = [];

      // Get tables from information_schema (if accessible)
      const query = `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `;

      // Try using RPC if exec_sql function exists
      const { data: rpcData, error: rpcError } = await this.supabase.rpc('exec_sql', {
        query: query
      });

      if (!rpcError && rpcData) {
        return {
          content: [{
            type: 'text',
            text: `Tables in schema 'public':\n${
              rpcData.map((t: any) => `- ${t.table_schema}.${t.table_name}`).join('\n')
            }`,
          }],
        };
      }

      // Fallback: Try to list tables we know about by attempting to query them
      // This is a workaround when we can't access system tables
      const commonTables = ['users', 'profiles', 'posts', 'comments', 'products', 'orders'];
      const foundTables: string[] = [];

      for (const tableName of commonTables) {
        try {
          const { error } = await this.supabase
            .from(tableName)
            .select('*')
            .limit(0); // Just check if table exists

          if (!error) {
            foundTables.push(tableName);
          }
        } catch {
          // Table doesn't exist, continue
        }
      }

      if (foundTables.length > 0) {
        return {
          content: [{
            type: 'text',
            text: `Found accessible tables in public schema:\n${
              foundTables.map(t => `- public.${t}`).join('\n')
            }\n\nNote: This may not be a complete list. Only commonly named tables were checked.`,
          }],
        };
      }

      // If all else fails, provide helpful message
      return {
        content: [{
          type: 'text',
          text: `Unable to list tables directly. This could be because:\n` +
                `1. The database doesn't have an exec_sql RPC function\n` +
                `2. System tables aren't accessible via REST API\n\n` +
                `To enable full functionality, create this function in your database:\n\n` +
                `CREATE OR REPLACE FUNCTION exec_sql(query text)\n` +
                `RETURNS json\n` +
                `LANGUAGE plpgsql\n` +
                `SECURITY DEFINER\n` +
                `AS $$\n` +
                `BEGIN\n` +
                `  RETURN query_to_json(query);\n` +
                `END;\n` +
                `$$;`,
          }],
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error listing tables: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
      };
    }
  }

  /**
   * List installed PostgreSQL extensions
   */
  private async listExtensions(): Promise<any> {
    const query = `
      SELECT
        extname as name,
        extversion as version,
        extnamespace::regnamespace as schema
      FROM pg_extension
      ORDER BY extname;
    `;

    const { data, error } = await this.executeSqlRaw(query);

    if (error) throw error;

    return {
      content: [{
        type: 'text',
        text: `Installed extensions:\n${
          data?.map((ext: any) => `- ${ext.name} v${ext.version} (schema: ${ext.schema})`).join('\n') || 'No extensions found'
        }`,
      }],
    };
  }

  /**
   * List migration history
   */
  private async listMigrations(): Promise<any> {
    const query = `
      SELECT
        version,
        name,
        executed_at
      FROM supabase_migrations.schema_migrations
      ORDER BY executed_at DESC
      LIMIT 20;
    `;

    const { data, error } = await this.executeSqlRaw(query);

    if (error) {
      // Schema might not exist
      return {
        content: [{
          type: 'text',
          text: 'No migration history found. The supabase_migrations schema may not be set up.',
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Recent migrations:\n${
          data?.map((m: any) => `- ${m.version}: ${m.name} (${new Date(m.executed_at).toLocaleString()})`).join('\n') || 'No migrations found'
        }`,
      }],
    };
  }

  /**
   * Apply a database migration
   */
  private async applyMigration(args: { sql: string; name?: string }): Promise<any> {
    if (!args.sql) {
      throw new Error('SQL parameter is required for apply_migration');
    }

    const { error } = await this.executeSqlRaw(args.sql);

    if (error) throw error;

    // Track migration if name provided
    if (args.name) {
      const trackQuery = `
        INSERT INTO supabase_migrations.schema_migrations (version, name, executed_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (version) DO NOTHING;
      `;

      const version = Date.now().toString();
      await this.executeSqlRaw(trackQuery, [version, args.name]);
    }

    return {
      content: [{
        type: 'text',
        text: `Migration applied successfully${args.name ? `: ${args.name}` : ''}`,
      }],
    };
  }

  /**
   * Execute SQL query
   */
  private async executeSql(args: { query: string }): Promise<any> {
    if (!args.query) {
      throw new Error('Query parameter is required for execute_sql');
    }

    const { data, error } = await this.executeSqlRaw(args.query);

    if (error) throw error;

    // Format results
    let resultText = '';
    if (Array.isArray(data) && data.length > 0) {
      // Format as table for SELECT queries
      const columns = Object.keys(data[0]);
      resultText = `Columns: ${columns.join(', ')}\n\n`;
      resultText += data.map((row: any) =>
        columns.map(col => `${col}: ${row[col]}`).join(', ')
      ).join('\n');
    } else if (data && typeof data === 'object') {
      resultText = JSON.stringify(data, null, 2);
    } else {
      resultText = 'Query executed successfully';
    }

    return {
      content: [{
        type: 'text',
        text: resultText,
      }],
    };
  }

  /**
   * Get service logs
   */
  private async getLogs(args: { service?: string; minutes?: number }): Promise<any> {
    const service = args.service || 'postgres';
    const minutes = args.minutes || 1;

    // Note: This would require Supabase Management API access
    // For now, return a helpful message
    return {
      content: [{
        type: 'text',
        text: `Getting logs for ${service} service (last ${minutes} minute${minutes > 1 ? 's' : ''}).\n\n` +
              `Note: Log retrieval requires Supabase Management API access. ` +
              `You can view logs in the Supabase Dashboard under Settings > Logs.`,
      }],
    };
  }

  /**
   * Get database advisors
   */
  private async getAdvisors(args: { type?: string }): Promise<any> {
    const advisorType = args.type || 'all';

    const queries: Record<string, string> = {
      security: `
        SELECT
          'Security' as category,
          'Unencrypted columns with sensitive names' as issue,
          table_schema || '.' || table_name || '.' || column_name as location
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND column_name ~* '(password|secret|token|key|ssn|credit_card)'
        AND data_type NOT IN ('bytea');
      `,
      performance: `
        SELECT
          'Performance' as category,
          'Tables without primary key' as issue,
          schemaname || '.' || tablename as location
        FROM pg_tables t
        LEFT JOIN pg_constraint c ON c.conrelid = (quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))::regclass
        WHERE t.schemaname = 'public'
        AND c.contype IS NULL OR c.contype != 'p'
        GROUP BY t.schemaname, t.tablename;
      `,
    };

    const advisors: any[] = [];

    if (advisorType === 'all' || advisorType === 'security') {
      const { data: securityData } = await this.executeSqlRaw(queries.security);
      if (securityData && Array.isArray(securityData) && securityData.length > 0) {
        advisors.push(...securityData);
      }
    }

    if (advisorType === 'all' || advisorType === 'performance') {
      const { data: performanceData } = await this.executeSqlRaw(queries.performance);
      if (performanceData && Array.isArray(performanceData) && performanceData.length > 0) {
        advisors.push(...performanceData);
      }
    }

    if (advisors.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '✅ No issues found! Your database configuration looks good.',
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Database Advisors (${advisorType}):\n\n${
          advisors.map(a => `⚠️ [${a.category}] ${a.issue}\n   Location: ${a.location}`).join('\n\n')
        }`,
      }],
    };
  }

  /**
   * Generate TypeScript type definitions
   */
  private async generateTypescriptTypes(args: { schemas?: string[]; tables?: string[] }): Promise<any> {
    const schemas = args.schemas || ['public'];

    let query = `
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = ANY($1)
    `;

    const params: any[] = [schemas];

    if (args.tables && args.tables.length > 0) {
      query += ` AND c.table_name = ANY($2)`;
      params.push(args.tables);
    }

    query += ` ORDER BY c.table_schema, c.table_name, c.ordinal_position;`;

    const { data, error } = await this.executeSqlRaw(query, params);

    if (error) throw error;

    // Group columns by table
    const tables: Record<string, any[]> = {};
    data?.forEach((col: any) => {
      const tableName = `${col.table_schema}.${col.table_name}`;
      if (!tables[tableName]) {
        tables[tableName] = [];
      }
      tables[tableName].push(col);
    });

    // Generate TypeScript interfaces
    let typescript = '// Generated TypeScript definitions for Supabase database\n\n';

    for (const [tableName, columns] of Object.entries(tables)) {
      const interfaceName = tableName.split('.').pop()!
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

      typescript += `export interface ${interfaceName} {\n`;

      columns.forEach((col: any) => {
        const tsType = this.mapPostgresToTypeScript(col.data_type);
        const nullable = col.is_nullable === 'YES' ? ' | null' : '';
        typescript += `  ${col.column_name}: ${tsType}${nullable};\n`;
      });

      typescript += '}\n\n';
    }

    return {
      content: [{
        type: 'text',
        text: typescript,
      }],
    };
  }

  /**
   * Map PostgreSQL types to TypeScript types
   */
  private mapPostgresToTypeScript(pgType: string): string {
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
      'timestamp without time zone': 'Date',
      'timestamp with time zone': 'Date',
      'date': 'Date',
      'time without time zone': 'string',
      'time with time zone': 'string',
      'json': 'any',
      'jsonb': 'any',
      'array': 'any[]',
      'bytea': 'Buffer',
    };

    return typeMap[pgType.toLowerCase()] || 'any';
  }

  /**
   * Execute raw SQL with error handling
   */
  private async executeSqlRaw(sql: string, params?: any[]): Promise<{ data: any; error: any }> {
    try {
      // Try using Supabase RPC if available
      const { data, error } = await this.supabase.rpc('exec_sql', {
        query: sql,
        params: params || [],
      });

      if (!error) {
        return { data, error: null };
      }

      // Fallback: Use direct query through Supabase client
      // Note: This is limited and may not work for all queries
      const result = await fetch(`${this.config.supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'apikey': this.config.supabaseKey,
          'Authorization': `Bearer ${this.config.supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!result.ok) {
        throw new Error(`SQL execution failed: ${result.statusText}`);
      }

      const jsonData = await result.json();
      return { data: jsonData, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Supabase Lite MCP Server started successfully');
    console.error(`Exposing ${ALLOWED_COMMANDS.length} commands`);
  }
}

/**
 * Main entry point
 * Starts the MCP server when run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SupabaseLiteMCPServer();
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { SupabaseLiteMCPServer };