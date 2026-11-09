import type { XSearchInput, XSearchResult } from './types.js';
/**
 * Validate a real calendar date string formatted as YYYY-MM-DD.
 * Prevents JavaScript auto-rollover bugs (e.g. Feb 30 -> Mar 2).
 */
export declare function validateCalendarDate(dateStr: string, fieldName: string): {
    year: number;
    month: number;
    day: number;
};
/**
 * Normalize and validate X handles.
 * Strips leading '@' and validates length and character set.
 */
export declare function validateAndNormalizeHandles(handles: any[], fieldName: string): string[];
/**
 * Validate all parameters strictly according to specification before resolving credentials.
 */
export declare function validateSearchParams(params: Record<string, any>): XSearchInput;
export interface ExecuteSearchOptions {
    signal?: AbortSignal;
}
/**
 * Execute x_search call against xAI responses API.
 */
export declare function executeSearch(rawParams: Record<string, any>, { signal }?: ExecuteSearchOptions): Promise<XSearchResult>;
//# sourceMappingURL=search.d.ts.map