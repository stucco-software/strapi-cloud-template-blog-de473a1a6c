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
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
