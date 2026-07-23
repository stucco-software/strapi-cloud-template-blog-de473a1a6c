module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // Public origin (CloudFront domain) so the admin panel emits correct absolute
  // URLs. Unset on the first deploy → Strapi infers it from request headers.
  url: env('URL', undefined),
  // Behind CloudFront → ALB: trust X-Forwarded-* so Strapi builds https admin
  // links and sees the real client protocol/host instead of the internal :80.
  proxy: env.bool('IS_PROXIED', true),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});
