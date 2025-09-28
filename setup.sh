#!/bin/bash

# Supabase Lite MCP Server Setup Script
# Automates installation and configuration of the Supabase Lite MCP server

set -e  # Exit on any error

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Utility functions for colored output
print_color() {
    printf "${1}${2}${NC}\n"
}

print_header() {
    echo ""
    print_color "$CYAN" "╔════════════════════════════════════════╗"
    print_color "$CYAN" "║   Supabase Lite MCP Server Setup      ║"
    print_color "$CYAN" "║   Lightweight Database Commands        ║"
    print_color "$CYAN" "╚════════════════════════════════════════╝"
    echo ""
}

print_success() {
    print_color "$GREEN" "✓ $1"
}

print_error() {
    print_color "$RED" "✗ $1"
}

print_warning() {
    print_color "$YELLOW" "⚠ $1"
}

print_info() {
    print_color "$BLUE" "→ $1"
}

print_step() {
    echo ""
    print_color "$BOLD" "[$1] $2"
    echo ""
}

# Verify script is run from correct directory
check_directory() {
    print_step "1/7" "Verifying project directory"

    if [ ! -f "package.json" ]; then
        print_error "package.json not found!"
        print_info "Please run this script from the supabase-lite-mcp directory"
        exit 1
    fi

    # Check if it's the correct package.json
    if ! grep -q "supabase-lite-mcp" package.json; then
        print_error "This doesn't appear to be the supabase-lite-mcp project"
        exit 1
    fi

    print_success "Project directory verified"
}

# Check Node.js version (requires v22+)
check_node() {
    print_step "2/7" "Checking Node.js version"

    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed!"
        print_info "Please install Node.js v22 or higher from https://nodejs.org"
        print_info "Or use nvm: nvm install 22"
        exit 1
    fi

    NODE_VERSION_FULL=$(node -v)
    NODE_VERSION=$(echo $NODE_VERSION_FULL | cut -d'v' -f2 | cut -d'.' -f1)

    if [ "$NODE_VERSION" -lt 22 ]; then
        print_error "Node.js version is too old (found $NODE_VERSION_FULL, need v22+)"
        print_info "Please upgrade Node.js to version 22 or higher"
        print_info "Using nvm? Run: nvm install 22 && nvm use 22"
        exit 1
    fi

    print_success "Node.js $NODE_VERSION_FULL found"
}

# Check npm installation
check_npm() {
    print_step "3/7" "Checking npm"

    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed!"
        print_info "npm should come with Node.js. Please reinstall Node.js"
        exit 1
    fi

    NPM_VERSION=$(npm -v)
    print_success "npm v$NPM_VERSION found"
}

# Install dependencies
install_dependencies() {
    print_step "4/7" "Installing dependencies"

    print_info "Running npm install..."

    if npm install --quiet > /dev/null 2>&1; then
        print_success "Dependencies installed successfully"

        # Show installed packages
        print_info "Installed packages:"
        echo "  - @modelcontextprotocol/sdk"
        echo "  - @supabase/supabase-js"
        echo "  - TypeScript and development tools"
    else
        print_error "Failed to install dependencies"
        print_info "Try running: npm install --verbose"
        exit 1
    fi
}

# Setup environment configuration
setup_env() {
    print_step "5/7" "Configuring environment"

    if [ -f ".env" ]; then
        print_warning ".env file already exists"
        read -p "Do you want to reconfigure it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Keeping existing configuration"
            return
        fi
    fi

    # Create .env from template
    if [ ! -f ".env.example" ]; then
        print_error ".env.example file not found!"
        exit 1
    fi

    print_info "Please enter your Supabase credentials"
    print_info "Find these in your Supabase Dashboard:"
    echo ""
    echo "  1. Go to https://supabase.com/dashboard"
    echo "  2. Select your project"
    echo "  3. Navigate to Settings → API"
    echo ""

    # Get Supabase URL
    while true; do
        read -p "$(print_color "$CYAN" "Supabase URL") (e.g., https://xxxxx.supabase.co): " SUPABASE_URL
        if [[ "$SUPABASE_URL" =~ ^https://[a-zA-Z0-9-]+\.supabase\.co$ ]]; then
            break
        else
            print_error "Invalid URL format. Should be like: https://xxxxx.supabase.co"
        fi
    done

    # Get Service Key
    echo ""
    print_warning "IMPORTANT: Use the SERVICE ROLE key, not the anon key!"
    print_info "The service role key starts with 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'"
    echo ""

    while true; do
        read -p "$(print_color "$CYAN" "Service Role Key"): " SUPABASE_KEY
        if [[ "$SUPABASE_KEY" =~ ^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$ ]]; then
            break
        else
            print_error "Invalid key format. Make sure you're using the SERVICE ROLE key"
        fi
    done

    # Get Project Ref (optional)
    echo ""
    read -p "$(print_color "$CYAN" "Project Reference") (optional, press Enter to skip): " PROJECT_REF

    # Write to .env file
    cat > .env << EOF
# Supabase Configuration
# Generated by setup.sh on $(date)

# Your Supabase project URL
SUPABASE_URL=$SUPABASE_URL

# Service role key (NOT the anon key!)
# This key has full database access - keep it secret!
SUPABASE_SERVICE_KEY=$SUPABASE_KEY

# Optional: Project reference ID
SUPABASE_PROJECT_REF=$PROJECT_REF
EOF

    print_success "Environment configuration saved to .env"

    # Add .env to .gitignore if not already there
    if [ -f ".gitignore" ]; then
        if ! grep -q "^\.env$" .gitignore; then
            echo ".env" >> .gitignore
            print_success "Added .env to .gitignore for security"
        fi
    else
        echo ".env" > .gitignore
        print_success "Created .gitignore with .env entry"
    fi
}

# Build the TypeScript project
build_project() {
    print_step "6/7" "Building TypeScript project"

    print_info "Compiling TypeScript to JavaScript..."

    if npm run build > /dev/null 2>&1; then
        print_success "Build completed successfully"

        # Verify build output
        if [ -d "dist" ] && [ -f "dist/index.js" ]; then
            print_success "Build artifacts verified in dist/"
        else
            print_warning "Build completed but output files not found"
        fi
    else
        print_error "Build failed"
        print_info "Try running: npm run build"
        exit 1
    fi
}

# Test the server
test_server() {
    print_step "7/7" "Testing server"

    print_info "Would you like to test the server now?"
    read -p "Start server in development mode? (Y/n): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        print_info "Starting server..."
        print_info "If successful, you'll see: 'Supabase Lite MCP Server started successfully'"
        print_info "Press Ctrl+C to stop the test"
        echo ""

        # Run with timeout
        timeout 5s npm run dev 2>&1 | head -n 10

        if [ $? -eq 124 ]; then
            print_success "Server started successfully (test timeout after 5s)"
        else
            print_warning "Server test completed"
        fi
    else
        print_info "Skipping server test"
    fi
}

# Setup global npm link (optional)
setup_npm_link() {
    echo ""
    print_info "Would you like to install globally?"
    print_info "This allows using 'supabase-lite-mcp' command anywhere"
    read -p "Create global npm link? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if npm link > /dev/null 2>&1; then
            print_success "Global link created"
            print_info "You can now use 'supabase-lite-mcp' in MCP configs"
        else
            print_warning "Global link failed (may need sudo)"
            print_info "Try: sudo npm link"
        fi
    fi
}

# Show final configuration instructions
show_configuration() {
    print_header
    print_color "$GREEN" "🎉 Setup Complete!"
    echo ""

    print_color "$BOLD" "Next Steps:"
    echo ""

    print_info "1. Add to your Claude MCP configuration (.mcp.json):"
    echo ""
    cat << EOF
{
  "mcpServers": {
    "supabase-lite": {
      "command": "node",
      "args": ["$(pwd)/dist/index.js"],
      "env": {
        "SUPABASE_URL": "\${SUPABASE_URL}",
        "SUPABASE_SERVICE_KEY": "\${SUPABASE_SERVICE_KEY}"
      }
    }
  }
}
EOF

    echo ""
    print_info "2. Available npm scripts:"
    echo "   npm run dev    - Development mode with hot reload"
    echo "   npm run build  - Build TypeScript to JavaScript"
    echo "   npm start      - Run production build"
    echo "   npm run clean  - Clean build artifacts"

    echo ""
    print_info "3. Available MCP commands (8 total, ~3,700 tokens):"
    echo "   • list_tables              • get_logs"
    echo "   • list_extensions          • get_advisors"
    echo "   • list_migrations          • generate_typescript_types"
    echo "   • apply_migration          • execute_sql"

    echo ""
    print_color "$CYAN" "Documentation: README.md"
    print_color "$CYAN" "Token savings: ~11,100 tokens vs full Supabase MCP"
    echo ""
}

# Error handler
handle_error() {
    echo ""
    print_error "Setup failed!"
    print_info "Check the error messages above for details"
    print_info "For help, see README.md or run: npm run dev"
    exit 1
}

# Set error trap
trap handle_error ERR

# Main setup flow
main() {
    print_header

    check_directory
    check_node
    check_npm
    install_dependencies
    setup_env
    build_project
    test_server
    setup_npm_link
    show_configuration

    print_color "$GREEN" "✨ Supabase Lite MCP server is ready to use!"
}

# Run the setup
main