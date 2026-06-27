# Imagen — AI Image Generation Tool (fork)

> **Форк** от [TurboPlanner/imagen-openrouter](https://github.com/TurboPlanner/imagen-openrouter) (исходный: [yusufipk/imagen-openrouter](https://github.com/yusufipk/imagen-openrouter)).
>
> Ключевые отличия: [смотри ниже](#-fork-differences).

Pure-frontend генератор изображений через OpenRouter API (`/api/v1/images`).  
38 моделей, динамические controls по `supported_parameters`, цены до генерации, баланс, AI Prompt Assistant.

![Imagen UI](assets/UI.webp)
![Imagen UI-1](assets/UI-1.webp)

---

## ✨ Features

### 🎨 Multi-Model Support (38 моделей)
Модели загружаются динамически из `GET /api/v1/images/models`:
- **Google**: Nano Banana 2 (Gemini 3.1 Flash), Nano Banana (Gemini 2.5 Flash), Gemini 3 Pro
- **OpenAI**: GPT Image 2, GPT-5 Image, GPT Image 1, mini-варианты
- **Black Forest Labs**: Flux.2 Pro / Max / Flex / Klein 4B
- **ByteDance**: Seedream 4.5
- **Sourceful**: Riverflow V2 / V2.5 (Fast, Standard, Max)
- **Recraft**: Recraft V3 / V4 (Pro, Turbo), включая vector output
- **xAI**: Grok Imagine
- **Microsoft**: MAI Image 2.5
- **OpenRouter**: Auto Router

### 🎛️ Dynamic Controls
Каждый контрол рендерится строго по `supported_parameters` выбранной модели:
- **Resolution**: 512, 1K, 2K, 4K (Gemini, Flux)
- **Quality**: Auto, Low, Medium, High (GPT)
- **Background**: Auto, Opaque, Transparent (GPT)
- **Aspect Ratio**: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2
- **Batch**: до 10 картинок (зависит от модели)

### 💰 Real-Time Pricing
- Оценка стоимости ДО генерации (по токенам, мегапикселям или за картинку)
- 3 единицы расчёта: `token`, `megapixel`, `image` — в зависимости от модели
- Баланс OpenRouter: бейдж в хедере + модалка с `credits`/`key`

### 🤖 AI Prompt Assistant
- Встроенный ассистент для генерации промптов (через cheap LLM)
- Адаптирует промпт под выбранную image-модель
- Поддерживает reference images (vision)
- Авто-вставка результата в поле ввода

### 🖼️ Reference Image Support
- Загрузка, drag & drop, paste
- Использование сгенерированных картинок как референсов

### 💾 Persistent Storage (IndexedDB)
- Картинки сохраняются в браузере
- Галерея, модалка с метаданными, recreate, download

### ⌨️ Shortcuts
- `Ctrl+Enter` — Generate
- `Escape` — Close modal

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/dimkurilo/imagen-openrouter.git
cd imagen-openrouter

# 2. Setup API key
cp config.example.js config.js
# → открой config.js и вставь свой OpenRouter API ключ

# 3. Start local server
python3 -m http.server 8237 --bind 127.0.0.1

# 4. Open
open http://127.0.0.1:8237
```

## 🔑 Getting an OpenRouter API Key

1. Go to [OpenRouter](https://openrouter.ai/)
2. Create an account → **Keys**
3. Create a new key → скопировать в `config.js`

## 🔒 Security Note

⚠️ **For local use only.**  
API key is loaded from `config.js` (not entered in the UI).  
`config.js` is in `.gitignore` — it will NOT be committed.  
The key is visible in DevTools — this is a trade-off of the pure-frontend architecture.

- ✅ API key in `config.js` (gitignored)
- ✅ Generated images in IndexedDB (your browser only)
- ✅ No backend server, no proxy
- ⚠️ Do NOT deploy publicly with a real API key

---

## 🧪 Testing

```bash
# Install
npm install

# Run headless
npx playwright test

# UI watch mode
npx playwright test --ui

# Visible browser
npx playwright test --headed
```

Tests are hermetic — all OpenRouter API calls are mocked. No real key, no spend.

---

## 🗺️ Roadmap

- [x] `/api/v1/images` endpoint (38 моделей)
- [x] Dynamic controls by `supported_parameters`
- [x] Real-time pricing estimate
- [x] OpenRouter balance display
- [x] AI Prompt Assistant
- [x] Regression tests (Playwright, 6 tests)
- [ ] `gpt-5.4-image-2` support
- [ ] Image-to-image editing
- [ ] History / favorites

---

## 🔄 Fork Differences

Чем этот форк отличается от оригинального [TurboPlanner/imagen-openrouter](https://github.com/TurboPlanner/imagen-openrouter):

| Аспект | Оригинал | Форк |
|--------|----------|------|
| **API** | `/chat/completions` (6 моделей) | `/api/v1/images` (38 моделей) |
| **API Key** | UI-инпут + localStorage | `config.js` (gitignored, не вводится в браузере) |
| **Model Selector** | Хардкоженный список | Динамический из `GET /api/v1/images/models` |
| **UI Controls** | Статичные | По `supported_parameters` модели |
| **Pricing** | Нет | Real-time оценка (token/megapixel/image) |
| **Balance** | Нет | Бейдж + модалка с `/credits` |
| **Prompt Assistant** | Нет | AI-генерация промптов с vision |
| **Тесты** | Нет | Playwright, 6 hermetic-тестов |

---

## 📁 Project Structure

```
imagen-openrouter/
├── config.example.js     # Template — copy to config.js
├── index.html            # Entry point
├── src/
│   ├── app.js            # Main logic
│   ├── models.js         # Model loader + pricing
│   └── styles.css
├── tests/
│   ├── fixtures/         # API snapshots (public, no secrets)
│   └── imagen.spec.js    # 6 regression tests
├── package.json          # Playwright deps
├── playwright.config.js  # Test config
└── assets/               # Screenshots, favicon
```

## 📜 License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE).
