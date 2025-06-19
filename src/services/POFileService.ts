import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
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

const execAsync = promisify(exec);

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
      // Create a new PO object and populate it with updated translations
      const po = new PO();
      
      // Copy headers from the original file
      po.headers = { ...poFile.headers };
      
      // Add all entries to the PO object
      poFile.entries.forEach(entry => {
        const item = new (PO as any).Item();
        item.msgid = entry.msgid;
        item.msgstr = entry.msgstr;
        
        if (entry.msgid_plural) {
          item.msgid_plural = entry.msgid_plural;
        }
        
        if (entry.msgctxt) {
          item.msgctxt = entry.msgctxt;
        }
        
        if (entry.comments && entry.comments.length > 0) {
          item.extractedComments = entry.comments;
        }
        
        if (entry.references && entry.references.length > 0) {
          item.references = entry.references;
        }
        
        if (entry.flags) {
          if (Array.isArray(entry.flags)) {
            entry.flags.forEach(flag => {
              if (!item.flags) item.flags = {};
              item.flags[flag] = true;
            });
          } else {
            item.flags = { ...entry.flags };
          }
        }
        
        if (entry.obsolete) {
          item.obsolete = entry.obsolete;
        }
        
        po.items.push(item);
      });

      // Save the PO file using the pofile library
      await fs.writeFile(poFile.path, po.toString(), 'utf-8');
      
      // Now run pybabel update to properly format the file
      await this.runPyBabelUpdate(poFile.path);
      
      // Reload the file to get the properly formatted version
      await this.loadPOFile(filePath);
    } catch (error) {
      throw new Error(`Failed to save PO file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runPyBabelUpdate(poFilePath: string): Promise<void> {
    try {
      // Extract the directory structure to find locales directory and POT file
      const poDir = path.dirname(poFilePath);
      const fileName = path.basename(poFilePath);
      
      // Common patterns for locales directory structure:
      // 1. locales/lang/LC_MESSAGES/messages.po
      // 2. locales/lang/messages.po
      // 3. lang/LC_MESSAGES/messages.po
      
      let localesDir = '';
      let domain = '';
      let potFile = '';
      
      // Try to detect the structure
      if (poDir.includes('locales')) {
        // Find the locales directory
        const parts = poDir.split(path.sep);
        const localesIndex = parts.findIndex(part => part === 'locales');
        if (localesIndex >= 0) {
          localesDir = parts.slice(0, localesIndex + 1).join(path.sep);
          domain = path.parse(fileName).name; // e.g., 'messages' from 'messages.po'
          potFile = path.join(localesDir, `${domain}.pot`);
        }
      }
      
      // If we couldn't detect the structure, try some common defaults
      if (!localesDir) {
        // Look for a locales directory in parent directories
        let currentDir = poDir;
        for (let i = 0; i < 5; i++) {
          const testLocalesDir = path.join(currentDir, 'locales');
          try {
            const stat = await fs.stat(testLocalesDir);
            if (stat.isDirectory()) {
              localesDir = testLocalesDir;
              domain = path.parse(fileName).name;
              potFile = path.join(localesDir, `${domain}.pot`);
              break;
            }
          } catch {
            // Directory doesn't exist, try parent
            currentDir = path.dirname(currentDir);
          }
        }
      }
      
      // Only run pybabel if we found a proper structure
      if (localesDir && domain) {
        // Check if POT file exists
        try {
          await fs.access(potFile);
          
          // Run pybabel update command
          const command = `pybabel update -d "${localesDir}" -D ${domain} -i "${potFile}"`;
          
          const { stdout, stderr } = await execAsync(command, {
            cwd: path.dirname(localesDir)
          });
          
          if (stderr && !stderr.includes('updating catalog')) {
            console.warn(`pybabel update warning: ${stderr}`);
          }
          
        } catch (error) {
          // POT file doesn't exist or pybabel command failed
          // This is not necessarily an error - just log it
          console.warn(`pybabel update skipped: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
    } catch (error) {
      // Don't throw here - pybabel formatting is optional
      console.warn(`pybabel update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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