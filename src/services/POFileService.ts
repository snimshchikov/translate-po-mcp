import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import PO from 'pofile';
import { 
  POFile, 
  TranslationEntry, 
  TranslationSearchResult, 
  SearchOptions, 
  TranslationStats,
  UpdateTranslationRequest 
} from '../types/index.js';

export class POFileService {
  private loadedFiles: Map<string, POFile> = new Map();

  public async loadPOFile(filePath: string): Promise<POFile> {
    try {
      const absolutePath = path.resolve(filePath);
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const po = PO.parse(fileContent);
      const stats = await fs.stat(absolutePath);

      const entries: TranslationEntry[] = po.items.map((item: any) => ({
        msgid: item.msgid,
        msgstr: this.normalizeMsgstr(item.msgstr),
        msgid_plural: item.msgid_plural || undefined,
        msgctxt: item.msgctxt ? item.msgctxt : undefined,
        comments: item.extractedComments || [],
        flags: this.normalizeFlags(item.flags),
        references: item.references || [],
        obsolete: item.obsolete || false
      }));

      const poFile: POFile = {
        path: absolutePath,
        headers: po.headers,
        entries,
        lastModified: stats.mtime
      };

      this.loadedFiles.set(absolutePath, poFile);
      return poFile;
    } catch (error) {
      throw new Error(`Failed to load PO file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async findPOFiles(directory: string, pattern: string = '**/*.po'): Promise<string[]> {
    try {
      const searchPattern = path.join(directory, pattern);
      const files = await glob(searchPattern, { absolute: true });
      return files;
    } catch (error) {
      throw new Error(`Failed to find PO files in ${directory}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async savePOFile(filePath: string): Promise<void> {
    const poFile = this.loadedFiles.get(path.resolve(filePath));
    if (!poFile) {
      throw new Error(`PO file ${filePath} is not loaded`);
    }

    try {
      const po = new PO();
      po.headers = poFile.headers;

      poFile.entries.forEach(entry => {
        // Try multiple approaches to create PO item to handle different library versions
        let item: any;
        
        try {
          // Approach 1: Try PO.Item()
          item = new (PO as any).Item();
        } catch {
          try {
            // Approach 2: Try PO.PO.Item()
            item = new (PO as any).PO.Item();
          } catch {
            // Approach 3: Create plain object (fallback)
            item = {};
          }
        }

        item.msgid = entry.msgid;
        // Handle pluralization properly
        if (Array.isArray(entry.msgstr)) {
          item.msgstr = entry.msgstr; // Keep array for plural forms
        } else {
          item.msgstr = entry.msgstr; // Single string
        }
        if (entry.msgid_plural) item.msgid_plural = entry.msgid_plural;
        if (entry.msgctxt) item.msgctxt = entry.msgctxt;
        if (entry.comments) item.extractedComments = entry.comments;
        if (entry.flags) item.flags = entry.flags;
        if (entry.references) item.references = entry.references;
        if (entry.obsolete) item.obsolete = entry.obsolete;
        po.items.push(item);
      });

      await fs.writeFile(poFile.path, po.toString(), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save PO file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public searchTranslations(options: SearchOptions): TranslationSearchResult[] {
    const results: TranslationSearchResult[] = [];
    const { query, searchIn, caseSensitive = false, regex = false } = options;

    let searchPattern: RegExp;
    try {
      if (regex) {
        searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } else {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchPattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
      }
    } catch (error) {
      throw new Error(`Invalid search pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    for (const [filePath, poFile] of this.loadedFiles) {
      poFile.entries.forEach(entry => {
        const shouldInclude = this.shouldIncludeEntry(entry, options);
        if (!shouldInclude) return;

        let matches = false;
        if (searchIn === 'msgid' || searchIn === 'both') {
          matches = searchPattern.test(entry.msgid);
        }
        if (!matches && (searchIn === 'msgstr' || searchIn === 'both')) {
          matches = searchPattern.test(this.getMsgstrAsString(entry.msgstr));
        }

        if (matches) {
          results.push({
            entry,
            file: filePath
          });
        }
      });
    }

    return results;
  }

  public getTranslationStats(filePath?: string): TranslationStats {
    let entries: TranslationEntry[] = [];

    if (filePath) {
      const poFile = this.loadedFiles.get(path.resolve(filePath));
      if (!poFile) {
        throw new Error(`PO file ${filePath} is not loaded`);
      }
      entries = poFile.entries;
    } else {
      // Get stats for all loaded files
      for (const poFile of this.loadedFiles.values()) {
        entries.push(...poFile.entries);
      }
    }

    const stats: TranslationStats = {
      total: entries.length,
      translated: 0,
      untranslated: 0,
      fuzzy: 0,
      obsolete: 0
    };

    entries.forEach(entry => {
      if (entry.obsolete) {
        stats.obsolete++;
      } else if (this.hasFlag(entry.flags, 'fuzzy')) {
        stats.fuzzy++;
      } else if (this.getMsgstrAsString(entry.msgstr).trim() !== '') {
        stats.translated++;
      } else {
        stats.untranslated++;
      }
    });

    return stats;
  }

  public updateTranslation(request: UpdateTranslationRequest): boolean {
    const poFile = this.loadedFiles.get(path.resolve(request.filePath));
    if (!poFile) {
      throw new Error(`PO file ${request.filePath} is not loaded`);
    }

    const entryIndex = poFile.entries.findIndex(entry => 
      entry.msgid === request.msgid && 
      (entry.msgctxt === request.msgctxt || (!entry.msgctxt && !request.msgctxt))
    );

    if (entryIndex === -1) {
      return false;
    }

    poFile.entries[entryIndex]!.msgstr = request.msgstr;
    // Remove fuzzy flag when translation is updated
    this.removeFlag(poFile.entries[entryIndex]!, 'fuzzy');

    return true;
  }

  public getLoadedFiles(): string[] {
    return Array.from(this.loadedFiles.keys());
  }

  public isFileLoaded(filePath: string): boolean {
    return this.loadedFiles.has(path.resolve(filePath));
  }

  private shouldIncludeEntry(entry: TranslationEntry, options: SearchOptions): boolean {
    const { includeUntranslated = true, includeTranslated = true, includeFuzzy = true } = options;

    if (entry.obsolete) return false;

    const isFuzzy = this.hasFlag(entry.flags, 'fuzzy');
    const isTranslated = this.getMsgstrAsString(entry.msgstr).trim() !== '';

    if (isFuzzy && !includeFuzzy) return false;
    if (isTranslated && !isFuzzy && !includeTranslated) return false;
    if (!isTranslated && !isFuzzy && !includeUntranslated) return false;

    return true;
  }

  private hasFlag(flags: string[] | Record<string, boolean> | undefined, flagName: string): boolean {
    if (!flags) return false;
    
    if (Array.isArray(flags)) {
      return flags.includes(flagName);
    } else {
      return Boolean(flags[flagName]);
    }
  }

  private removeFlag(entry: TranslationEntry, flagName: string): void {
    if (!entry.flags) return;
    
    if (Array.isArray(entry.flags)) {
      entry.flags = entry.flags.filter((flag: string) => flag !== flagName);
    } else {
      delete entry.flags[flagName];
    }
  }

  private normalizeFlags(flags: any): string[] | Record<string, boolean> {
    if (!flags) return [];
    
    // If it's already an array or object, return as is
    if (Array.isArray(flags) || typeof flags === 'object') {
      return flags;
    }
    
    // If it's a string, convert to array
    if (typeof flags === 'string') {
      return [flags];
    }
    
    return [];
  }

  private normalizeMsgstr(msgstr: any): string | string[] {
    if (!msgstr) return '';
    
    // If it's an array (plural forms), keep as array but clean each string
    if (Array.isArray(msgstr)) {
      return msgstr.map(str => (typeof str === 'string' ? str : String(str)));
    }
    
    // If it's a string, return as is
    return typeof msgstr === 'string' ? msgstr : String(msgstr);
  }

  private getMsgstrAsString(msgstr: string | string[]): string {
    if (Array.isArray(msgstr)) {
      // For plural forms, return the first form (singular) or join if needed
      return msgstr[0] || '';
    }
    return msgstr || '';
  }
} 