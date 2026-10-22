// Data layer entry point. Screens import from here only.
//
// `ava:repo` is resolved at build time (vite.config.js) from VITE_AVA_DATA:
// `mock` (default) is the in-browser demo in repo.mock.js; `live` is Supabase
// plus the AVA API in repo.live.js. Both export the same functions and shapes,
// and only the chosen one is bundled.
export * from 'ava:repo';
