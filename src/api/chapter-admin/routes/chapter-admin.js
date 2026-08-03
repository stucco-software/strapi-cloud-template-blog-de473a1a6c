'use strict';

/**
 * chapter-admin routes, mounted under /api/chapter-admin/*.
 *
 * Every route is authenticated-plus-role: users-permissions rejects the request
 * before the handler runs unless the caller's role has the matching action
 * granted. That is the CAPABILITY check. The SCOPE check — which chapter — is
 * enforced inside each handler and is not expressible in this table.
 */

module.exports = {
  routes: [
    { method: 'GET',    path: '/chapter-admin/events',              handler: 'chapter-admin.listEvents' },
    { method: 'POST',   path: '/chapter-admin/events',              handler: 'chapter-admin.createEvent' },
    { method: 'PUT',    path: '/chapter-admin/events/:documentId',  handler: 'chapter-admin.updateEvent' },
    { method: 'DELETE', path: '/chapter-admin/events/:documentId',  handler: 'chapter-admin.deleteEvent' },
  ],
};
