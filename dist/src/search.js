import { sendHttpRequest, HttpError } from './http.js';
import { loadConfig } from './config.js';
import { writeCallLog } from './call-log.js';
import { getValidOAuthAccessToken, forceRefreshToken } from './auth.js';
const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const ALLOWED_PARAM_KEYS = new Set([
    'query',
    'allowed_x_handles',
    'excluded_x_handles',
    'from_date',
    'to_date',
    'enable_image_understanding',
    'enable_video_understanding',
    'auth_mode',
]);
const X_SEARCH_INTERNAL_TOOLS = new Set([
    'x_keyword_search',
    'x_semantic_search',
    'x_user_search',
    'x_thread_fetch',
]);
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
/**
 * Validate a real calendar date string formatted as YYYY-MM-DD.
 * Prevents JavaScript auto-rollover bugs (e.g. Feb 30 -> Mar 2).
 */
export function validateCalendarDate(dateStr, fieldName) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error(`Validation error: ${fieldName} must be formatted as YYYY-MM-DD, got: ${dateStr}`);
    }
    const [yStr, mStr, dStr] = dateStr.split('-');
    const year = Number.parseInt(yStr, 10);
    const month = Number.parseInt(mStr, 10);
    const day = Number.parseInt(dStr, 10);
    if (month < 1 || month > 12) {
        throw new Error(`Validation error: ${fieldName} has invalid month: ${month}`);
    }
    const daysInMonth = [
        31,
        isLeapYear(year) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    const maxDays = daysInMonth[month - 1];
    if (day < 1 || day > maxDays) {
        throw new Error(`Validation error: ${fieldName} has invalid day ${day} for month ${month} of year ${year}`);
    }
    return { year, month, day };
}
/**
 * Normalize and validate X handles.
 * Strips leading '@' and validates length and character set.
 */
export function validateAndNormalizeHandles(handles, fieldName) {
    if (!Array.isArray(handles)) {
        throw new Error(`Validation error: ${fieldName} must be an array of strings`);
    }
    if (handles.length > 10) {
        throw new Error(`Validation error: ${fieldName} cannot exceed 10 handles`);
    }
    return handles.map((h, idx) => {
        if (typeof h !== 'string') {
            throw new Error(`Validation error: ${fieldName}[${idx}] must be a string`);
        }
        const clean = h.replace(/^@+/, '').trim();
        if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
            throw new Error(`Validation error: handle "${h}" in ${fieldName} must be 1-15 characters matching [A-Za-z0-9_]`);
        }
        return clean;
    });
}
/**
 * Validate all parameters strictly according to specification before resolving credentials.
 */
export function validateSearchParams(params) {
    if (!params || typeof params !== 'object') {
        throw new Error('Validation error: parameters must be an object');
    }
    // Reject unknown fields
    for (const key of Object.keys(params)) {
        if (!ALLOWED_PARAM_KEYS.has(key)) {
            throw new Error(`Validation error: unknown field "${key}" is not allowed`);
        }
    }
    // Query validation
    if (typeof params.query !== 'string') {
        throw new Error('Validation error: "query" must be a string');
    }
    const trimmedQuery = params.query.trim();
    if (!trimmedQuery) {
        throw new Error('Validation error: "query" cannot be empty');
    }
    if (trimmedQuery.length > 16000) {
        throw new Error(`Validation error: "query" exceeds maximum length of 16000 characters (got ${trimmedQuery.length})`);
    }
    // Handle lists validation
    let allowed = undefined;
    if (params.allowed_x_handles !== undefined) {
        allowed = validateAndNormalizeHandles(params.allowed_x_handles, 'allowed_x_handles');
    }
    let excluded = undefined;
    if (params.excluded_x_handles !== undefined) {
        excluded = validateAndNormalizeHandles(params.excluded_x_handles, 'excluded_x_handles');
    }
    if (allowed && allowed.length > 0 && excluded && excluded.length > 0) {
        throw new Error('Validation error: allowed_x_handles and excluded_x_handles cannot both be non-empty');
    }
    // Date validation
    if (params.from_date !== undefined) {
        validateCalendarDate(params.from_date, 'from_date');
    }
    if (params.to_date !== undefined) {
        validateCalendarDate(params.to_date, 'to_date');
    }
    if (params.from_date && params.to_date) {
        if (params.from_date >= params.to_date) {
            throw new Error(`Validation error: from_date (${params.from_date}) must be strictly earlier than to_date (${params.to_date})`);
        }
    }
    if (params.from_date) {
        const todayUtc = new Date().toISOString().slice(0, 10);
        if (params.from_date > todayUtc) {
            throw new Error(`Validation error: from_date (${params.from_date}) cannot be later than today UTC (${todayUtc})`);
        }
    }
    // Media flags
    if (params.enable_image_understanding !== undefined && typeof params.enable_image_understanding !== 'boolean') {
        throw new Error('Validation error: enable_image_understanding must be a boolean');
    }
    if (params.enable_video_understanding !== undefined && typeof params.enable_video_understanding !== 'boolean') {
        throw new Error('Validation error: enable_video_understanding must be a boolean');
    }
    // Auth mode
    if (params.auth_mode !== undefined && !['auto', 'api_key', 'oauth'].includes(params.auth_mode)) {
        throw new Error(`Validation error: auth_mode must be one of 'auto', 'api_key', 'oauth', got: ${params.auth_mode}`);
    }
    return {
        query: trimmedQuery,
        allowed_x_handles: allowed,
        excluded_x_handles: excluded,
        from_date: params.from_date,
        to_date: params.to_date,
        enable_image_understanding: params.enable_image_understanding,
        enable_video_understanding: params.enable_video_understanding,
        auth_mode: params.auth_mode,
    };
}
function sanitizeUrls(rawUrls) {
    if (!Array.isArray(rawUrls))
        return [];
    const valid = [];
    for (const u of rawUrls) {
        if (typeof u === 'string') {
            try {
                const parsed = new URL(u);
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                    valid.push(u);
                }
            }
            catch {
                // Skip invalid URL
            }
        }
    }
    return [...new Set(valid)];
}
/**
 * Execute x_search call against xAI responses API.
 */
function errorInfo(err) {
    return {
        code: err?.code || 'SEARCH_ERROR',
        message: err?.message || 'Search execution failed',
        status: err?.status ?? null,
    };
}
function attemptFromError(err) {
    return {
        http_status: err?.status ?? null,
        raw_response: err instanceof HttpError ? err.data ?? null : null,
        error: errorInfo(err),
    };
}
export async function executeSearch(rawParams, { signal } = {}) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const attempts = [];
    let requestBody = null;
    let credentialSource = null;
    let billingMode = null;
    let model = '';
    let query = typeof rawParams?.query === 'string' ? rawParams.query : '';
    const persist = async (outcome, error) => {
        try {
            const logFile = await writeCallLog({
                started_at: startedAt,
                elapsed_ms: Date.now() - startedMs,
                endpoint: XAI_RESPONSES_URL,
                model,
                query,
                credential_source: credentialSource,
                billing_mode: billingMode,
                request: requestBody,
                attempts,
                outcome,
                error,
            });
            if (logFile)
                console.error(`x-search-mcp call_log=${logFile}`);
            return logFile;
        }
        catch (err) {
            console.error(`x-search-mcp call_log_error=${err?.message || 'failed to write call log'}`);
            return null;
        }
    };
    try {
        // Step 1: Strict parameter validation BEFORE credentials and network
        const validated = validateSearchParams(rawParams);
        query = validated.query;
        const config = loadConfig();
        model = config.model;
        // Step 2: Credential resolution
        const effectiveAuthMode = validated.auth_mode || config.authMode;
        let token;
        if (effectiveAuthMode === 'api_key') {
            if (!config.apiKey) {
                throw new Error('Credential error: API key is required when auth_mode is "api_key", but neither XAI_API_KEY nor XAI_API_KEY_FILE was provided.');
            }
            token = config.apiKey;
            credentialSource = 'api_key';
            billingMode = 'api_metered';
        }
        else if (effectiveAuthMode === 'oauth') {
            token = await getValidOAuthAccessToken();
            credentialSource = 'oauth';
            billingMode = 'subscription_oauth';
        }
        else {
            // Mode 'auto'
            if (config.apiKey) {
                token = config.apiKey;
                credentialSource = 'api_key';
                billingMode = 'api_metered';
            }
            else {
                try {
                    token = await getValidOAuthAccessToken();
                    credentialSource = 'oauth';
                    billingMode = 'subscription_oauth';
                }
                catch {
                    throw new Error('Credential error: No valid credentials found. Provide XAI_API_KEY or authenticate via "x-search-mcp auth login".');
                }
            }
        }
        // Step 3: Construct request body
        const toolConfig = {
            type: 'x_search',
        };
        if (validated.allowed_x_handles)
            toolConfig.allowed_x_handles = validated.allowed_x_handles;
        if (validated.excluded_x_handles)
            toolConfig.excluded_x_handles = validated.excluded_x_handles;
        if (validated.from_date)
            toolConfig.from_date = validated.from_date;
        if (validated.to_date)
            toolConfig.to_date = validated.to_date;
        if (validated.enable_image_understanding !== undefined)
            toolConfig.enable_image_understanding = validated.enable_image_understanding;
        if (validated.enable_video_understanding !== undefined)
            toolConfig.enable_video_understanding = validated.enable_video_understanding;
        requestBody = {
            model: config.model,
            input: [
                {
                    role: 'user',
                    content: validated.query,
                },
            ],
            tools: [toolConfig],
            store: false,
            max_turns: config.maxTurns,
        };
        if (config.reasoningEffort) {
            requestBody.reasoning = {
                effort: config.reasoningEffort,
            };
        }
        // Step 4: Execute HTTP request with single OAuth 401 refresh retry
        let httpRes;
        try {
            httpRes = await sendHttpRequest({
                url: XAI_RESPONSES_URL,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal,
                timeoutSeconds: config.timeoutSeconds,
                retries: config.retries,
            });
        }
        catch (err) {
            attempts.push(attemptFromError(err));
            // If OAuth returns HTTP 401, force-refresh token once and retry once
            if (credentialSource === 'oauth' && err instanceof HttpError && err.status === 401) {
                const freshToken = await forceRefreshToken(token);
                try {
                    httpRes = await sendHttpRequest({
                        url: XAI_RESPONSES_URL,
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${freshToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestBody),
                        signal,
                        timeoutSeconds: config.timeoutSeconds,
                        retries: 0,
                    });
                }
                catch (retryErr) {
                    attempts.push(attemptFromError(retryErr));
                    throw retryErr;
                }
            }
            else {
                throw err;
            }
        }
        const rawData = httpRes.data;
        if (!rawData || typeof rawData !== 'object') {
            attempts.push({
                http_status: httpRes.status ?? null,
                raw_response: rawData ?? null,
                error: {
                    code: 'SEARCH_ERROR',
                    message: 'Upstream xAI API returned empty or unparseable response data',
                    status: httpRes.status ?? null,
                },
            });
            throw new Error('Upstream xAI API returned empty or unparseable response data');
        }
        attempts.push({ http_status: httpRes.status ?? null, raw_response: rawData, error: null });
        // Check for upstream error status
        if (rawData.status === 'failed' || rawData.error) {
            const errMsg = rawData.error?.message || 'Upstream xAI response status is failed';
            const upstreamError = new HttpError('UPSTREAM_SERVER_ERROR', errMsg, httpRes.status);
            attempts[attempts.length - 1].error = errorInfo(upstreamError);
            throw upstreamError;
        }
        // Step 5: Extract answer, citations, inline citations, and tool execution details
        let answerText = '';
        if (typeof rawData.output_text === 'string' && rawData.output_text.trim()) {
            answerText = rawData.output_text.trim();
        }
        const collectedCitations = [];
        const inlineCitations = [];
        const serverSideCalls = [];
        // Top-level sources or citations
        if (Array.isArray(rawData.citations)) {
            collectedCitations.push(...rawData.citations);
        }
        if (Array.isArray(rawData.sources)) {
            collectedCitations.push(...rawData.sources);
        }
        // Parse output items
        if (Array.isArray(rawData.output)) {
            for (const item of rawData.output) {
                const callId = item.call_id || item.id || '';
                const toolName = item.name || item.tool_name || '';
                const isXSearchCall = callId.startsWith('xs_') || X_SEARCH_INTERNAL_TOOLS.has(toolName);
                if (item.type === 'custom_tool_call' || isXSearchCall) {
                    serverSideCalls.push({
                        call_id: callId || null,
                        name: toolName || null,
                        arguments: item.arguments || item.input || null,
                    });
                }
                const message = item.message || item;
                if (message.content) {
                    if (typeof message.content === 'string' && !answerText) {
                        answerText += (answerText ? '\n\n' : '') + message.content.trim();
                    }
                    else if (Array.isArray(message.content)) {
                        for (const block of message.content) {
                            if (!answerText) {
                                const textPiece = block.output_text || block.text;
                                if (typeof textPiece === 'string') {
                                    answerText += (answerText ? '\n\n' : '') + textPiece.trim();
                                }
                            }
                            if (Array.isArray(block.annotations)) {
                                for (const ann of block.annotations) {
                                    if (ann && (ann.type === 'url_citation' || ann.url)) {
                                        const urlStr = ann.url || ann.citation?.url;
                                        if (typeof urlStr === 'string' && (urlStr.startsWith('http://') || urlStr.startsWith('https://'))) {
                                            inlineCitations.push({
                                                url: urlStr,
                                                title: ann.title || ann.citation?.title || null,
                                                start_index: typeof ann.start_index === 'number' ? ann.start_index : null,
                                                end_index: typeof ann.end_index === 'number' ? ann.end_index : null,
                                            });
                                            collectedCitations.push(urlStr);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        const finalCitations = sanitizeUrls(collectedCitations);
        const hasCitations = finalCitations.length > 0 || inlineCitations.length > 0;
        const degraded = !hasCitations;
        const degradedReason = degraded ? 'No source citations returned by upstream x_search' : null;
        if (!answerText && !hasCitations) {
            throw new Error('Upstream returned no answer and no citations');
        }
        const searchExecution = serverSideCalls.length > 0 ? 'observed' : 'unreported';
        const warnings = [];
        if (credentialSource === 'oauth') {
            warnings.push('OAuth subscription search availability and quota are determined upstream by xAI; successful login does not guarantee search availability.');
        }
        if (degraded) {
            warnings.push('Result contains no source citations and cannot be treated as grounded search evidence.');
        }
        const result = {
            success: true,
            provider: 'xai',
            tool: 'x_search',
            model: config.model,
            query: validated.query,
            credential_source: credentialSource,
            billing_mode: billingMode,
            answer: answerText,
            citations: finalCitations,
            inline_citations: inlineCitations,
            has_citations: hasCitations,
            degraded,
            degraded_reason: degradedReason,
            search_execution: searchExecution,
            server_side_calls: serverSideCalls,
            response_status: rawData.status || 'completed',
            incomplete_details: rawData.incomplete_details || null,
            usage: rawData.usage || null,
            warnings,
            log_file: null,
        };
        result.log_file = await persist('success', null);
        if (config.logEnabled && !result.log_file) {
            result.warnings.push('Call log could not be written.');
        }
        return result;
    }
    catch (err) {
        const info = errorInfo(err);
        const logFile = await persist('error', info);
        if (err && typeof err === 'object')
            err.logFile = logFile;
        throw err;
    }
}
//# sourceMappingURL=search.js.map