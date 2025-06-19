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
      return results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
    }

    return results.map(result => result.entry);
  }

  public getFuzzyTranslations(filePath?: string, options?: LimitOptions): TranslationEntry[] {
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
      return results
        .filter(result => result.file === filePath)
        .map(result => result.entry);
    }

    return results.map(result => result.entry);
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

  public getTranslationsForFile(filePath: string, options?: LimitOptions): TranslationEntry[] {
    const searchOptions: SearchOptions = {
      query: '',
      searchIn: 'msgid',
      includeUntranslated: true,
      includeTranslated: true,
      includeFuzzy: true,
      ...(options?.limit !== undefined && { limit: options.limit })
    };

    return this.poFileService
      .searchTranslations(searchOptions)
      .filter(result => result.file === filePath)
      .map(result => result.entry);
  }
} 