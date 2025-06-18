import { POFileService } from './POFileService.js';
import { 
  TranslationEntry, 
  TranslationsByFile, 
  SearchOptions, 
  TranslationSearchResult, 
  TranslationStats,
  UpdateTranslationRequest,
  POFile
} from '../types/index.js';

export class TranslationService {
  private poFileService: POFileService;

  constructor() {
    this.poFileService = new POFileService();
  }

  public async loadTranslationProject(directory: string): Promise<string[]> {
    const poFiles = await this.poFileService.findPOFiles(directory);
    const loadedFiles: string[] = [];

    for (const filePath of poFiles) {
      try {
        await this.poFileService.loadPOFile(filePath);
        loadedFiles.push(filePath);
      } catch (error) {
        console.warn(`Failed to load ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return loadedFiles;
  }

  public async loadSingleFile(filePath: string): Promise<POFile> {
    return await this.poFileService.loadPOFile(filePath);
  }

  public getTranslationsByFile(): TranslationsByFile {
    const result: TranslationsByFile = {};
    const loadedFiles = this.poFileService.getLoadedFiles();

    for (const filePath of loadedFiles) {
      try {
        const poFile = this.poFileService.loadPOFile(filePath);
        // This is synchronous because file is already loaded
        result[filePath] = (poFile as any).entries || [];
      } catch (error) {
        console.warn(`Failed to get translations for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        result[filePath] = [];
      }
    }

    return result;
  }

  public getUntranslatedStrings(filePath?: string): TranslationEntry[] {
    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: true,
      includeTranslated: false,
      includeFuzzy: false
    };

    const results = this.poFileService.searchTranslations(searchOptions);
    
    if (filePath) {
      return results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
    }

    return results.map(result => result.entry);
  }

  public getFuzzyTranslations(filePath?: string): TranslationEntry[] {
    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: false,
      includeTranslated: false,
      includeFuzzy: true
    };

    const results = this.poFileService.searchTranslations(searchOptions);
    
    if (filePath) {
      return results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
    }

    return results.map(result => result.entry);
  }

  public searchTranslations(options: SearchOptions): TranslationSearchResult[] {
    return this.poFileService.searchTranslations(options);
  }

  public async updateTranslation(request: UpdateTranslationRequest): Promise<boolean> {
    const success = this.poFileService.updateTranslation(request);
    if (success) {
      await this.poFileService.savePOFile(request.filePath);
    }
    return success;
  }

  public async updateMultipleTranslations(requests: UpdateTranslationRequest[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    const filesToSave = new Set<string>();

    for (const request of requests) {
      try {
        const result = this.poFileService.updateTranslation(request);
        if (result) {
          success++;
          filesToSave.add(request.filePath);
        } else {
          failed++;
        }
      } catch (error) {
        console.warn(`Failed to update translation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        failed++;
      }
    }

    // Save all modified files
    for (const filePath of filesToSave) {
      try {
        await this.poFileService.savePOFile(filePath);
      } catch (error) {
        console.warn(`Failed to save file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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

  public getTranslationsForFile(filePath: string): TranslationEntry[] {
    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: true,
      includeTranslated: true,
      includeFuzzy: true
    };

    return this.poFileService
      .searchTranslations(searchOptions)
      .filter(result => result.file === filePath)
      .map(result => result.entry);
  }
} 