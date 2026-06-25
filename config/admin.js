// Map a document to its public pathname on the frontend (areaa-frontend).
// Only `api::page.page` is routable; mirrors src/pages routing there:
//   - chapter page, slug `home` -> /chapters/[chapter]/index.astro
//   - national page, slug `index` -> index.astro (homepage)
//   - national page, any other slug -> [slug].astro
// Returns null for anything without a public route, which disables Preview.
const getPreviewPathname = (uid, { document }) => {
  if (uid !== 'api::page.page' || !document) return null

  const { slug, chapter } = document

  // Chapter microsite: only the reserved `home` page has a route today.
  if (chapter?.slug) {
    return slug === 'home' ? `/chapters/${chapter.slug}` : null
  }

  // National homepage uses the reserved `index` slug.
  if (slug === 'index') return '/'

  return slug ? `/${slug}` : null
}

module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  preview: {
    enabled: true,
    config: {
      allowedOrigins: env("CLIENT_URL"),  // Usually your frontend application URL
      async handler(uid, { documentId, locale, status }) {
        // Only Pages have a public route — skip the lookup (and the chapter
        // populate, which would throw on types without that relation) for the rest.
        if (uid !== 'api::page.page') return null;

        const document = await strapi.documents(uid).findOne({
          documentId,
          status,
          locale,
          populate: { chapter: { fields: ['slug'] } },
        });

        const pathname = getPreviewPathname(uid, { document });
        if (!pathname) return null;

        // Carry the preview flag + draft/published status as query params so the
        // frontend can opt into fetching draft data when previewing. The shared
        // secret lets the frontend reject draft requests that don't originate here.
        const base = env('PREVIEW_URL', env('CLIENT_URL'));
        const params = new URLSearchParams({
          preview: 'true',
          status,
          secret: env('PREVIEW_SECRET'),
        });
        return `${base}${pathname}?${params.toString()}`;
      },
    }
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
});
