# Contributing to Markup.ai MCP Server

We welcome contributions to the Markup.ai MCP Server! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/mcp.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Submit a pull request

## Development Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your Markup.ai API key
3. Run in development mode: `npm run dev`
4. Build the project: `npm run build`

## Code Standards

- Use TypeScript for all new code
- Follow the existing code style
- Add proper type definitions (avoid `any`)
- Include error handling for all API calls
- Add logging for debugging (use the existing log function)

## Testing

Before submitting a pull request:

1. Ensure your code builds without errors: `npm run build`
2. Test your changes with the provided test scripts
3. Add new tests if you're adding new functionality

## Pull Request Process

1. Update the README.md with details of changes if needed
2. Ensure all tests pass
3. Your PR will be reviewed by maintainers

## Commit Messages

Use clear and descriptive commit messages:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for test additions/changes

Example: `feat: add support for custom style guides`

## Questions?

If you have questions, please open an issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

