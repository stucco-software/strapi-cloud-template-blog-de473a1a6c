'use strict';

const { chapterScopedResource } = require('../services/resource-factory');
// ScopeError must be obtained by direct require, never via strapi.service(...).
// Strapi's loadFiles deletes the require cache per file, so a service-registry
// lookup can hand back a DIFFERENT class object and `instanceof` silently fails.
const { ScopeError } = require('../services/scope');

// Mirrors api::event.event minus `chapter` and `slug`, both set at create and
// immutable after.
const events = chapterScopedResource({
  uid: 'api::event.event',
  hasSlug: true,
  editableFields: [
    'title', 'startsAt', 'endsAt', 'description',
    'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure',
  ],
});

/** Turn a ScopeError into a 403; let everything else surface. */
const guarded = (handler) => async (ctx) => {
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof ScopeError) return ctx.forbidden(err.message);
    throw err;
  }
};

module.exports = {
  listEvents: guarded(events.list),
  createEvent: guarded(events.create),
  updateEvent: guarded(events.update),
  deleteEvent: guarded(events.delete),
};
