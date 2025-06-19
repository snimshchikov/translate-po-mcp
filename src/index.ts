#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { TranslationService } from './services/TranslationService.js';
import { UpdateTranslationRequest } from './types/index.js';

class TranslatePOMCPServer {
  private server: Server;
  private translationService: TranslationService;

  constructor() {
    this.server = new Server({
      name: 'translate-po-mcp',
      version: '1.0.0',
    });

    this.translationService = new TranslationService();
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'load_po_file',
            description: 'Load a single .po file for translation',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the .po file to load',
                },
              },
              required: ['filePath'],
            },
          },


          {
            name: 'get_untranslated_strings',
            description: 'Get all untranslated strings from loaded files or a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Optional file path to filter results',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                },
              },
            },
          },
          {
            name: 'get_fuzzy_translations',
            description: 'Get all fuzzy translations from loaded files or a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Optional file path to filter results',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                },
              },
            },
          },
          {
            name: 'update_translation',
            description: 'Update a single translation',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the .po file',
                },
                msgid: {
                  type: 'string',
                  description: 'Original text (message ID)',
                },
                msgstr: {
                  type: 'string',
                  description: 'Translation text',
                },
                msgctxt: {
                  type: 'string',
                  description: 'Optional message context',
                },
              },
              required: ['filePath', 'msgid', 'msgstr'],
            },
          },
          {
            name: 'update_multiple_translations',
            description: 'Update multiple translations at once',
            inputSchema: {
              type: 'object',
              properties: {
                translations: {
                  type: 'array',
                  description: 'Array of translation updates',
                  items: {
                    type: 'object',
                    properties: {
                      filePath: { type: 'string' },
                      msgid: { type: 'string' },
                      msgstr: { type: 'string' },
                      msgctxt: { type: 'string' },
                    },
                    required: ['filePath', 'msgid', 'msgstr'],
                  },
                },
              },
              required: ['translations'],
            },
          },
          {
            name: 'get_translation_stats',
            description: 'Get translation statistics for all loaded files or a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Optional file path to get stats for specific file',
                },
              },
            },
          },
          {
            name: 'get_file_translations',
            description: 'Get all translations from a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the .po file',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'get_loaded_files',
            description: 'Get list of currently loaded .po files',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },

        ] as Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'load_po_file': {
            const { filePath } = args as { filePath: string };
            const result = await this.translationService.loadSingleFile(filePath);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully loaded PO file: ${filePath}\nEntries: ${result.entries.length}\nHeaders: ${JSON.stringify(result.headers, null, 2)}`,
                },
              ],
            };
          }





          case 'get_untranslated_strings': {
            const { filePath, limit } = args as { filePath?: string; limit?: number };
            const limitOptions = limit !== undefined ? { limit } : undefined;
            const results = this.translationService.getUntranslatedStrings(filePath, limitOptions);
            const totalText = limit !== undefined ? ` (showing ${results.length}, limited to ${limit})` : '';
            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${results.length} untranslated strings${totalText}:\n${JSON.stringify(results, null, 2)}`,
                },
              ],
            };
          }

          case 'get_fuzzy_translations': {
            const { filePath, limit } = args as { filePath?: string; limit?: number };
            const limitOptions = limit !== undefined ? { limit } : undefined;
            const results = this.translationService.getFuzzyTranslations(filePath, limitOptions);
            const totalText = limit !== undefined ? ` (showing ${results.length}, limited to ${limit})` : '';
            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${results.length} fuzzy translations${totalText}:\n${JSON.stringify(results, null, 2)}`,
                },
              ],
            };
          }

          case 'update_translation': {
            const request = args as unknown as UpdateTranslationRequest;
            const success = await this.translationService.updateTranslation(request);
            return {
              content: [
                {
                  type: 'text',
                  text: success 
                    ? `Successfully updated translation for "${request.msgid}" in ${request.filePath}`
                    : `Failed to update translation for "${request.msgid}" - entry not found`,
                },
              ],
            };
          }

          case 'update_multiple_translations': {
            const { translations } = args as { translations: UpdateTranslationRequest[] };
            const result = await this.translationService.updateMultipleTranslations(translations);
            return {
              content: [
                {
                  type: 'text',
                  text: `Updated ${result.success} translations successfully, ${result.failed} failed`,
                },
              ],
            };
          }

          case 'get_translation_stats': {
            const { filePath } = args as { filePath?: string };
            const stats = this.translationService.getTranslationStats(filePath);
            return {
              content: [
                {
                  type: 'text',
                  text: `Translation statistics${filePath ? ` for ${filePath}` : ' (all files)'}:\n${JSON.stringify(stats, null, 2)}`,
                },
              ],
            };
          }

          case 'get_file_translations': {
            const { filePath, limit } = args as { filePath: string; limit?: number };
            const limitOptions = limit !== undefined ? { limit } : undefined;
            const translations = this.translationService.getTranslationsForFile(filePath, limitOptions);
            const totalText = limit !== undefined ? ` (showing ${translations.length}, limited to ${limit})` : '';
            return {
              content: [
                {
                  type: 'text',
                  text: `Translations in ${filePath} (${translations.length} entries${totalText}):\n${JSON.stringify(translations, null, 2)}`,
                },
              ],
            };
          }

          case 'get_loaded_files': {
            const files = this.translationService.getLoadedFiles();
            if (files.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No files loaded. Use load_po_file to load a .po file first.`,
                  },
                ],
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `Loaded files (${files.length}):\n${files.join('\n')}`,
                },
              ],
            };
          }

          default:
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown tool: ${name}`,
                },
              ],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server
const server = new TranslatePOMCPServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
}); 