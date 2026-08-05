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
    { method: 'POST',   path: '/chapter-admin/media',               handler: 'chapter-admin.uploadMedia' },

    { method: 'GET',    path: '/chapter-admin/members',             handler: 'chapter-admin.listMembers' },

    { method: 'GET',    path: '/chapter-admin/committees',              handler: 'chapter-admin.listCommittees' },
    { method: 'POST',   path: '/chapter-admin/committees',              handler: 'chapter-admin.createCommittee' },
    { method: 'PUT',    path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.updateCommittee' },
    { method: 'DELETE', path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.deleteCommittee' },

    { method: 'GET',    path: '/chapter-admin/news',                    handler: 'chapter-admin.listNews' },
    { method: 'POST',   path: '/chapter-admin/news',                    handler: 'chapter-admin.createNews' },
    { method: 'PUT',    path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.updateNews' },
    { method: 'DELETE', path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.deleteNews' },

    { method: 'GET',    path: '/chapter-admin/chapter',                 handler: 'chapter-admin.getChapter' },
    { method: 'PUT',    path: '/chapter-admin/chapter',                 handler: 'chapter-admin.updateChapter' },

    { method: 'GET',    path: '/chapter-admin/submissions',             handler: 'chapter-admin.listSubmissions' },
    { method: 'PUT',    path: '/chapter-admin/submissions/:documentId', handler: 'chapter-admin.updateSubmission' },
  ],
};
