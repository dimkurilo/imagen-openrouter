/**
 * Imagen - Internal AI Image Generation Tool
 * Supports multiple models via OpenRouter API
 */

// ===== Remote Logging =====
const LOG_SERVER = 'http://localhost:3001/log';
let _logSeq = 0;
function appLog(...args) {
    const msg = args.join(' ');
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, msg);
    _logSeq++;
    fetch(LOG_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, timestamp, seq: _logSeq })
    }).catch(() => {});
}
function appWarn(...args) {
    const msg = args.join(' ');
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}]`, msg);
    _logSeq++;
    fetch(LOG_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '[WARN] ' + msg, timestamp, seq: _logSeq })
    }).catch(() => {});
}
function appError(...args) {
    const msg = args.join(' ');
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}]`, msg);
    _logSeq++;
    fetch(LOG_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '[ERROR] ' + msg, timestamp, seq: _logSeq })
    }).catch(() => {});
}

// ===== IndexedDB Storage =====
const ImagenDB = {
    dbName: 'ImagenDB',
    storeName: 'images',
    db: null,

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    },

    async saveImage(imageData) {
        await this.ensureOpen();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(imageData);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAllImages() {
        await this.ensureOpen();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();
            request.onsuccess = () => {
                // Sort by createdAt descending (newest first)
                const images = request.result.sort((a, b) =>
                    new Date(b.createdAt) - new Date(a.createdAt)
                );
                resolve(images);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async deleteImage(id) {
        await this.ensureOpen();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async clearAll() {
        await this.ensureOpen();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async ensureOpen() {
        if (!this.db) {
            await this.open();
        }
    }
};

// ===== State Management =====
const state = {
    apiKey: window.OPENROUTER_API_KEY || '',
    selectedModel: localStorage.getItem('imagen_model') || 'google/gemini-3.1-flash-image',
    resolution: localStorage.getItem('imagen_resolution') || '1K',
    quality: localStorage.getItem('imagen_quality') || 'medium',
    background: localStorage.getItem('imagen_background') || 'opaque',
    aspectRatio: localStorage.getItem('imagen_aspect_ratio') || '1:1',
    imageCount: parseInt(localStorage.getItem('imagen_count')) || 1,
    references: [],
    images: [],
    currentImage: null,
    pendingBatches: [],
    allModels: [],
    showAllModels: false,
};

// ===== Model Configurations =====
const MODEL_CONFIGS = {
    'google/gemini-2.5-flash-image': {
        name: 'Gemini 2.5 Flash Image',
        supportsImageSize: true,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 3
    },
    'google/gemini-2.5-flash-image-preview': {
        name: 'Gemini 2.5 Flash Image (Preview)',
        supportsImageSize: true,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 3
    },
    'google/gemini-3.1-flash-image': {
        name: 'Gemini 3.1 Flash Image',
        supportsImageSize: true,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 3
    },
    'google/gemini-3.1-flash-image-preview': {
        name: 'Gemini 3.1 Flash Image',
        supportsImageSize: true,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 3
    },
    'google/gemini-3-pro-image-preview': {
        name: 'Gemini 3 Pro Image (Preview)',
        supportsImageSize: true,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 14
    },
    'openai/gpt-5-image': {
        name: 'GPT-5 Image',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 1
    },
    'openai/gpt-5-image-mini': {
        name: 'GPT-5 Image Mini',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 1
    },
    'openai/gpt-image-2': {
        name: 'GPT Image 2',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 1
    },
    'openai/gpt-image-1': {
        name: 'GPT Image 1',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: true,
        maxReferences: 1
    },
    'black-forest-labs/flux.2-pro': {
        name: 'Flux 2 Pro',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'black-forest-labs/flux.2-max': {
        name: 'Flux 2 Max',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'black-forest-labs/flux.2-flex': {
        name: 'Flux 2 Flex',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'black-forest-labs/flux.2-klein-4b': {
        name: 'Flux 2 Klein 4B',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'bytedance-seed/seedream-4.5': {
        name: 'Seedream 4.5',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'sourceful/riverflow-v2-fast-preview': {
        name: 'Riverflow V2 Fast',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'sourceful/riverflow-v2-standard-preview': {
        name: 'Riverflow V2 Standard',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    },
    'sourceful/riverflow-v2-max-preview': {
        name: 'Riverflow V2 Max',
        supportsImageSize: false,
        supportsAspectRatio: true,
        supportsImageInput: false,
        maxReferences: 0
    }
};

// ===== DOM Elements =====
const elements = {
    // Sidebar
    modelSelectContainer: document.getElementById('modelSelectContainer'),
    modelSelectTrigger: document.getElementById('modelSelectTrigger'),
    modelSelectValue: document.getElementById('modelSelectValue'),
    modelSelectOptions: document.getElementById('modelSelectOptions'),
    resolutionSection: document.getElementById('resolutionSection'),
    qualitySection: document.getElementById('qualitySection'),
    backgroundSection: document.getElementById('backgroundSection'),
    aspectRatioSection: document.getElementById('aspectRatioSection'),
    imageCountSection: document.getElementById('imageCountSection'),
    imageCount: document.getElementById('imageCount'),
    decreaseCount: document.getElementById('decreaseCount'),
    increaseCount: document.getElementById('increaseCount'),
    clearReferences: document.getElementById('clearReferences'),
    referenceSlots: document.getElementById('referenceSlots'),

    // Main Content
    promptInput: document.getElementById('promptInput'),
    charCount: document.getElementById('charCount'),
    generateBtn: document.getElementById('generateBtn'),
    gallery: document.getElementById('gallery'),
    galleryHeader: document.getElementById('galleryHeader'),
    clearGallery: document.getElementById('clearGallery'),

    // Status
    statusBar: document.getElementById('statusBar'),
    statusText: document.getElementById('statusText'),

    // Modal
    imageModal: document.getElementById('imageModal'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalClose: document.getElementById('modalClose'),
    modalImage: document.getElementById('modalImage'),
    modalMetadata: document.getElementById('modalMetadata'),
    useAsReference: document.getElementById('useAsReference'),
    recreateImage: document.getElementById('recreateImage'),
    downloadImage: document.getElementById('downloadImage'),

    // Balance
    balanceBadge: document.getElementById('balanceBadge'),
    balanceAmount: document.getElementById('balanceAmount'),
    balanceModal: document.getElementById('balanceModal'),
    balanceModalOverlay: document.getElementById('balanceModalOverlay'),
    balanceModalClose: document.getElementById('balanceModalClose'),
    balanceDetails: document.getElementById('balanceDetails'),
    refreshBalance: document.getElementById('refreshBalance'),

    // Price info
    priceInfo: document.getElementById('priceInfo'),
    priceRate: document.getElementById('priceRate'),
    priceEstimate: document.getElementById('priceEstimate'),

    // Prompt assistant
    promptAssistantHeader: document.getElementById('promptAssistantHeader'),
    promptAssistantBody: document.getElementById('promptAssistantBody'),
    assistantIdea: document.getElementById('assistantIdea'),
    assistantModel: document.getElementById('assistantModel'),
    generatePromptBtn: document.getElementById('generatePromptBtn'),
    assistantOutput: document.getElementById('assistantOutput'),
    assistantResult: document.getElementById('assistantResult'),
    copyPromptBtn: document.getElementById('copyPromptBtn'),
};

// ===== Initialization =====
async function init() {
    appLog('[Imagen] init() started');

    // Load image models from API
    try {
        state.allModels = await ImageModels.fetchModels();
        appLog('[Imagen] Models loaded:', state.allModels.length);
    } catch (e) {
        appError('[Imagen] Failed to load models:', e);
    }

    // Render model selector from loaded models
    renderModelSelector();

    // Render reference slots
    renderReferenceSlots();
    appLog('[Imagen] referenceSlots rendered');

    // Restore saved model selection
    if (state.selectedModel) {
        const opt = document.querySelector(`.custom-select-option[data-value="${state.selectedModel}"]`);
        if (opt) {
            document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            elements.modelSelectValue.textContent = opt.textContent;
            appLog('[Imagen] Model restored:', state.selectedModel);
        } else {
            appWarn('[Imagen] Saved model not found, resetting to default');
            state.selectedModel = 'google/gemini-3.1-flash-image';
            localStorage.setItem('imagen_model', state.selectedModel);
            const defaultOpt = document.querySelector(`.custom-select-option[data-value="${state.selectedModel}"]`);
            if (defaultOpt) {
                document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
                defaultOpt.classList.add('selected');
                elements.modelSelectValue.textContent = defaultOpt.textContent;
            }
        }
    }

    // Restore saved resolution (Gemini)
    document.querySelectorAll('#resolutionSection .btn-toggle').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.resolution === state.resolution) {
            btn.classList.add('active');
        }
    });

    // Restore saved quality
    document.querySelectorAll('#qualitySection .btn-toggle').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.quality === state.quality) {
            btn.classList.add('active');
        }
    });

    // Restore saved background
    document.querySelectorAll('#backgroundSection .btn-toggle').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.background === state.background) {
            btn.classList.add('active');
        }
    });

    // Restore saved aspect ratio
    document.querySelectorAll('.btn-aspect').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.ratio === state.aspectRatio) {
            btn.classList.add('active');
        }
    });

    // Restore saved image count
    if (elements.imageCount) {
        elements.imageCount.value = state.imageCount;
    }

    // Load images from IndexedDB
    try {
        state.images = await ImagenDB.getAllImages();
        appLog('[Imagen] Images loaded from IndexedDB:', state.images.length);
    } catch (error) {
        appError('[Imagen] Failed to load images from IndexedDB:', error);
        state.images = [];
    }

    // Render gallery
    renderGallery();
    appLog('[Imagen] Gallery rendered');

    // Set up event listeners
    setupEventListeners();
    appLog('[Imagen] Event listeners attached');

    // Initialize UI state — call BEFORE setupEventListeners too so controls reflect
    // the saved model even if a future handler-registration error aborts setup.
    // Called again here (after setup) and on a timeout as a belt-and-suspenders guard.
    updateModelControls();
    setTimeout(() => updateModelControls(), 50);
    appLog('[Imagen] init() complete');

    // Balance: show clickable badge, fetch only on demand
    if (elements.balanceAmount) {
        elements.balanceAmount.textContent = 'Click';
    }
}

// ===== Balance =====
const BalanceState = {
    remaining: null,
    credits: null,
    key: null,
    error: null,
    loading: false,
    fetched: false,
};

/** fetch with timeout — aborts after `ms` milliseconds */
function fetchWithTimeout(url, options, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchBalance() {
    BalanceState.loading = true;
    console.log('[Balance] fetchBalance() started, apiKey present:', !!state.apiKey);
    let creditsData = null;
    let keyData = null;
    let remaining = null;
    let errorMsg = null;

    if (!state.apiKey) {
        errorMsg = 'No API key configured. Check config.js.';
        console.log('[Balance] No API key — skipping fetch');
    } else {
        try {
            console.log('[Balance] Fetching credits...');
            const creditsResp = await fetchWithTimeout('https://openrouter.ai/api/v1/credits', {
                headers: {
                    'Authorization': `Bearer ${state.apiKey}`,
                    'HTTP-Referer': window.location.origin,
                }
            });
            console.log('[Balance] Credits response:', creditsResp.status);
            if (creditsResp.ok) {
                creditsData = await creditsResp.json();
                console.log('[Balance] Credits data:', creditsData?.data?.total_credits);
            } else if (creditsResp.status === 401) {
                errorMsg = 'Invalid API key (401). Check config.js.';
            } else {
                errorMsg = `Credits API error: ${creditsResp.status}`;
            }
        } catch (e) {
            console.error('[Balance] Credits fetch failed:', e.message);
            errorMsg = e.name === 'AbortError' ? 'Request timed out (8s). Check network.' : `Network error: ${e.message}`;
        }

        if (!errorMsg) {
            try {
                console.log('[Balance] Fetching key info...');
                const keyResp = await fetchWithTimeout('https://openrouter.ai/api/v1/key', {
                    headers: {
                        'Authorization': `Bearer ${state.apiKey}`,
                        'HTTP-Referer': window.location.origin,
                    }
                });
                console.log('[Balance] Key response:', keyResp.status);
                if (keyResp.ok) {
                    keyData = await keyResp.json();
                }
            } catch (e) {
                console.warn('[Balance] Key fetch failed:', e.message);
            }
        }

        if (creditsData?.data) {
            const total = creditsData.data.total_credits || 0;
            const usage = creditsData.data.total_usage || 0;
            remaining = total - usage;
            console.log('[Balance] Remaining:', remaining);
        }
    }

    // Store in module-level state
    BalanceState.remaining = remaining;
    BalanceState.credits = creditsData?.data || null;
    BalanceState.key = keyData?.data || null;
    BalanceState.error = errorMsg;
    BalanceState.loading = false;
    BalanceState.fetched = true;
    console.log('[Balance] Done — remaining:', remaining, 'error:', errorMsg);

    // Update badge
    if (elements.balanceAmount) {
        if (remaining !== null) {
            elements.balanceAmount.textContent = `$${remaining.toFixed(2)}`;
            elements.balanceAmount.style.color = '';
        } else if (errorMsg) {
            elements.balanceAmount.textContent = '⚠️';
            elements.balanceAmount.style.color = 'var(--warning)';
        } else {
            elements.balanceAmount.textContent = '--';
        }
    }
}

function openBalanceModal() {
    if (!elements.balanceModal) return;

    let html = '';

    if (BalanceState.loading) {
        html = '<p>⏳ Fetching balance data...</p>';
    } else if (!BalanceState.fetched) {
        html = '<p>Click <strong>Refresh</strong> to load balance data.</p>';
    } else if (BalanceState.error) {
        html = `<p style="color:var(--warning)">⚠️ ${escapeHtml(BalanceState.error)}</p>`;
        if (BalanceState.remaining !== null) {
            html += `<p><strong>Remaining:</strong> $${BalanceState.remaining.toFixed(4)}</p>`;
        }
    } else {
        if (BalanceState.remaining !== null) {
            html += `<p><strong>Remaining:</strong> $${BalanceState.remaining.toFixed(4)}</p>`;
        }
        if (BalanceState.credits) {
            html += `<p><strong>Total Credits:</strong> $${Number(BalanceState.credits.total_credits || 0).toFixed(2)}</p>`;
            html += `<p><strong>Total Usage:</strong> $${Number(BalanceState.credits.total_usage || 0).toFixed(4)}</p>`;
        }
        if (BalanceState.key) {
            html += `<p><strong>Limit Remaining:</strong> $${Number(BalanceState.key.limit_remaining || 0).toFixed(4)}</p>`;
            html += `<p><strong>Monthly Usage:</strong> $${Number(BalanceState.key.usage_monthly || 0).toFixed(4)}</p>`;
            html += `<p><strong>Free Tier:</strong> ${BalanceState.key.is_free_tier ? 'Yes' : 'No'}</p>`;
        }
        if (!html) {
            html = '<p>No balance data available.</p>';
        }
    }

    if (elements.balanceDetails) {
        elements.balanceDetails.innerHTML = html;
    }
    elements.balanceModal.classList.add('active');
}

function closeBalanceModal() {
    if (!elements.balanceModal) return;
    elements.balanceModal.classList.remove('active');
}

// ===== Model Selector Rendering =====
function renderModelSelector() {
    const container = elements.modelSelectOptions;
    container.innerHTML = '';

    const models = state.allModels.length > 0 ? state.allModels : [];
    let visibleModels;

    if (models.length === 0) {
        // Fallback: no API data yet — use MODEL_CONFIGS. Show ALL (not just shortlist).
        const fallback = Object.keys(MODEL_CONFIGS).map(id => ({ id, name: MODEL_CONFIGS[id].name }));
        visibleModels = fallback;
        // Show toggle to indicate these are cached/local models
        const label = document.getElementById('showAllModelsLabel');
        const checkbox = document.getElementById('showAllModels');
        if (label && checkbox) {
            label.style.display = 'block';
            label.querySelector('span') && (label.lastChild.textContent = ' Show all (cached)');
            checkbox.checked = true;
            checkbox.disabled = true;
        }
    } else {
        const allModelsSorted = [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        const shortlist = ImageModels.getShortlist(models);
        visibleModels = state.showAllModels ? allModelsSorted : shortlist;
        // Show toggle only if there are more models than shortlist
        const label = document.getElementById('showAllModelsLabel');
        const checkbox = document.getElementById('showAllModels');
        if (label && checkbox) {
            if (models.length > ImageModels.SHORTLIST.length) {
                label.style.display = 'block';
                checkbox.checked = state.showAllModels;
                checkbox.disabled = false;
            } else {
                label.style.display = 'none';
            }
        }
    }

    for (const model of visibleModels) {
        const opt = document.createElement('div');
        opt.className = 'custom-select-option';
        opt.dataset.value = model.id;
        if (model.id === state.selectedModel) {
            opt.classList.add('selected');
            elements.modelSelectValue.textContent = model.name || model.id;
        }
        opt.textContent = model.name || model.id;
        container.appendChild(opt);
    }
}

// ===== Pricing (dynamic from API model data) =====
// Three billing UNITS on OpenRouter /images (verified via /endpoints scan 2026-06-26):
//   token      — GPT/Gemini/MAI: cost_usd × image_tokens
//   megapixel  — Flux.2-*: cost_usd × output_MP (nominal ~1.0 MP for 1:1)
//   image      — Recraft/Seedream/Riverflow/Grok: flat cost_usd per image
// Gemini resolution→token map is EMPIRICALLY calibrated from real usage.cost:
//   1K → 1120 tok ($0.0672), 2K → 1680 tok ($0.1008). Ratio is ~1.5× per step,
//   NOT 4× (pixel-area scaling overestimates). 512/4K extrapolated on the 1.5× ratio.
const GEMINI_RES_TOKENS = { '512': 750, '1K': 1120, '2K': 1680, '4K': 2520 };
const GPT_QUAL_TOKENS   = { 'auto': 650, 'low': 231, 'medium': 650, 'high': 1333 };
// Model-specific quality→token overrides. Newer models (gpt-5-image, gpt-5.4-image-2)
// consume far more tokens per image than the original gpt-image-1/2 at the same quality.
// Keyed by model-ID prefix (startsWith). Source: actual usage from IndexedDB + OpenRouter
// credit logs (2026-06-27: gpt-5-image low=408, high=6240 tok; gpt-image-2 low=229 tok).
const MODEL_QUAL_TOKENS = [
    { match: 'openai/gpt-5', tokens: { 'auto': 1600, 'low': 408, 'medium': 1600, 'high': 6240 } },
];
// Nominal output megapixels for Flux (no resolution control; ~1MP base, +slight for wide)
const FLUX_MP = { '1:1': 1.0, '16:9': 1.4, '9:16': 1.4, '4:3': 1.2, '3:4': 1.2, '3:2': 1.3 };

function updatePriceInfo() {
    if (!elements.priceInfo || !elements.priceRate) return;

    const modelId = state.selectedModel;
    const model = state.allModels.find(m => m.id === modelId);

    if (!model) {
        elements.priceRate.textContent = 'Loading model data...';
        elements.priceEstimate.textContent = '';
        return;
    }

    // Sync render with the fallback pricing (instant), then refine from /endpoints.
    renderPrice(ImageModels.getFallbackPricing(modelId));

    ImageModels.fetchModelPricing(modelId).then(pricing => {
        // Only re-render if still on the same model (avoid clobbering on fast switches).
        if (state.selectedModel === modelId) renderPrice(pricing);
    });
}

/** Render the pricing block given a pricing object {unit, cost_usd} (may be null). */
function renderPrice(pricing) {
    const modelId = state.selectedModel;
    const model = state.allModels.find(m => m.id === modelId);
    const name = model?.name || modelId;
    const n = state.imageCount;

    const unit = pricing?.unit;
    const cost = pricing?.cost_usd;
    const isGemini = modelId.includes('gemini');
    const isGptLike = modelId.includes('gpt') || modelId.includes('openai') || modelId.includes('mai');

    if (!pricing || typeof cost !== 'number') {
        elements.priceRate.textContent = name;
        elements.priceEstimate.textContent = 'check openrouter.ai for pricing';
        return;
    }

    let rateText, perImg, settingNote;

    if (unit === 'token') {
        const ratePer1M = cost * 1e6;
        if (isGemini) {
            const estTokens = GEMINI_RES_TOKENS[state.resolution] ?? 1167;
            perImg = cost * estTokens;
            settingNote = `@${state.resolution}`;
        } else if (isGptLike) {
            const override = MODEL_QUAL_TOKENS.find(o => modelId.startsWith(o.match));
            const qualTokens = override?.tokens ?? GPT_QUAL_TOKENS;
            const estTokens = qualTokens[state.quality] ?? 650;
            perImg = cost * estTokens;
            settingNote = `quality: ${state.quality}`;
        } else {
            perImg = cost * 650;
            settingNote = 'auto';
        }
        rateText = `${name} · $${ratePer1M}/1M img-tok`;
    } else if (unit === 'image') {
        perImg = cost; // flat per image
        settingNote = 'per image';
        rateText = `${name} · $${cost}/image`;
    } else if (unit === 'megapixel') {
        const mp = FLUX_MP[state.aspectRatio] ?? 1.0;
        perImg = cost * mp;
        settingNote = `~${mp}MP`;
        rateText = `${name} · $${cost}/MP`;
    } else {
        rateText = name;
        perImg = null;
    }

    elements.priceRate.textContent = rateText;

    if (perImg == null) {
        elements.priceEstimate.textContent = 'check openrouter.ai for pricing';
    } else {
        elements.priceEstimate.textContent = (n > 1)
            ? `${settingNote} · ~$${perImg.toFixed(4)}/img × ${n} = ~$${(perImg * n).toFixed(4)} (estimate)`
            : `${settingNote} · ~$${perImg.toFixed(4)}/img (estimate)`;
    }
}

// ===== Status Bar =====
function showStatus(msg) {
    if (!elements.statusBar || !elements.statusText) return;
    elements.statusBar.style.display = 'flex';
    elements.statusText.textContent = msg;
}
function hideStatus() {
    if (!elements.statusBar) return;
    elements.statusBar.style.display = 'none';
}
function setupEventListeners() {
    appLog('[Imagen] setupEventListeners()');

    // Check all elements exist
    for (const [key, el] of Object.entries(elements)) {
        if (!el) {
            appWarn('[Imagen] Missing element:', key);
        }
    }

    // Custom dropdown - toggle
    elements.modelSelectTrigger.addEventListener('click', () => {
        elements.modelSelectContainer.classList.toggle('open');
    });

    // Model option selection — delegated on container
    elements.modelSelectOptions.addEventListener('click', (e) => {
        const option = e.target.closest('.custom-select-option');
        if (!option) return;
        state.selectedModel = option.dataset.value;
        localStorage.setItem('imagen_model', state.selectedModel);
        elements.modelSelectValue.textContent = option.textContent;
        document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        elements.modelSelectContainer.classList.remove('open');
        updateGeminiOptionsVisibility();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!elements.modelSelectContainer.contains(e.target)) {
            elements.modelSelectContainer.classList.remove('open');
        }
    });

    // Show all models toggle
    const showAllCheckbox = document.getElementById('showAllModels');
    if (showAllCheckbox) {
        showAllCheckbox.addEventListener('change', () => {
            state.showAllModels = showAllCheckbox.checked;
            renderModelSelector();
        });
    }

    // Resolution buttons (Gemini)
    document.querySelectorAll('#resolutionSection .btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#resolutionSection .btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.resolution = btn.dataset.resolution;
            localStorage.setItem('imagen_resolution', state.resolution);
            updatePriceInfo();
        });
    });

    // Quality buttons (GPT)
    document.querySelectorAll('#qualitySection .btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#qualitySection .btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.quality = btn.dataset.quality;
            localStorage.setItem('imagen_quality', state.quality);
            updatePriceInfo();
        });
    });

    // Background buttons (GPT)
    document.querySelectorAll('#backgroundSection .btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#backgroundSection .btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.background = btn.dataset.background;
            localStorage.setItem('imagen_background', state.background);
        });
    });

    // Aspect ratio buttons
    document.querySelectorAll('.btn-aspect').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.aspectRatio = btn.dataset.ratio;
            localStorage.setItem('imagen_aspect_ratio', state.aspectRatio);
        });
    });

    // Image count
    if (elements.decreaseCount) {
        elements.decreaseCount.addEventListener('click', () => {
            if (state.imageCount > 1) {
                state.imageCount--;
                elements.imageCount.value = state.imageCount;
                localStorage.setItem('imagen_count', state.imageCount);
                updatePriceInfo();
            }
        });
    }

    if (elements.increaseCount) {
        elements.increaseCount.addEventListener('click', () => {
            const maxN = getMaxImageCount(state.selectedModel);
            if (state.imageCount < maxN) {
                state.imageCount++;
                elements.imageCount.value = state.imageCount;
                localStorage.setItem('imagen_count', state.imageCount);
                updatePriceInfo();
            }
        });
    }

    if (elements.imageCount) {
        elements.imageCount.addEventListener('change', (e) => {
            let val = parseInt(e.target.value);
            const maxN = getMaxImageCount(state.selectedModel);
            if (isNaN(val) || val < 1) val = 1;
            if (val > maxN) val = maxN;
            state.imageCount = val;
            elements.imageCount.value = val;
            localStorage.setItem('imagen_count', state.imageCount);
            updatePriceInfo();
        });
    }

    // Reference images are handled by renderReferenceSlots()
    elements.clearReferences.addEventListener('click', clearAllReferences);

    // Drag & Drop for reference images
    setupDragAndDrop();

    // Prompt input
    elements.promptInput.addEventListener('input', () => {
        elements.charCount.textContent = `${elements.promptInput.value.length} chars`;
    });

    // Generate button
    elements.generateBtn.addEventListener('click', generateImages);

    // Clear gallery
    elements.clearGallery.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all generated images?')) {
            state.images = [];
            try {
                await ImagenDB.clearAll();
            } catch (e) {
                console.warn('Could not clear IndexedDB:', e);
            }
            renderGallery();
            showToast('Gallery cleared', 'success');
        }
    });

    // Modal
    elements.modalOverlay.addEventListener('click', closeModal);
    elements.modalClose.addEventListener('click', closeModal);
    elements.useAsReference.addEventListener('click', useImageAsReference);
    elements.recreateImage.addEventListener('click', recreateImage);
    elements.downloadImage.addEventListener('click', downloadCurrentImage);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeBalanceModal();
        }
        if (e.key === 'Enter' && e.ctrlKey) generateImages();
    });

    // Balance badge and modal
    if (elements.balanceBadge) {
        elements.balanceBadge.addEventListener('click', async () => {
            if (BalanceState.loading) return;
            if (elements.balanceAmount) elements.balanceAmount.textContent = '...';
            await fetchBalance();
            openBalanceModal();
        });
    }
    if (elements.balanceModalOverlay) {
        elements.balanceModalOverlay.addEventListener('click', closeBalanceModal);
    }
    if (elements.balanceModalClose) {
        elements.balanceModalClose.addEventListener('click', closeBalanceModal);
    } else {
        // Fallback: element not found by ID at load time — try querySelector
        const btn = document.querySelector('#balanceModal .modal-close');
        if (btn) btn.addEventListener('click', closeBalanceModal);
    }
    if (elements.refreshBalance) {
        elements.refreshBalance.addEventListener('click', async () => {
            try {
                elements.refreshBalance.disabled = true;
                elements.refreshBalance.textContent = 'Refreshing...';
                await fetchBalance();
            } catch (e) {
                console.error('[Balance] Refresh error:', e);
            } finally {
                if (elements.refreshBalance) {
                    elements.refreshBalance.disabled = false;
                    elements.refreshBalance.textContent = 'Refresh';
                }
            }
            openBalanceModal();
        });
    }

    // Prompt Assistant — collapsible toggle
    if (elements.promptAssistantHeader) {
        elements.promptAssistantHeader.addEventListener('click', () => {
            const body = elements.promptAssistantBody;
            const container = document.getElementById('promptAssistant');
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            container.classList.toggle('open', !isOpen);
        });
    }

    // Prompt Assistant — generate
    if (elements.generatePromptBtn) {
        elements.generatePromptBtn.addEventListener('click', async () => {
            const idea = elements.assistantIdea?.value.trim();
            if (!idea) {
                showToast('Describe your idea first', 'warning');
                return;
            }
            if (!state.apiKey) {
                showToast('No API key configured', 'error');
                return;
            }

            elements.generatePromptBtn.disabled = true;
            elements.generatePromptBtn.textContent = 'Generating...';
            elements.assistantOutput.style.display = 'none';
            showStatus('Generating prompt with AI assistant...');

            try {
                const imageModel = state.selectedModel;
                const imageModelName = state.allModels.find(m => m.id === imageModel)?.name || imageModel;
                const assistantModel = elements.assistantModel?.value || 'google/gemini-2.5-flash';

                // Reference images attached to the assistant request (vision):
                // the LLM sees them and crafts a prompt that matches/uses them.
                const refs = (state.references || []).filter(r => typeof r === 'string' && r.startsWith('data:image'));
                const hasRefs = refs.length > 0;

                let styleGuide = '';
                if (imageModel.includes('gpt') || imageModel.includes('openai')) {
                    styleGuide = 'Output a single prose paragraph describing the image. Use natural language. Describe foreground, midground, background for complex scenes. Add "do not include text in the image" at the end if the user did not request text.';
                } else if (imageModel.includes('gemini')) {
                    styleGuide = 'Output a detailed prose description. Be explicit about every visual element. Describe subject, setting, lighting, mood, composition, and color palette.';
                } else if (imageModel.includes('flux')) {
                    styleGuide = 'Output comma-separated descriptors: subject, action, setting, style, mood, lighting, composition, colors.';
                } else if (imageModel.includes('seedream')) {
                    styleGuide = 'Output with artistic style specification first, then scene description. Specify art style explicitly (anime, cinematic, painterly, etc).';
                } else {
                    styleGuide = 'Output a detailed image generation prompt. Include: subject, action/pose, setting, style, mood, lighting, color palette, and composition.';
                }

                const refInstruction = hasRefs
                    ? `\n\nREFERENCE IMAGES: ${refs.length} reference image(s) are attached. Carefully study them. If the task is editing/extending the reference, describe how to preserve its subject, composition and style. If the reference is for inspiration, capture its mood, palette and visual language in the prompt.`
                    : '';

                const systemPrompt = `You are an expert prompt engineer for AI image generation. The target image model is "${imageModelName}" (${imageModel}).

${styleGuide}
${refInstruction}

Rules:
- Output ONLY the final prompt, nothing else — no explanations, no prefixes, no markdown.
- Make it specific and visual. Replace vague words with concrete imagery.
- If the user mentions a style (photo, illustration, 3D, etc.), reinforce it.
- Keep the prompt between 30-200 words — concise but rich in visual detail.
- If the user mentions colors, lighting, or mood — amplify those elements.`;

                // Build user message content: text + image_url parts (vision) when refs exist
                let userContent;
                if (hasRefs) {
                    userContent = [{ type: 'text', text: idea }];
                    for (const r of refs) {
                        userContent.push({ type: 'image_url', image_url: { url: r } });
                    }
                } else {
                    userContent = idea;
                }

                const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${state.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': window.location.origin,
                        'X-Title': 'Imagen Prompt Assistant'
                    },
                    body: JSON.stringify({
                        model: assistantModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userContent }
                        ],
                        temperature: 0.7,
                        max_tokens: 500,
                    })
                });

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error?.message || `API error: ${resp.status}`);
                }

                const data = await resp.json();
                const generated = data.choices?.[0]?.message?.content?.trim();

                if (generated) {
                    elements.assistantResult.textContent = generated;
                    elements.assistantOutput.style.display = 'block';
                    // Auto-insert into the main generation prompt field
                    elements.promptInput.value = generated;
                    elements.charCount.textContent = `${generated.length} chars`;
                    hideStatus();
                    showToast(hasRefs
                        ? 'Prompt generated from idea + reference(s), inserted below'
                        : 'Prompt generated and inserted below', 'success');
                } else {
                    showToast('No prompt generated. Try again.', 'error');
                    hideStatus();
                }
            } catch (e) {
                console.error('[Assistant] Error:', e);
                showToast(e.message || 'Failed to generate prompt', 'error');
                hideStatus();
            } finally {
                elements.generatePromptBtn.disabled = false;
                elements.generatePromptBtn.textContent = 'Generate';
            }
        });
    }

    // Prompt Assistant — copy to prompt
    if (elements.copyPromptBtn) {
        elements.copyPromptBtn.addEventListener('click', () => {
            const text = elements.assistantResult?.textContent?.trim();
            if (text && elements.promptInput) {
                elements.promptInput.value = text;
                elements.charCount.textContent = `${text.length} chars`;
                showToast('Prompt copied! Ready to generate.', 'success');
            }
        });
    }

    // Paste images from clipboard
    document.addEventListener('paste', handlePaste);

    // Global error handler
    window.addEventListener('error', (e) => {
        appError('[Imagen] Uncaught error:', e.message, e.filename, e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
        appError('[Imagen] Unhandled promise rejection:', e.reason);
    });

    // Warn user before leaving if there are pending generations
    window.addEventListener('beforeunload', (e) => {
        if (state.pendingBatches.length > 0) {
            const pendingCount = state.pendingBatches.reduce((sum, batch) => {
                return sum + (batch.count - batch.completed - batch.failed);
            }, 0);
            if (pendingCount > 0) {
                e.preventDefault();
                // Modern browsers ignore custom messages, but we need to return something
                e.returnValue = `You have ${pendingCount} image(s) still generating. If you leave, they will be lost.`;
                return e.returnValue;
            }
        }
    });
}

// ===== Paste Handler =====
function handlePaste(e) {
    // Don't intercept paste if user is typing in an input field (except prompt)
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === 'INPUT' && activeEl.type !== 'text') {
        return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    let imageCount = 0;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    state.references.push(event.target.result);
                    renderReferenceSlots();
                };
                reader.readAsDataURL(file);
                imageCount++;
            }
        }
    }

    if (imageCount > 0) {
        showToast(`${imageCount} image(s) pasted as reference`, 'success');
    }
}

// ===== Drag & Drop =====
function setupDragAndDrop() {
    const dropZone = elements.referenceSlots;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    [...files].forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                state.references.push(event.target.result);
                renderReferenceSlots();
            };
            reader.readAsDataURL(file);
        }
    });

    if (files.length > 0) {
        showToast(`${files.length} image(s) added as reference`, 'success');
    }
}

// ===== Reference Image Handling =====
function handleReferenceUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        state.references.push(event.target.result);
        renderReferenceSlots();
    };
    reader.readAsDataURL(file);

    // Reset the input so the same file can be selected again
    e.target.value = '';
}

function renderReferenceSlots() {
    const container = document.getElementById('referenceSlots');
    container.innerHTML = '';

    // Render existing references
    state.references.forEach((ref, index) => {
        const slot = document.createElement('div');
        slot.className = 'reference-slot filled';
        slot.dataset.slot = index;
        slot.innerHTML = `
            <img src="${ref}" alt="Reference ${index + 1}">
            <button class="remove-ref" data-index="${index}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;
        container.appendChild(slot);
    });

    // Add "Add new" slot
    const addSlot = document.createElement('div');
    addSlot.className = 'reference-slot empty add-new';
    addSlot.innerHTML = `
        <span class="slot-label">+ Add</span>
        <input type="file" accept="image/*" class="reference-input" id="addReferenceInput">
    `;
    container.appendChild(addSlot);

    // Attach event listeners
    container.querySelectorAll('.remove-ref').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            removeReference(index);
        });
    });

    const addInput = container.querySelector('#addReferenceInput');
    if (addInput) {
        addInput.addEventListener('change', handleReferenceUpload);
    }
}

function removeReference(index) {
    state.references.splice(index, 1);
    renderReferenceSlots();
}

function clearAllReferences() {
    state.references = [];
    renderReferenceSlots();
    showToast('References cleared', 'success');
}

// ===== Image Generation =====
async function generateImages() {
    const prompt = elements.promptInput.value.trim();
    appLog('[Imagen] Generate clicked, prompt length:', prompt.length);
    appLog('[Imagen] API key present:', !!state.apiKey, 'model:', state.selectedModel);

    if (!prompt) {
        showToast('Please enter a prompt', 'warning');
        return;
    }

    if (!state.apiKey) {
        appWarn('[Imagen] Blocked: no API key');
        showToast('No API key configured. Check config.js', 'error');
        return;
    }

    const currentReferences = state.references.length > 0 ? [...state.references] : [];
    const currentModel = state.selectedModel;
    const currentAspectRatio = state.aspectRatio;
    const imageCount = state.imageCount;

    // Create a batch to track this generation request
    const batchId = Date.now() + Math.random();
    const batch = {
        id: batchId,
        prompt: prompt,
        model: currentModel,
        modelName: currentModel,
        count: imageCount,
        completed: 0,
        failed: 0
    };
    state.pendingBatches.push(batch);

    // Add loading placeholders
    addLoadingPlaceholders(batch, imageCount);
    showToast(`Generating ${imageCount} image(s)...`, 'success');
    showStatus(`Generating ${imageCount} image(s) with ${currentModel}...`);

    try {
        // Build /api/v1/images request body
        const requestBody = {
            model: currentModel,
            prompt: prompt,
            n: imageCount,
        };

        // Add model-specific params. Source of truth: supported_parameters ONLY.
        // No hardcoded model-name heuristics — those send params the API doesn't
        // accept (e.g. aspect_ratio to gemini-2.5-flash-image-preview → 400 risk)
        // and violate the "supported_parameters is the contract" rule.
        const modelObj = state.allModels.find(m => m.id === currentModel);
        const params = modelObj ? ImageModels.getSupportedParams(modelObj) : [];

        if (params.includes('quality')) requestBody.quality = state.quality;
        if (params.includes('background')) requestBody.background = state.background;
        if (params.includes('resolution')) requestBody.resolution = state.resolution;
        if (params.includes('aspect_ratio')) requestBody.aspect_ratio = currentAspectRatio;
        // NOTE: output_compression is intentionally NOT auto-injected. It requires
        // output_format=jpeg|webp (OpenAI rejects output_compression without it → 400),
        // and there is no UI control for output_format. PNG (default) is uncompressed.

        // Add reference images if any
        if (currentReferences.length > 0) {
            requestBody.input_references = currentReferences.map(ref => ({
                type: 'image_url',
                image_url: { url: ref }
            }));
        }

        appLog('[Imagen] Sending /images request:', JSON.stringify({...requestBody, input_references: requestBody.input_references ? `[${requestBody.input_references.length} refs]` : undefined}));

        const response = await fetch('https://openrouter.ai/api/v1/images', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Imagen Internal Tool'
            },
            body: JSON.stringify(requestBody)
        });

        appLog('[Imagen] /images response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            appError('[Imagen] API error:', errorData);
            let rawMsg = errorData.error?.message ?? errorData.error ?? errorData;
            if (rawMsg && typeof rawMsg !== 'string') {
                try { rawMsg = JSON.stringify(rawMsg); } catch { rawMsg = null; }
            }
            const errMsg = rawMsg || `API error: ${response.status}`;
            throw new Error(errMsg);
        }

        const data = await response.json();
        appLog('[Imagen] Received', data.data?.length || 0, 'images, cost:', data.usage?.cost);

        // Process each generated image
        const images = data.data || [];
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (!img.b64_json) {
                batch.failed++;
                removeOnePlaceholder(batchId);
                continue;
            }

            const mediaType = img.media_type || 'image/png';
            const mimeType = mediaType.startsWith('image/') ? mediaType : 'image/png';
            const url = `data:${mimeType};base64,${img.b64_json}`;

            const imageData = {
                id: Date.now() + i + Math.random(),
                url: url,
                prompt: prompt,
                model: currentModel,
                modelName: currentModel,
                resolution: state.resolution,
                quality: state.quality,
                background: state.background,
                aspectRatio: currentAspectRatio,
                references: currentReferences,
                createdAt: new Date().toISOString(),
                usageCost: data.usage?.cost ?? null,
                imageTokens: data.usage?.completion_tokens_details?.image_tokens ?? null,
            };

            state.images.unshift(imageData);
            batch.completed++;
            removeOnePlaceholder(batchId);
            prependImageCard(imageData, 0);

            // Save to IndexedDB in background
            ImagenDB.saveImage(imageData).catch(e => console.error('Failed to save to IndexedDB:', e));
        }

        if (images.length === 0) {
            batch.failed += imageCount;
            for (let j = 0; j < imageCount; j++) removeOnePlaceholder(batchId);
            throw new Error('No images in response');
        }
    } catch (error) {
        console.error('Failed to generate images:', error);
        batch.failed = imageCount - batch.completed;
        showToast(error.message || 'Generation failed', 'error');
        hideStatus();
    }

    // Remove batch from pending
    const batchIndex = state.pendingBatches.findIndex(b => b.id === batchId);
    if (batchIndex !== -1) {
        state.pendingBatches.splice(batchIndex, 1);
    }

    if (batch.completed > 0) {
        showToast(`${batch.completed} image(s) generated!`, 'success');
        hideStatus();
        // Save to IndexedDB after all images
        try {
            for (const img of state.images.slice(0, batch.completed)) {
                await ImagenDB.saveImage(img).catch(() => {});
            }
        } catch (e) {}
    }
}

// ===== Gallery =====
function renderGallery() {
    appLog('[Imagen] renderGallery() images:', state.images.length, 'pending:', state.pendingBatches.length);

    const hasPending = state.pendingBatches.length > 0;
    const hasImages = state.images.length > 0;

    elements.galleryHeader.classList.toggle('visible', hasImages || hasPending);

    if (!hasImages && !hasPending) {
        elements.gallery.innerHTML = '';
        return;
    }

    elements.gallery.innerHTML = '';

    // Render loading placeholders for pending batches at the top
    state.pendingBatches.forEach((batch) => {
        const pendingCount = batch.count - batch.completed - batch.failed;
        for (let i = 0; i < pendingCount; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'image-card loading-placeholder';
            const safePrompt = escapeHtml(batch.prompt);
            const truncatedPrompt = batch.prompt.length > 60 ? batch.prompt.substring(0, 60) + '...' : batch.prompt;
            placeholder.innerHTML = `
                <div class="loading-placeholder-content">
                    <div class="loading-spinner"></div>
                    <span class="loading-placeholder-text">Generating...</span>
                </div>
                <div class="image-card-overlay" style="opacity: 1;">
                    <p class="image-card-prompt">${escapeHtml(truncatedPrompt)}</p>
                    <div class="image-card-meta">
                        <span class="meta-tag">${escapeHtml(batch.modelName)}</span>
                        <span class="meta-tag loading-tag">
                            <svg class="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="12" y1="2" x2="12" y2="6"></line>
                                <line x1="12" y1="18" x2="12" y2="22"></line>
                                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                                <line x1="2" y1="12" x2="6" y2="12"></line>
                                <line x1="18" y1="12" x2="22" y2="12"></line>
                                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                            </svg>
                            Pending
                        </span>
                    </div>
                </div>
            `;
            elements.gallery.appendChild(placeholder);
        }
    });

    // Render existing images
    state.images.forEach((image, index) => {
        const card = document.createElement('div');
        card.className = 'image-card';

        // Sanitize URL - only allow data URIs and https URLs
        const safeUrl = sanitizeImageUrl(image.url);
        const safePrompt = escapeHtml(image.prompt);

        card.innerHTML = `
            <div class="image-card-actions image-card-actions-top">
                <button class="image-card-btn image-card-download" data-index="${index}" title="Download image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <button class="image-card-btn image-card-delete" data-index="${index}" title="Delete image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            </div>
            <div class="image-card-actions image-card-actions-bottom">
                <button class="image-card-btn image-card-reference" data-index="${index}" title="Use as reference">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                </button>
                <button class="image-card-btn image-card-recreate" data-index="${index}" title="Recreate with same settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                </button>
            </div>
            <img src="${safeUrl}" alt="${safePrompt}" loading="lazy">
            <div class="image-card-overlay">
                <p class="image-card-prompt">${safePrompt}</p>
                <div class="image-card-meta">
                    <span class="meta-tag">${escapeHtml(image.modelName || image.model)}</span>
                    ${image.quality ? `<span class="meta-tag">${escapeHtml(image.quality)}</span>` : ''}
                    ${image.resolution ? `<span class="meta-tag">${escapeHtml(image.resolution)}</span>` : ''}
                    ${image.usageCost != null ? `<span class="meta-tag cost-tag">$${Number(image.usageCost).toFixed(4)}</span>` : ''}
                </div>
            </div>
        `;

        // Download button handler
        const downloadBtn = card.querySelector('.image-card-download');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadImageByIndex(index);
        });

        // Delete button handler
        const deleteBtn = card.querySelector('.image-card-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteImage(index);
        });

        // Reference button handler
        const referenceBtn = card.querySelector('.image-card-reference');
        referenceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addImageAsReference(index);
        });

        // Recreate button handler
        const recreateBtn = card.querySelector('.image-card-recreate');
        recreateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            recreateImageByIndex(index);
        });

        // Open modal on card click
        card.addEventListener('click', () => openModal(image));
        elements.gallery.appendChild(card);
    });
}

// ===== Incremental Gallery Updates =====
function addLoadingPlaceholders(batch, count) {
    for (let i = 0; i < count; i++) {
        const placeholder = createPlaceholderElement(batch);
        elements.gallery.insertBefore(placeholder, elements.gallery.firstChild);
    }
}

function createPlaceholderElement(batch) {
    const placeholder = document.createElement('div');
    placeholder.className = 'image-card loading-placeholder';
    placeholder.dataset.batchId = batch.id;
    const truncatedPrompt = batch.prompt.length > 60 ? batch.prompt.substring(0, 60) + '...' : batch.prompt;
    placeholder.innerHTML = `
        <div class="loading-placeholder-content">
            <div class="loading-spinner"></div>
            <span class="loading-placeholder-text">Generating...</span>
        </div>
        <div class="image-card-overlay" style="opacity: 1;">
            <p class="image-card-prompt">${escapeHtml(truncatedPrompt)}</p>
            <div class="image-card-meta">
                <span class="meta-tag">${escapeHtml(batch.modelName)}</span>
                <span class="meta-tag loading-tag">
                    <svg class="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="2" x2="12" y2="6"></line>
                        <line x1="12" y1="18" x2="12" y2="22"></line>
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                        <line x1="2" y1="12" x2="6" y2="12"></line>
                        <line x1="18" y1="12" x2="22" y2="12"></line>
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                    </svg>
                    Pending
                </span>
            </div>
        </div>
    `;
    return placeholder;
}

function removeOnePlaceholder(batchId) {
    const placeholder = elements.gallery.querySelector(`.loading-placeholder[data-batch-id="${batchId}"]`);
    if (placeholder) {
        placeholder.remove();
    }
    
    if (elements.gallery.children.length === 0 && state.images.length === 0) {
        elements.galleryHeader.classList.remove('visible');
    }
}

function prependImageCard(image, index) {
    const card = createImageCardElement(image, index);
    
    elements.galleryHeader.classList.add('visible');
    
    // Insert after any remaining placeholders
    const firstNonPlaceholder = elements.gallery.querySelector('.image-card:not(.loading-placeholder)');
    if (firstNonPlaceholder) {
        elements.gallery.insertBefore(card, firstNonPlaceholder);
    } else {
        elements.gallery.appendChild(card);
    }
    
    updateCardIndices();
}

function createImageCardElement(image, index) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.imageId = image.id;

    const safeUrl = sanitizeImageUrl(image.url);
    const safePrompt = escapeHtml(image.prompt);

    card.innerHTML = `
        <div class="image-card-actions image-card-actions-top">
            <button class="image-card-btn image-card-download" title="Download image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </button>
            <button class="image-card-btn image-card-delete" title="Delete image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>
        </div>
        <div class="image-card-actions image-card-actions-bottom">
            <button class="image-card-btn image-card-reference" title="Use as reference">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
            </button>
            <button class="image-card-btn image-card-recreate" title="Recreate with same settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            </button>
        </div>
        <img src="${safeUrl}" alt="${safePrompt}" loading="lazy">
        <div class="image-card-overlay">
            <p class="image-card-prompt">${safePrompt}</p>
            <div class="image-card-meta">
                <span class="meta-tag">${escapeHtml(image.modelName || image.model)}</span>
                ${image.quality ? `<span class="meta-tag">${escapeHtml(image.quality)}</span>` : ''}
                ${image.resolution ? `<span class="meta-tag">${escapeHtml(image.resolution)}</span>` : ''}
                ${image.usageCost != null ? `<span class="meta-tag cost-tag">$${Number(image.usageCost).toFixed(4)}</span>` : ''}
            </div>
        </div>
    `;

    // Attach event handlers
    attachImageCardHandlers(card, image);
    
    return card;
}

function attachImageCardHandlers(card, image) {
    const imageId = image.id;
    
    card.querySelector('.image-card-download').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.images.findIndex(img => img.id === imageId);
        if (idx !== -1) downloadImageByIndex(idx);
    });

    card.querySelector('.image-card-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.images.findIndex(img => img.id === imageId);
        if (idx !== -1) deleteImage(idx);
    });

    card.querySelector('.image-card-reference').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.images.findIndex(img => img.id === imageId);
        if (idx !== -1) addImageAsReference(idx);
    });

    card.querySelector('.image-card-recreate').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.images.findIndex(img => img.id === imageId);
        if (idx !== -1) recreateImageByIndex(idx);
    });

    card.addEventListener('click', () => {
        const idx = state.images.findIndex(img => img.id === imageId);
        if (idx !== -1) openModal(state.images[idx]);
    });
}

function updateCardIndices() {
    // No longer needed since we use image IDs instead of indices
}

async function deleteImage(index) {
    const imageToDelete = state.images[index];
    state.images.splice(index, 1);

    try {
        await ImagenDB.deleteImage(imageToDelete.id);
    } catch (e) {
        console.warn('Could not delete from IndexedDB:', e);
    }

    // Remove card from DOM without full re-render
    const card = elements.gallery.querySelector(`.image-card[data-image-id="${imageToDelete.id}"]`);
    if (card) {
        card.remove();
    }
    
    if (state.images.length === 0 && state.pendingBatches.length === 0) {
        elements.galleryHeader.classList.remove('visible');
    }
    
    showToast('Image deleted', 'success');
}

function downloadImageByIndex(index) {
    const image = state.images[index];
    if (!image) return;

    const link = document.createElement('a');
    link.href = image.url;
    const timestamp = new Date(image.createdAt).toISOString().replace(/[:.]/g, '-');
    const ext = getImageExtension(image.url);
    link.download = `imagen-${timestamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Image downloaded', 'success');
}

function addImageAsReference(index) {
    const image = state.images[index];
    if (!image) return;

    state.references.push(image.url);
    renderReferenceSlots();
    showToast('Image added as reference', 'success');
}

function recreateImageByIndex(index) {
    const image = state.images[index];
    if (!image) return;

    // Restore prompt
    elements.promptInput.value = image.prompt;
    elements.charCount.textContent = `${image.prompt.length} chars`;

    // Restore model using custom select
    state.selectedModel = image.model;
    localStorage.setItem('imagen_model', state.selectedModel);
    const modelOption = document.querySelector(`.custom-select-option[data-value="${image.model}"]`);
    if (modelOption) {
        document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        modelOption.classList.add('selected');
        elements.modelSelectValue.textContent = modelOption.textContent;
    }
    updateGeminiOptionsVisibility();

    // Restore resolution/quality
    if (image.resolution) {
        document.querySelectorAll('#resolutionSection .btn-toggle').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.resolution === image.resolution) {
                btn.classList.add('active');
                state.resolution = image.resolution;
            }
        });
    }
    if (image.quality) {
        document.querySelectorAll('#qualitySection .btn-toggle').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.quality === image.quality) {
                btn.classList.add('active');
                state.quality = image.quality;
            }
        });
    }

    // Restore aspect ratio
    document.querySelectorAll('.btn-aspect').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.ratio === image.aspectRatio) {
            btn.classList.add('active');
        }
    });

    // Restore references
    if (image.references && image.references.length > 0) {
        state.references = [...image.references];
    } else {
        state.references = [];
    }
    renderReferenceSlots();

    showToast('Settings restored. Click Generate to recreate.', 'success');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Modal =====
function openModal(image) {
    state.currentImage = image;
    elements.modalImage.src = sanitizeImageUrl(image.url);
    elements.modalMetadata.innerHTML = `
        <p><strong>Prompt:</strong> ${escapeHtml(image.prompt)}</p>
        <p><strong>Model:</strong> ${escapeHtml(image.modelName || image.model)}</p>
        ${image.usageCost != null ? `<p><strong>Cost:</strong> $${Number(image.usageCost).toFixed(4)}</p>` : ''}
        ${image.imageTokens != null ? `<p><strong>Image Tokens:</strong> ${image.imageTokens}</p>` : ''}
        <p><strong>Aspect Ratio:</strong> ${escapeHtml(image.aspectRatio)}</p>
        <p><strong>Created:</strong> ${escapeHtml(new Date(image.createdAt).toLocaleString())}</p>
        ${image.references?.length > 0 ? `<p><strong>References Used:</strong> ${escapeHtml(image.references.length)}</p>` : ''}
    `;
    elements.imageModal.classList.add('active');
}

function closeModal() {
    elements.imageModal.classList.remove('active');
    state.currentImage = null;
}

function useImageAsReference() {
    if (!state.currentImage) return;

    state.references.push(state.currentImage.url);
    renderReferenceSlots();
    closeModal();
    showToast('Image added as reference', 'success');
}

function recreateImage() {
    if (!state.currentImage) return;

    // Restore prompt
    elements.promptInput.value = state.currentImage.prompt;
    elements.charCount.textContent = `${state.currentImage.prompt.length} chars`;

    // Restore model using custom select
    state.selectedModel = state.currentImage.model;
    localStorage.setItem('imagen_model', state.selectedModel);
    const modelOption = document.querySelector(`.custom-select-option[data-value="${state.currentImage.model}"]`);
    if (modelOption) {
        document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        modelOption.classList.add('selected');
        elements.modelSelectValue.textContent = modelOption.textContent;
    }
    updateGeminiOptionsVisibility();

    // Restore quality/size
    if (state.currentImage.resolution) {
        document.querySelectorAll('#resolutionSection .btn-toggle').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.resolution === state.currentImage.resolution) {
                btn.classList.add('active');
                state.resolution = state.currentImage.resolution;
            }
        });
    }
    if (state.currentImage.quality) {
        document.querySelectorAll('#qualitySection .btn-toggle').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.quality === state.currentImage.quality) {
                btn.classList.add('active');
                state.quality = state.currentImage.quality;
            }
        });
    }

    // Restore aspect ratio
    document.querySelectorAll('.btn-aspect').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.ratio === state.currentImage.aspectRatio) {
            btn.classList.add('active');
            state.aspectRatio = state.currentImage.aspectRatio;
        }
    });

    // Restore references (always update the UI, even if empty to clear previous refs)
    if (state.currentImage.references && state.currentImage.references.length > 0) {
        state.references = [...state.currentImage.references];
    } else {
        state.references = [];
    }
    renderReferenceSlots();

    closeModal();
    showToast('Settings restored. Click Generate to recreate.', 'success');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadCurrentImage() {
    if (!state.currentImage) return;

    const link = document.createElement('a');
    link.href = state.currentImage.url;
    const ext = getImageExtension(state.currentImage.url);
    link.download = `imagen_${state.currentImage.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Download started', 'success');
}

// ===== UI Helpers =====
function updateGeminiOptionsVisibility() {
    updateModelControls();
}

/**
 * Update sidebar controls visibility based on selected model's supported_parameters.
 * Runtime-truth = API response, not hardcoded configs.
 */
/** Max images per request for a model — from supported_parameters.n.max (API truth). */
function getMaxImageCount(modelId) {
    const model = state.allModels.find(m => m.id === modelId);
    const nMax = model?.supported_parameters?.n?.max;
    if (typeof nMax === 'number') return Math.max(1, nMax);
    // Fallback before models load: Gemini & Flux only do 1; others up to 10.
    if (modelId && (modelId.includes('gemini') || modelId.includes('flux'))) return 1;
    return 10;
}

function updateModelControls() {
    const model = state.allModels.find(m => m.id === state.selectedModel);    const params = model ? ImageModels.getSupportedParams(model) : [];

    // Check model family for defaults
    const isGemini = state.selectedModel.includes('gemini');
    const isGpt = state.selectedModel.includes('gpt') || state.selectedModel.includes('openai');

    if (elements.resolutionSection) {
        // Show for any model with 'resolution' in supported_parameters
        elements.resolutionSection.style.display = 
            (isGemini || params.includes('resolution')) ? 'block' : 'none';
    }
    if (elements.aspectRatioSection) {
        // Show for Gemini; also check supported_parameters for other models
        elements.aspectRatioSection.style.display = 
            (isGemini || params.includes('aspect_ratio')) ? 'block' : 'none';
    }

    if (elements.qualitySection) {
        elements.qualitySection.style.display = 
            (isGpt || params.includes('quality')) ? 'block' : 'none';
    }
    if (elements.backgroundSection) {
        elements.backgroundSection.style.display = 
            (isGpt || params.includes('background')) ? 'block' : 'none';
        // gpt-image-2 only supports auto/opaque — hide transparent button
        const transparentBtn = document.getElementById('transparentBgBtn');
        if (transparentBtn && state.selectedModel === 'openai/gpt-image-2') {
            transparentBtn.style.display = 'none';
        } else if (transparentBtn) {
            transparentBtn.style.display = '';
        }
    }

    // Image count: always visible (n parameter). Clamp to the model's max n and
    // disable +/- when the model only supports 1 image (Gemini/Flux) so it reads
    // as an intentional limit, NOT a broken control (was the reported bug).
    if (elements.imageCountSection) {
        elements.imageCountSection.style.display = 'block';
        const maxN = getMaxImageCount(state.selectedModel);
        const lockedToOne = maxN <= 1;
        if (state.imageCount > maxN) {
            state.imageCount = maxN;
            localStorage.setItem('imagen_count', state.imageCount);
        }
        if (elements.imageCount) {
            elements.imageCount.value = state.imageCount;
            elements.imageCount.max = maxN;
            elements.imageCount.disabled = lockedToOne;
        }
        const hint = lockedToOne ? 'This model generates 1 image per request' : '';
        if (elements.increaseCount) { elements.increaseCount.disabled = lockedToOne; elements.increaseCount.title = hint; }
        if (elements.decreaseCount) { elements.decreaseCount.disabled = lockedToOne; elements.decreaseCount.title = hint; }
        const countHint = document.getElementById('countHint');
        if (countHint) {
            countHint.textContent = lockedToOne ? '1 image / request — model limit (Gemini/Flux)' : '';
            countHint.style.display = lockedToOne ? 'block' : 'none';
        }
    }

    // Store current model info for generateImages
    if (elements.modelSelectValue) {
        const m = state.allModels.find(m => m.id === state.selectedModel);
        if (m) {
            elements.modelSelectValue.title = `ID: ${m.id}\nSupports: ${params.join(', ')}`;
        }
    }

    // Update price estimate
    updatePriceInfo();
}

function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function getImageExtension(url) {
    if (!url) return 'png';
    
    // Check for data URL with mime type
    if (url.startsWith('data:image/')) {
        const mimeMatch = url.match(/^data:image\/(\w+)/);
        if (mimeMatch) {
            const mime = mimeMatch[1].toLowerCase();
            // Map common mime types to extensions
            if (mime === 'jpeg') return 'jpg';
            if (mime === 'png') return 'png';
            if (mime === 'gif') return 'gif';
            if (mime === 'webp') return 'webp';
            if (mime === 'svg+xml') return 'svg';
            return mime;
        }
    }
    
    // Check URL extension
    if (url.startsWith('http')) {
        const urlPath = url.split('?')[0];
        const ext = urlPath.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
            return ext === 'jpeg' ? 'jpg' : ext;
        }
    }
    
    // Default to png
    return 'png';
}

function sanitizeImageUrl(url) {
    if (!url) return '';
    // Only allow data URIs and HTTPS URLs
    if (url.startsWith('data:image/')) {
        return url;
    }
    if (url.startsWith('https://')) {
        // Escape any potential attribute-breaking characters
        return url.replace(/"/g, '%22').replace(/'/g, '%27');
    }
    // Block everything else (http, javascript:, etc.)
    console.warn('Blocked unsafe image URL:', url);
    return '';
}

// ===== Global functions for inline handlers =====
window.removeReference = removeReference;

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', init);
