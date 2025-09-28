# Supabase Lite MCP Server

## Overview

The Supabase Lite MCP Server is a lightweight Model Context Protocol (MCP) server that provides essential Supabase database management commands. This focused implementation reduces token usage from ~14,800 to ~3,700 tokens by exposing only 8 core commands instead of the full 26.

## Features

- 🚀 **Minimal Token Usage**: Only ~3,700 tokens vs ~14,800 for the full Supabase MCP
- 🎯 **Essential Commands Only**: 8 carefully selected database management commands
- 📦 **Easy Installation**: Automated setup script with environment validation
- 🔧 **TypeScript**: Full type safety and modern ES modules
- 🔐 **Secure**: Uses service role keys with proper environment variable handling
- 🛠️ **Production Ready**: Error handling, logging, and MCP protocol compliance

## Quick Start

### Automated Installation

```bash
# Clone the repository
git clone https://github.com/your-username/supabase-lite-mcp.git
cd supabase-lite-mcp

# Run the setup script
./setup.sh
```

The setup script will:
- Check Node.js version (requires v22+)
- Install dependencies
- Guide you through configuration
- Build the TypeScript code
- Optionally test the server

### Manual Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Test the server:**
   ```bash
   npm run dev
   ```

## Configuration

### Environment Variables

Create a `.env` file with your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_PROJECT_REF=your-project-ref  # Optional
```

Get these from your Supabase dashboard:
- **URL**: Settings → API → Project URL
- **Service Key**: Settings → API → Service role key (NOT anon key!)
- **Project Ref**: Settings → General → Reference ID

### Claude Integration

Add to your MCP configuration file (`.mcp.json`):

```json
{
  "mcpServers": {
    "supabase-lite": {
      "command": "node",
      "args": ["path/to/supabase-lite-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "${SUPABASE_URL}",
        "SUPABASE_SERVICE_KEY": "${SUPABASE_SERVICE_KEY}"
      }
    }
  }
}
```

Or use npm link for global access:

```bash
cd supabase-lite-mcp
npm link
```

Then use `"command": "supabase-lite-mcp"` in your MCP config.

## Available Commands

### 1. list_tables
Lists all tables in specified schemas.
- **Use case**: Discovering database structure
- **Token cost**: 457 tokens

### 2. list_extensions
Shows installed PostgreSQL extensions.
- **Use case**: Checking available database features
- **Token cost**: 413 tokens

### 3. list_migrations
Displays migration history.
- **Use case**: Tracking schema changes
- **Token cost**: 413 tokens

### 4. apply_migration
Applies DDL changes to the database.
- **Use case**: Creating tables, indexes, etc.
- **Token cost**: 485 tokens

### 5. execute_sql
Runs SQL queries for data operations.
- **Use case**: Querying and modifying data
- **Token cost**: 474 tokens

### 6. get_logs
Retrieves service logs from the last minute.
- **Use case**: Debugging issues
- **Token cost**: 516 tokens

### 7. get_advisors
Provides security and performance recommendations.
- **Use case**: Database optimization
- **Token cost**: 516 tokens

### 8. generate_typescript_types
Creates TypeScript interfaces from schema.
- **Use case**: Type-safe development
- **Token cost**: 417 tokens

## Architecture

### How It Works

The server implements the Model Context Protocol (MCP) to communicate with Claude:

```
Claude ↔️ MCP Protocol (stdio) ↔️ Server ↔️ Supabase API
```

### Key Components

- **MCP Server**: Handles protocol communication via stdio
- **Tool Registry**: Defines available commands and their schemas
- **Command Handlers**: Execute Supabase operations
- **Type Safety**: Full TypeScript with strict typing
- **Error Handling**: Graceful error reporting in MCP format

## Extending the Server

### Adding New Commands

1. Add command to `ALLOWED_COMMANDS` in `src/index.ts`
2. Define tool schema in `getToolDefinitions()`
3. Add case in `executeCommand()` switch
4. Implement handler method

Example:
```typescript
// 1. Add to ALLOWED_COMMANDS
const ALLOWED_COMMANDS = [
  // ... existing commands
  'custom_command'
] as const;

// 2. Add tool definition
tools.push({
  name: 'custom_command',
  description: 'My custom command',
  inputSchema: {
    type: 'object',
    properties: {
      param: { type: 'string' }
    }
  }
});

// 3. Add case in executeCommand
case 'custom_command':
  return await this.customCommand(args);

// 4. Implement handler
private async customCommand(args: any): Promise<any> {
  // Your implementation
  return {
    content: [{
      type: 'text',
      text: 'Result'
    }]
  };
}
```

## Development

### Scripts

- `npm run build` - Build TypeScript to JavaScript
- `npm run dev` - Run in development mode with hot reload
- `npm start` - Run production build
- `npm run clean` - Clean build artifacts

### Project Structure

```
supabase-lite-mcp/
├── src/
│   └── index.ts        # Main server implementation
├── dist/              # Compiled JavaScript (generated)
├── .env               # Environment variables (create from .env.example)
├── .env.example       # Environment template
├── package.json       # Node.js configuration
├── tsconfig.json      # TypeScript configuration
├── setup.sh          # Installation script
└── README.md         # Documentation
```

## Comparison with Full Supabase MCP

| Feature | Full Supabase MCP | Supabase Lite MCP |
|---------|------------------|-------------------|
| Commands | 26 | 8 (essential only) |
| Token Usage | ~14,800 | ~3,700 |
| Startup Time | ~2s | <1s |
| Memory Usage | ~50MB | ~30MB |
| Focus | Complete platform | Database only |

## Security

- 🔒 Never commit `.env` files
- 🔑 Use service role keys carefully (full database access)
- 🔄 Rotate keys regularly
- 🌐 Consider network isolation for production

## Troubleshooting

### Common Issues

**Server won't start:**
- Check Node.js version: `node --version` (requires v22+)
- Verify `.env` file exists with valid credentials
- Run `npm run build` to compile TypeScript

**Authentication errors:**
- Ensure you're using the service role key, not anon key
- Check if the key has been regenerated in Supabase dashboard

**Build errors:**
- Run `npm install` to install dependencies
- Check TypeScript version: `npx tsc --version`

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- [Supabase JavaScript Client](https://github.com/supabase/supabase-js)
- [TypeScript](https://www.typescriptlang.org/)
