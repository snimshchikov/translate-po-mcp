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
      if (error instanceof Error) {
        if ((error as any).code === 'ENOENT') {
          throw new Error(`File not found: ${filePath}. Use load_po_file with correct file path first.`);
        }
        if (error.message.includes('Unexpected token')) {
          throw new Error(`Invalid PO file format: ${filePath}. Check file syntax.`);
        }
      }
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
      throw new Error(`File not loaded: ${filePath}. Use load_po_file first.`);
    }

    try {
      // Read the original file content to preserve exact formatting
      const originalContent = await fs.readFile(poFile.path, 'utf-8');
      const lines = originalContent.split('\n');
      
      // Create a map of msgid -> updated entry for easy lookup
      const updatedEntries = new Map<string, TranslationEntry>();
      poFile.entries.forEach(entry => {
        const key = entry.msgctxt ? `${entry.msgctxt}\x04${entry.msgid}` : entry.msgid;
        updatedEntries.set(key, entry);
      });

      let currentMsgid = '';
      let currentMsgctxt = '';
      let inMsgstr = false;
      let msgstrLineIndex = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue; // Skip undefined lines
        
        // Track current msgctxt
        if (line.startsWith('msgctxt ')) {
          currentMsgctxt = this.extractQuotedString(line.substring(8));
          inMsgstr = false;
        }
        
        // Track current msgid
        if (line.startsWith('msgid ')) {
          currentMsgid = this.extractQuotedString(line.substring(6));
          inMsgstr = false;
        }
        
        // When we hit msgstr, check if we need to update it
        if (line.startsWith('msgstr')) {
          const key = currentMsgctxt ? `${currentMsgctxt}\x04${currentMsgid}` : currentMsgid;
          const updatedEntry = updatedEntries.get(key);
          
          if (updatedEntry) {
            // Check if the original was plural (has msgstr[0], msgstr[1], etc.)
            const originalWasPlural = line.startsWith('msgstr[');
            
            // Replace the msgstr line(s) with our updated translation
            if (Array.isArray(updatedEntry.msgstr) && originalWasPlural) {
              // Handle plural forms - only if original was plural
              const pluralLines: string[] = [];
              updatedEntry.msgstr.forEach((str, idx) => {
                pluralLines.push(`msgstr[${idx}] "${this.escapeString(str)}"`);
              });
              
              // Find how many msgstr lines to replace
              let endIndex = i;
              while (endIndex + 1 < lines.length) {
                const nextLine = lines[endIndex + 1];
                if (nextLine && (nextLine.startsWith('msgstr[') || nextLine.startsWith('"'))) {
                  endIndex++;
                } else {
                  break;
                }
              }
              
              // Replace the msgstr section
              lines.splice(i, endIndex - i + 1, ...pluralLines);
              i += pluralLines.length - 1; // Adjust index
            } else {
              // Handle singular form - use the first element if it's an array, or the string directly
              const translationText = Array.isArray(updatedEntry.msgstr) 
                ? updatedEntry.msgstr[0] || ''
                : updatedEntry.msgstr;
              
              lines[i] = `msgstr "${this.escapeString(translationText)}"`;
              
              // Remove any continuation lines that might exist
              while (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.startsWith('"')) {
                  lines.splice(i + 1, 1);
                } else {
                  break;
                }
              }
            }
          }
          
          inMsgstr = true;
          msgstrLineIndex = i;
        }
        
        // Reset context when we hit a new entry
        if (line.trim() === '' && inMsgstr) {
          currentMsgid = '';
          currentMsgctxt = '';
          inMsgstr = false;
        }
      }

      await fs.writeFile(poFile.path, lines.join('\n'), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save PO file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

     private extractQuotedString(quotedStr: string): string {
     // Remove quotes and handle escaped characters
     const match = quotedStr.match(/^"(.*)"$/);
     if (match && match[1] !== undefined) {
       return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
     }
     return quotedStr;
   }

  private escapeString(str: string): string {
    // Escape quotes and backslashes for PO format
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  public searchTranslations(options: SearchOptions): TranslationSearchResult[] {
    const results: TranslationSearchResult[] = [];
    const { query, searchIn, caseSensitive = false, regex = false, limit } = options;

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

    // Apply limit if specified
    if (limit !== undefined) {
      return results.slice(0, limit);
    }

    return results;
  }

  public getTranslationStats(filePath?: string): TranslationStats {
    let entries: TranslationEntry[] = [];

    if (filePath) {
      const poFile = this.loadedFiles.get(path.resolve(filePath));
      if (!poFile) {
        throw new Error(`File not loaded: ${filePath}. Use load_po_file first.`);
      }
      entries = poFile.entries;
    } else {
      // Get stats for all loaded files
      if (this.loadedFiles.size === 0) {
        throw new Error(`No files loaded. Use load_po_file first.`);
      }
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
      throw new Error(`File not loaded: ${request.filePath}. Use load_po_file first.`);
    }

    const entryIndex = poFile.entries.findIndex(entry => 
      entry.msgid === request.msgid && 
      (entry.msgctxt === request.msgctxt || (!entry.msgctxt && !request.msgctxt))
    );

    if (entryIndex === -1) {
      throw new Error(`Translation not found: "${request.msgid}". Check msgid and msgctxt.`);
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