/**
 * models.js — Image model metadata loader and cache
 * Fetches GET /api/v1/images/models from OpenRouter, caches with TTL.
 */

const ImageModels = {
    _cache: null,
    _cacheTime: 0,
    _cacheTTL: 10 * 60 * 1000, // 10 minutes

    /** Shortlist model IDs (priority for UI — SPEC §5.1 / D4) */
    SHORTLIST: [
        'google/gemini-3.1-flash-image',     // Nano Banana 2 (latest)
        'openai/gpt-image-2',                // GPT Image 2 (latest dedicated)
        'openai/gpt-image-1',                // GPT Image 1
        'openai/gpt-5-image',                // GPT-5 Image
    ],

    /**
     * Fetch all image models from OpenRouter /api/v1/images/models
     * Returns cached data if within TTL.
     */
    async fetchModels() {
        if (this._cache && (Date.now() - this._cacheTime) < this._cacheTTL) {
            return this._cache;
        }

        const key = window.OPENROUTER_API_KEY;
        if (!key) {
            console.warn('[models] No API key — cannot fetch models');
            return [];
        }

        try {
            const resp = await fetch('https://openrouter.ai/api/v1/images/models', {
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Imagen Internal Tool'
                }
            });

            if (!resp.ok) {
                console.error('[models] Failed to fetch models:', resp.status);
                return this._cache || [];
            }

            const json = await resp.json();
            this._cache = json.data || [];
            this._cacheTime = Date.now();
            console.log('[models] Loaded', this._cache.length, 'image models');
            return this._cache;
        } catch (e) {
            console.error('[models] Fetch error:', e);
            return this._cache || [];
        }
    },

    /** Get shortlist model entries */
    getShortlist(models) {
        const shortlist = [];
        for (const id of this.SHORTLIST) {
            const m = models.find(m => m.id === id);
            if (m) shortlist.push(m);
        }
        return shortlist;
    },

    /** Get remaining models (not in shortlist), sorted by name */
    getRemaining(models) {
        const remaining = models.filter(m => !this.SHORTLIST.includes(m.id));
        remaining.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        return remaining;
    },

    /** Find a single model by ID */
    getModelById(models, id) {
        return models.find(m => m.id === id);
    },

    /**
     * Get supported_parameters for a model as an ARRAY of parameter-name strings.
     * The API returns this field as an OBJECT keyed by parameter name
     * (e.g. {"quality":{"type":"enum","values":[...]}, "n":{"type":"range",...}}),
     * NOT a string array. Normalize here so call sites can use .includes().
     */
    getSupportedParams(model) {
        const sp = model?.supported_parameters;
        if (Array.isArray(sp)) return sp;
        if (sp && typeof sp === 'object') return Object.keys(sp);
        return [];
    },

    /** Get the enum values for a parameter (e.g. background -> ['auto','opaque']), or null if not an enum. */
    getParamValues(model, param) {
        const sp = model?.supported_parameters;
        if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null;
        const entry = sp[param];
        return (entry && Array.isArray(entry.values)) ? entry.values : null;
    },

    /**
     * Authoritative pricing fallback. Three billing UNITS exist on OpenRouter /images:
     *   - "token":      cost_usd per token  → price = cost_usd × image_tokens  (GPT, Gemini, MAI)
     *   - "megapixel":  cost_usd per MP     → price = cost_usd × output_MP     (Flux.2-*)
     *   - "image":      cost_usd per image  → price = cost_usd (flat)          (Recraft, Seedream, Riverflow, Grok)
     * Source: GET /api/v1/images/models/{id}/endpoints → endpoints[0].pricing[billable=output_image].
     * Used for INSTANT display before the /endpoints call resolves (and if it fails).
     * Refreshed 2026-06-26 from a full scan of all 38 models.
     */
    FALLBACK_PRICING: {
        'openai/gpt-image-2':               { unit: 'token', cost_usd: 3e-05 },
        'openai/gpt-image-1':               { unit: 'token', cost_usd: 4e-05 },
        'openai/gpt-image-1-mini':          { unit: 'token', cost_usd: 8e-06 },
        'openai/gpt-5-image':               { unit: 'token', cost_usd: 4e-05 },
        'openai/gpt-5-image-mini':          { unit: 'token', cost_usd: 8e-06 },
        'openai/gpt-5.4-image-2':           { unit: 'token', cost_usd: 3e-05 },
        'google/gemini-3.1-flash-image':    { unit: 'token', cost_usd: 6e-05 },
        'google/gemini-3.1-flash-image-preview': { unit: 'token', cost_usd: 6e-05 },
        'google/gemini-2.5-flash-image':    { unit: 'token', cost_usd: 3e-05 },
        'google/gemini-3-pro-image':        { unit: 'token', cost_usd: 0.00012 },
        'google/gemini-3-pro-image-preview':{ unit: 'token', cost_usd: 0.00012 },
        'microsoft/mai-image-2.5':          { unit: 'token', cost_usd: 4.7e-05 },
        'black-forest-labs/flux.2-pro':     { unit: 'megapixel', cost_usd: 0.03 },
        'black-forest-labs/flux.2-max':     { unit: 'megapixel', cost_usd: 0.07 },
        'black-forest-labs/flux.2-flex':    { unit: 'megapixel', cost_usd: 0.06 },
        'black-forest-labs/flux.2-klein-4b':{ unit: 'megapixel', cost_usd: 0.014 },
        'bytedance-seed/seedream-4.5':      { unit: 'image', cost_usd: 0.04 },
        'recraft/recraft-v3':               { unit: 'image', cost_usd: 0.04 },
        'recraft/recraft-v4':               { unit: 'image', cost_usd: 0.04 },
        'recraft/recraft-v4-pro':           { unit: 'image', cost_usd: 0.25 },
        'recraft/recraft-v4-pro-vector':    { unit: 'image', cost_usd: 0.3 },
        'recraft/recraft-v4-vector':        { unit: 'image', cost_usd: 0.08 },
        'recraft/recraft-v4.1':             { unit: 'image', cost_usd: 0.035 },
        'recraft/recraft-v4.1-pro':         { unit: 'image', cost_usd: 0.21 },
        'recraft/recraft-v4.1-pro-vector':  { unit: 'image', cost_usd: 0.3 },
        'recraft/recraft-v4.1-utility':     { unit: 'image', cost_usd: 0.035 },
        'recraft/recraft-v4.1-utility-pro': { unit: 'image', cost_usd: 0.21 },
        'recraft/recraft-v4.1-vector':      { unit: 'image', cost_usd: 0.08 },
        'sourceful/riverflow-v2-pro':       { unit: 'image', cost_usd: 0.15 },
        'sourceful/riverflow-v2-fast':      { unit: 'image', cost_usd: 0.02 },
        'sourceful/riverflow-v2.5-pro':     { unit: 'image', cost_usd: 0.13 },
        'sourceful/riverflow-v2.5-fast':    { unit: 'image', cost_usd: 0.019 },
        'x-ai/grok-imagine-image-quality':  { unit: 'image', cost_usd: 0.05 },
    },

    /** in-memory cache of fetched pricing {unit, cost_usd} by model id */
    _rateCache: {},
    _ratePending: {},

    /**
     * Fetch authoritative pricing {unit, cost_usd} from
     * GET /api/v1/images/models/{id}/endpoints → endpoints[0].pricing[billable=output_image].
     * Cached per model id; concurrent calls share one fetch. Returns null if unavailable.
     */
    async fetchModelPricing(modelId) {
        if (modelId == null) return null;
        if (this._rateCache[modelId] !== undefined) return this._rateCache[modelId];
        if (this._ratePending[modelId]) return this._ratePending[modelId];

        const fallback = this.FALLBACK_PRICING[modelId] ?? null;
        const key = window.OPENROUTER_API_KEY;
        if (!key) return fallback;

        this._ratePending[modelId] = (async () => {
            try {
                // Encode each path segment separately but keep the '/' literal —
                // OpenRouter's /models/{provider/name}/endpoints route 404s on an
                // encoded '%2F' (verified: %2F → 404, literal '/' → 200).
                const safeId = String(modelId).split('/').map(encodeURIComponent).join('/');
                const resp = await fetch(`https://openrouter.ai/api/v1/images/models/${safeId}/endpoints`, {
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'HTTP-Referer': window.location.origin,
                        'X-Title': 'Imagen Internal Tool'
                    }
                });
                if (!resp.ok) throw new Error(`endpoints HTTP ${resp.status}`);
                const json = await resp.json();
                const endpoints = Array.isArray(json) ? json : (json.endpoints || json.data || []);
                const ep = endpoints[0];
                const pricing = ep?.pricing;
                let result = null;
                if (Array.isArray(pricing)) {
                    const img = pricing.find(p => p.billable === 'output_image' || p.billable === 'image');
                    if (img && typeof img.cost_usd === 'number') {
                        result = { unit: img.unit || 'token', cost_usd: img.cost_usd };
                    }
                }
                this._rateCache[modelId] = result ?? fallback;
                return this._rateCache[modelId];
            } catch (e) {
                console.warn('[models] fetchModelPricing failed for', modelId, e.message);
                this._rateCache[modelId] = fallback;
                return fallback;
            } finally {
                delete this._ratePending[modelId];
            }
        })();
        return this._ratePending[modelId];
    },

    /** Synchronous fallback pricing (instant display, no fetch). Returns {unit, cost_usd} | null. */
    getFallbackPricing(modelId) {
        return this.FALLBACK_PRICING[modelId] ?? null;
    },

    /** Check if a specific parameter is supported */
    supportsParam(model, param) {
        const params = this.getSupportedParams(model);
        return params.includes(param);
    },

    /** Get model display name (name field, fallback to id) */
    getDisplayName(model) {
        return model?.name || model?.id || 'Unknown';
    },
};
