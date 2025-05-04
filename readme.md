# CF-Proxy for Bilibili

A Bilibili video proxy service based on Cloudflare Workers. This service allows access to Bilibili video content from any region and provides optimized delivery.

## Features

- Supports both BV and AV video ID formats
- Provides video information and playback links
- DASH format video stream handling
- Uses Cloudflare KV for caching data
- Optimized video stream chunk downloading

## Installation and Setup

### Prerequisites

- Node.js (recommended v16 or higher)
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

### Setup Steps

1. Clone the repository

```bash
git clone <repository-url>
cd bilibili-downloder-cloudflare-worker
```

2. Install dependencies

```bash
npm install
```

3. Configure Cloudflare environment

Ensure you have configured the correct account ID and KV namespace in [`wrangler.jsonc`](wrangler.jsonc):

```jsonc
{
  "name": "cf-proxy",
  "compatibility_date": "2023-xx-xx",
  "kv_namespaces": [
    {
      "binding": "bililink",
      "id": "your-kv-namespace-id"
    }
  ],
  "vars": { "apiKey": "your api key" }
}
```

4. Run in development mode

```bash
npm run dev
```

5. Deploy to Cloudflare

```bash
npm run deploy
```

## Usage

[API Documentation](./api.md)

## Project Structure

```
├── .vscode/            # VS Code configuration
├── src/
│   ├── bilibili.ts     # Bilibili API-related functionality
│   ├── index.ts        # Worker entry point
│   ├── kv.ts           # KV operations wrapper
│   └── type.ts         # TypeScript type definitions
├── test/               # Test files
├── .editorconfig       # Editor configuration
├── .gitignore          # Git ignore configuration
├── .prettierrc         # Code formatting configuration
├── package.json        # Project dependencies
├── tsconfig.json       # TypeScript configuration
├── vitest.config.mts   # Vitest testing configuration
└── wrangler.jsonc      # Cloudflare Workers configuration
```