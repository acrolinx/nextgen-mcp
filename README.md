# Acrolinx MCP Server

A Model Context Protocol (MCP) server that integrates with the Acrolinx NextGen API to provide advanced text analysis and improvement capabilities to AI assistants like Claude and Cursor.

## Features

- **Text Rewriting**: Automatically improve text for clarity, tone, and style guide compliance
- **Content Analysis**: Get detailed quality scores across multiple dimensions
- **Writing Suggestions**: Receive specific recommendations for text improvements
- **Style Guide Support**: AP, Chicago Manual of Style, Microsoft, and Proofpoint
- **Multiple Dialects**: American, British, Australian, and Canadian English
- **Tone Flexibility**: Academic, business, casual, conversational, formal, gen-z, informal, and technical

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- An Acrolinx API key

### Setup

1. Clone the repository:

```bash
git clone https://github.com/acrolinx/nextgen-mcp.git
cd nextgen-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
cp .env.example .env
# Edit .env and add your ACROLINX_API_KEY
```

4. Build the project:

```bash
npm run build
```

## Configuration

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `ACROLINX_API_KEY` | Yes | Your Acrolinx API key | - |
| `ACROLINX_BASE_URL` | No | API base URL | `https://app.acrolinx.cloud` |
| `DEBUG` | No | Enable debug logging | `false` |
| `MAX_TEXT_LENGTH` | No | Maximum text length (chars) | `100000` |
| `WORKFLOW_TIMEOUT` | No | Workflow timeout (ms) | `60000` |
| `POLL_INTERVAL` | No | Status check interval (ms) | `2000` |
| `MAX_RETRIES` | No | API retry attempts | `3` |

## Usage with AI IDEs

This MCP server is compatible with any IDE that supports the Model Context Protocol, including Claude Desktop and Cursor.

### Configuration

The configuration is identical for all MCP-compatible IDEs. Only the **configuration file location** differs:

| IDE | Configuration File Location |
|-----|----------------------------|
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** (macOS/Linux) | `~/.cursor/mcp.json` |
| **Cursor** (Windows) | `%USERPROFILE%\.cursor\mcp.json` |

### Option 1: Run directly from GitHub (recommended)

Add this configuration to your IDE's MCP configuration file:

```json
{
  "mcpServers": {
    "acrolinx": {
      "command": "npx",
      "args": [
        "-y",
        "github:acrolinx/nextgen-mcp"
      ],
      "env": {
        "ACROLINX_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Option 2: Run from local installation

For local development or if you prefer to run from a local installation:

```json
{
  "mcpServers": {
    "acrolinx": {
      "command": "node",
      "args": ["/path/to/nextgen-mcp/dist/index.js"],
      "env": {
        "ACROLINX_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Note**: After updating the configuration, restart your IDE for the changes to take effect.

### Using with Cursor

When using this MCP server with Cursor, you'll see a "Calling undefined" message with a "Run tool" button when the AI wants to use Acrolinx tools. This is **normal behavior** - simply click "Run tool" to approve the analysis. This manual approval is Cursor's security feature for MCP tool execution.

## Available Tools

### `acrolinx_rewrite`

Automatically rewrite and improve text content.

**Parameters:**

- `text` (required): The text to rewrite
- `dialect`: Language dialect (default: "american_english")
- `tone`: Desired tone (default: "formal")
- `style_guide`: Style guide to follow (default: "microsoft")

### `acrolinx_check`

Analyze text for quality issues without making changes.

**Parameters:**

- `text` (required): The text to analyze
- `dialect`: Language dialect (default: "american_english")
- `tone`: Target tone to check against (default: "formal")
- `style_guide`: Style guide to check against (default: "microsoft")

### `acrolinx_suggestions`

Get detailed editing suggestions for improving text.

**Parameters:**

- `text` (required): The text to get suggestions for
- `dialect`: Language dialect (default: "american_english")
- `tone`: Target tone for suggestions (default: "formal")
- `style_guide`: Style guide for suggestions (default: "microsoft")

### `acrolinx_workflow_status`

Check the status of an asynchronous workflow.

**Parameters:**

- `workflow_id` (required): The workflow ID to check
- `workflow_type` (required): Type of workflow ("rewrites", "checks", or "suggestions")

## Development

### Running in Development Mode

```bash
npm run dev
```

### Running Tests

```bash
# Test suggestions endpoint
node test-suggestions.js

# Test complete workflow
node test-suggestions-complete.js
```

### Building

```bash
npm run build
```

## Troubleshooting

### Common Issues

1. **"Calling undefined" message in Cursor**: This is normal Cursor behavior, not an error. When you see this message with a "Run tool" button, click the button to execute the Acrolinx analysis. This is Cursor's security feature requiring manual approval for MCP tool execution.

2. **"Client closed" error in Cursor**: Try clearing the npx cache: `npx clear-npx-cache` and restart Cursor

3. **API key issues**: Verify your `ACROLINX_API_KEY` is correctly set in the environment variables

4. **Permission errors**: On Unix systems, ensure the compiled JavaScript file is executable (`chmod +x dist/index.js`)

### Debug Mode

Enable debug logging by setting `DEBUG=true` in your environment:

```bash
DEBUG=true npm run start
```

## Architecture

The server implements the Model Context Protocol using stdio transport and provides four main tools that interact with the Acrolinx NextGen API. Key features include:

- **Cross-IDE Compatibility**: Works with Claude Desktop, Cursor, and any MCP-compatible IDE
- **Retry Logic**: Exponential backoff for improved reliability
- **Timeout Handling**: Configurable timeouts for long-running operations
- **Comprehensive Logging**: Debug mode for troubleshooting
- **Type Safety**: Full TypeScript implementation with proper type guards
- **Graceful Shutdown**: Proper cleanup on termination

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to ensure everything compiles
5. Submit a pull request

## Support

For issues and questions:

- Create an issue on GitHub
- Check the [Acrolinx documentation](https://docs.acrolinx.com)
- Contact Acrolinx support

