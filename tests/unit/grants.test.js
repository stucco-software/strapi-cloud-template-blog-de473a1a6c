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

// `__`-prefixed exports are metadata, not actions — see __capabilities below.
const controllerActions = Object.keys(controller).filter((k) => !k.startsWith('__'));
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

describe('every action is capability-guarded', () => {
  it('declares a capability for every exported controller action', () => {
    // The route table is now a COARSE gate: the role only says "some kind of
    // admin", because a union of two capabilities is not expressible per-role
    // (user.role is manyToOne). The specific capability is asserted inside the
    // handler instead. That makes the in-handler check load-bearing, so an
    // unwrapped handler is a hole — uploadMedia was exactly that before plan 8.
    // Diff the lists; counting cannot catch an omission.
    expect(typeof controller.__capabilities).toBe('object');
    expect(Object.keys(controller.__capabilities).sort())
      .toEqual([...controllerActions].sort());
  });

  it('names a real capability for each', () => {
    const {
      CAPABILITY_SLUGS,
    } = require('../../src/api/chapter-admin/services/capabilities.js');
    for (const [action, slug] of Object.entries(controller.__capabilities)) {
      expect(CAPABILITY_SLUGS, `${action} declares ${slug}`).toContain(slug);
    }
  });
});
