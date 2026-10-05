# Agent Instructions

## Project

- Primitify is a client-side Vite and TypeScript application for turning uploaded photos into triangle-based artwork.
- The root `index.html` is the primary Primitify experience. `app.html` is a secondary legacy workspace; `concept.html` redirects to `/`.
- Image decoding/resizing is in `src/imageLoad.ts`; the worker entry is `src/worker.ts`; reusable algorithm code lives under `src/primitive/` and should remain free of DOM APIs.

## Commands

- `npm run build` runs TypeScript checking and the Vite production build.
- `npm test` runs the Vitest suite.
- `npm run dev` starts the local Vite development server.

## Conventions

- Use existing vanilla TypeScript, HTML, and CSS patterns; avoid adding dependencies for small UI changes.
- Keep image computation in the Web Worker and communicate through `src/types.ts` messages.
- Preserve responsive layouts and reduced-motion support for UI changes.
- Add or update focused tests for changes to reusable algorithm behavior.