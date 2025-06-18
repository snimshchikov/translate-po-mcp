# Translate PO MCP Server

A Model Context Protocol (MCP) server for managing and translating .po (gettext) files. This server provides a comprehensive set of tools for loading, searching, updating, and managing translation files.

## Features

- **Load Translation Files**: Load single .po files or entire directories of translation files
- **Search Functionality**: Advanced search with regex support, case sensitivity options, and filtering
- **Translation Management**: Update single or multiple translations at once
- **Statistics**: Get detailed translation statistics (translated, untranslated, fuzzy, obsolete)
- **File Organization**: Group translations by file and get file-specific data
- **Batch Operations**: Efficient handling of multiple translation updates

## Installation

First, install the dependencies using pnpm (as per your preference):

```powershell
pnpm install
```

## Build

Compile the TypeScript code:

```powershell
pnpm run build
```

## Usage

The server runs as an MCP server and communicates via stdio. It can be integrated with any MCP-compatible client.

### Available Tools

#### File Loading
- `load_po_file`: Load a single .po file
- `load_translation_project`: Load all .po files from a directory recursively

#### Search and Discovery
- `search_translations`: Advanced search with multiple criteria
- `get_untranslated_strings`: Get all strings that need translation
- `get_fuzzy_translations`: Get all fuzzy (needs review) translations
- `get_file_translations`: Get all translations from a specific file

#### Translation Management
- `update_translation`: Update a single translation
- `update_multiple_translations`: Batch update multiple translations

#### Statistics and Information
- `get_translation_stats`: Get translation statistics
- `get_translations_by_file`: Group translations by file
- `get_loaded_files`: List all currently loaded files

### Example Tool Usage

#### Load a Translation Project
```json
{
  "name": "load_translation_project",
  "arguments": {
    "directory": "./locales"
  }
}
```

#### Search for Translations
```json
{
  "name": "search_translations",
  "arguments": {
    "query": "welcome",
    "searchIn": "msgid",
    "caseSensitive": false,
    "includeUntranslated": true
  }
}
```

#### Update a Translation
```json
{
  "name": "update_translation",
  "arguments": {
    "filePath": "./locales/fr/messages.po",
    "msgid": "Welcome",
    "msgstr": "Bienvenue"
  }
}
```

#### Get Translation Statistics
```json
{
  "name": "get_translation_stats",
  "arguments": {
    "filePath": "./locales/fr/messages.po"
  }
}
```

## Architecture

The project follows separation of concerns with the following structure:

- `src/types/`: TypeScript type definitions
- `src/services/POFileService.ts`: Low-level PO file operations
- `src/services/TranslationService.ts`: High-level translation management
- `src/index.ts`: MCP server implementation

## Type Safety

All operations are fully typed with comprehensive TypeScript interfaces:

- `TranslationEntry`: Individual translation entries
- `POFile`: Complete .po file representation
- `SearchOptions`: Search configuration
- `TranslationStats`: Statistics information
- `UpdateTranslationRequest`: Translation update requests

## Error Handling

The server includes robust error handling:
- Invalid file paths are handled gracefully
- Malformed .po files are reported with specific error messages
- Search pattern validation for regex queries
- Batch operation status reporting

## Development

### Scripts
- `pnpm run build`: Compile TypeScript
- `pnpm run dev`: Watch mode compilation
- `pnpm run start`: Run the compiled server
- `pnpm run lint`: Run ESLint
- `pnpm run format`: Format code with Prettier

### Dependencies
- `@modelcontextprotocol/sdk`: MCP SDK for server implementation
- `pofile`: PO file parsing and manipulation
- `glob`: File pattern matching for discovery

## License

MIT 