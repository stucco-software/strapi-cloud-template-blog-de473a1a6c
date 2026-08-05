import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const controller = require('../../src/api/chapter-admin/controllers/chapter-admin.js');
const routes = require('../../src/api/chapter-admin/routes/chapter-admin.js');
const { CHAPTER_ADMIN_GRANTS } = require('../../src/api/chapter-admin/grants.js');

const PREFIX = 'api::chapter-admin.chapter-admin.';

const grantedActions = CHAPTER_ADMIN_GRANTS
  .filter((a) => a.startsWith(PREFIX))
  .map((a) => a.slice(PREFIX.length));

const controllerActions = Object.keys(controller);
const routedActions = routes.routes.map((r) => r.handler.replace('chapter-admin.', ''));

describe('chapter-admin wiring', () => {
  it('grants exactly the actions the controller exports', () => {
    // Counting permission rows cannot catch a typo: syncPermissions prunes
    // unknown actions during plugin bootstrap and the grant loop re-creates
    // them on the next line, so the count reads 18 either way.
    expect([...grantedActions].sort()).toEqual([...controllerActions].sort());
  });

  it('routes exactly the actions the controller exports', () => {
    expect([...new Set(routedActions)].sort()).toEqual([...controllerActions].sort());
  });

  it('every routed handler resolves to a function', () => {
    for (const action of routedActions) {
      expect(typeof controller[action]).toBe('function');
    }
  });
});
