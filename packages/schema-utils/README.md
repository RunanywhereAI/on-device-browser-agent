# Tool Utils

This package contains JSON schema definitions and related helpers for tools used across the extension.

## Contents

- JSON schema definitions for navigator output
- Utility functions for schema flattening, conversion and formatting

## Examples

The `examples/` directory contains runnable examples that demonstrate the package's functionality:

1. **flatten.ts** - Demonstrates how to flatten a JSON schema by dereferencing all `$ref` fields
2. **convert.ts** - Shows how to convert an OpenAI-compatible schema to Gemini format

To run these examples:

```bash
# Run the schema flattening example
pnpm --filter @extension/schema-utils example:flatten

# Run the schema conversion example
pnpm --filter @extension/schema-utils example:convert
```
