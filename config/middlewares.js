// S3 media host (e.g. bucket.s3.us-west-2.amazonaws.com) — added to the admin
// CSP so uploaded assets render in the Media Library. Null locally (no bucket).
const s3Host = ({ env }) =>
  env('AWS_BUCKET')
    ? `${env('AWS_BUCKET')}.s3.${env('AWS_REGION', 'us-west-2')}.amazonaws.com`
    : null;

module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', s3Host({ env })].filter(Boolean),
          'media-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', s3Host({ env })].filter(Boolean),
          // Allow the admin Preview iframe to embed the frontend app
          'frame-src': ["'self'", env('CLIENT_URL')],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      // Reject oversized uploads at the transport layer. The chapter-admin
      // media endpoint caps at 5MB; this stops a 200MB body being written to
      // disk before that check ever runs. Headroom left for admin-panel uploads.
      formidable: { maxFileSize: 20 * 1024 * 1024 },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
