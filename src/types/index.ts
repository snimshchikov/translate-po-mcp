export interface TranslationEntry {
  msgid: string;
  msgstr: string | string[]; // Support both singular and plural forms
  msgid_plural?: string; // For plural entries
  msgctxt?: string;
  comments?: string[];
  flags?: string[] | Record<string, boolean>;
  references?: string[];
  obsolete?: boolean;
}

export interface POFile {
  path: string;
  headers: Record<string, string | undefined>;
  entries: TranslationEntry[];
  lastModified: Date;
}

export interface TranslationSearchResult {
  entry: TranslationEntry;
  file: string;
  lineNumber?: number;
}



export interface TranslationStats {
  total: number;
  translated: number;
  untranslated: number;
  fuzzy: number;
  obsolete: number;
}

export interface SearchOptions {
  query: string;
  searchIn: 'msgid' | 'msgstr' | 'both';
  caseSensitive?: boolean;
  regex?: boolean;
  includeUntranslated?: boolean;
  includeTranslated?: boolean;
  includeFuzzy?: boolean;
  limit?: number;
}

export interface UpdateTranslationRequest {
  filePath: string;
  msgid: string;
  msgstr: string | string[];
  msgctxt?: string;
}

export interface LimitOptions {
  limit?: number;
}

 