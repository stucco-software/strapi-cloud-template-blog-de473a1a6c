'use strict';

// Boot Strapi far enough to run register + bootstrap lifecycles, then exit.
// `load()` calls `bootstrap()` internally (@strapi/core/dist/Strapi.js:301-303),
// which runs plugin BOOTSTRAP then user BOOTSTRAP (:385, :389) — so src/index.js
// runs and its role/permission writes land.
//
// Exists because `strapi develop` is a foreground watcher with no terminating
// condition, which an agentic worker cannot Ctrl-C. Same boot pattern as
// scripts/seed.js, which is known-working.
const { createStrapi, compileStrapi } = require('@strapi/strapi');

(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  console.log('BOOTSTRAP OK');
  await app.destroy();
  process.exit(0);
})().catch((err) => {
  console.error('BOOTSTRAP FAILED:', err.message);
  process.exit(1);
});
