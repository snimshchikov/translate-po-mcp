import { POFileService } from './POFileService.js';
import { 
  TranslationEntry, 
  SearchOptions,
  TranslationStats,
  UpdateTranslationRequest,
  POFile,
  LimitOptions
} from '../types/index.js';

export class TranslationService {
  private poFileService: POFileService;

  constructor() {
    this.poFileService = new POFileService();
  }



  public async loadSingleFile(filePath: string): Promise<POFile> {
    return await this.poFileService.loadPOFile(filePath);
  }



  public getUntranslatedStrings(filePath?: string, options?: LimitOptions): TranslationEntry[] {
    if (this.poFileService.getLoadedFiles().length === 0) {
      throw new Error(`No files loaded. Use load_po_file first.`);
    }

    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: true,
      includeTranslated: false,
      includeFuzzy: false,
      ...(options?.limit !== undefined && { limit: options.limit })
    };

    const results = this.poFileService.searchTranslations(searchOptions);
    
    if (filePath) {
      if (!this.poFileService.isFileLoaded(filePath)) {
        throw new Error(`File not loaded: ${filePath}. Use load_po_file first.`);
      }
      const filtered = results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
      
      if (filtered.length === 0) {
        throw new Error(`No untranslated strings found in ${filePath}.`);
      }
      return filtered;
    }

    const entries = results.map(result => result.entry);
    if (entries.length === 0) {
      throw new Error(`No untranslated strings found in loaded files.`);
    }
    return entries;
  }

  public getFuzzyTranslations(filePath?: string, options?: LimitOptions): TranslationEntry[] {
    if (this.poFileService.getLoadedFiles().length === 0) {
      throw new Error(`No files loaded. Use load_po_file first.`);
    }

    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: false,
      includeTranslated: false,
      includeFuzzy: true,
      ...(options?.limit !== undefined && { limit: options.limit })
    };

    const results = this.poFileService.searchTranslations(searchOptions);
    
    if (filePath) {
      if (!this.poFileService.isFileLoaded(filePath)) {
        throw new Error(`File not loaded: ${filePath}. Use load_po_file first.`);
      }
      const filtered = results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
      
      if (filtered.length === 0) {
        throw new Error(`No fuzzy translations found in ${filePath}.`);
      }
      return filtered;
    }

    const entries = results.map(result => result.entry);
    if (entries.length === 0) {
      throw new Error(`No fuzzy translations found in loaded files.`);
    }
    return entries;
  }



  public async updateTranslation(request: UpdateTranslationRequest): Promise<boolean> {
    try {
      const success = this.poFileService.updateTranslation(request);
      if (success) {
        await this.poFileService.savePOFile(request.filePath);
        return true;
      }
      return false;
    } catch (error) {
      // Re-throw the error so the caller knows it failed
      throw error;
    }
  }

  public async updateMultipleTranslations(requests: UpdateTranslationRequest[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    const filesToSave = new Set<string>();
    const updateErrors: string[] = [];

    // First, try to update all translations in memory
    for (const request of requests) {
      try {
        const result = this.poFileService.updateTranslation(request);
        if (result) {
          success++;
          filesToSave.add(request.filePath);
        } else {
          failed++;
          updateErrors.push(`Failed to update "${request.msgid}": entry not found`);
        }
      } catch (error) {
        failed++;
        updateErrors.push(`Failed to update "${request.msgid}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Then save all modified files, tracking save failures separately
    const saveErrors: string[] = [];
    for (const filePath of filesToSave) {
      try {
        await this.poFileService.savePOFile(filePath);
      } catch (error) {
        saveErrors.push(`Failed to save file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Don't count this as a translation failure, but we should report it
      }
    }

    // If there were save errors, include them in a combined error message
    if (saveErrors.length > 0 || updateErrors.length > 0) {
      const allErrors = [...updateErrors, ...saveErrors];
      console.warn(`Translation update issues:\n${allErrors.join('\n')}`);
    }

    // If files failed to save, we should consider those translations as failed
    if (saveErrors.length > 0) {
      // Count how many successful updates were in files that failed to save
      let affectedSuccesses = 0;
      for (const request of requests) {
        if (filesToSave.has(request.filePath)) {
          // This file had updates but failed to save
          const fileHadSaveError = saveErrors.some(error => error.includes(request.filePath));
          if (fileHadSaveError) {
            affectedSuccesses++;
          }
        }
      }
      
      // Adjust counts: move affected successes to failed
      success -= affectedSuccesses;
      failed += affectedSuccesses;
    }

    return { success, failed };
  }

  public getTranslationStats(filePath?: string): TranslationStats {
    return this.poFileService.getTranslationStats(filePath);
  }

  public getLoadedFiles(): string[] {
    return this.poFileService.getLoadedFiles();
  }

  public isFileLoaded(filePath: string): boolean {
    return this.poFileService.isFileLoaded(filePath);
  }

  public getTranslationsForFile(sourceFilePath: string, options?: { startLine?: number; endLine?: number }): TranslationEntry[] {
    if (this.poFileService.getLoadedFiles().length === 0) {
      throw new Error(`No files loaded. Use load_po_file first.`);
    }

    // Get all translations from all loaded PO files
    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: true,
      includeTranslated: true,
      includeFuzzy: true
    };

    const allResults = this.poFileService.searchTranslations(searchOptions);
    
    // Filter by source file references (e.g., "bot/pm/admin.py:262")
    const filteredEntries = allResults
      .map(result => result.entry)
      .filter(entry => {
        if (!entry.references || entry.references.length === 0) {
          return false;
        }
        
        // Check if any reference contains the source file path
        return entry.references.some(ref => {
          // Extract file path from reference (e.g., "bot/pm/admin.py:262" -> "bot/pm/admin.py")
          const refFilePath = ref.split(':')[0];
          return refFilePath === sourceFilePath;
        });
      });

    if (filteredEntries.length === 0) {
      throw new Error(`No translations found for source file: ${sourceFilePath}. Check file path in references.`);
    }

    // Apply line number filtering if specified
    if (options?.startLine !== undefined || options?.endLine !== undefined) {
      const startLine = options.startLine || 1;
      const endLine = options.endLine || Number.MAX_SAFE_INTEGER;
      
      const lineFilteredEntries = filteredEntries.filter(entry => {
        if (!entry.references || entry.references.length === 0) {
          return false;
        }
        
                 // Check if any reference line number falls within the range
         return entry.references.some(ref => {
           const parts = ref.split(':');
           if (parts.length < 2) return false;
           
           const refFilePath = parts[0];
           const lineNumberStr = parts[1];
           if (!refFilePath || !lineNumberStr) return false;
           
           const lineNumber = parseInt(lineNumberStr, 10);
           
           // Only check line numbers for the matching file
           if (refFilePath === sourceFilePath && !isNaN(lineNumber)) {
             return lineNumber >= startLine && lineNumber <= endLine;
           }
           
           return false;
         });
      });

      if (lineFilteredEntries.length === 0) {
        throw new Error(`No translations found for ${sourceFilePath} between lines ${startLine}-${endLine}.`);
      }
      
      return lineFilteredEntries;
    }

    return filteredEntries;
  }
} 