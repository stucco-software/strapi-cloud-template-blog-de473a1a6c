module.exports = ({ env }) => ({
  // S3 media upload provider — only when AWS_BUCKET is present (i.e. on ECS).
  // Locally AWS_BUCKET is unset, so Strapi falls back to the default local
  // provider. Credentials come from the ECS task role via the AWS SDK default
  // credential chain — no access keys are configured here.
  ...(env('AWS_BUCKET')
    ? {
        upload: {
          config: {
            provider: 'aws-s3',
            providerOptions: {
              // Serve media through CloudFront (the same distribution as the app),
              // under /uploads/*, which routes to this S3 bucket via OAC — so the
              // bucket stays private. `URL` is the CloudFront origin (set by ECS
              // once the distribution exists); `rootPath` prefixes every object
              // key with `uploads/`, matching the CloudFront /uploads/* behavior.
              baseUrl: env('URL') || undefined,
              rootPath: 'uploads',
              s3Options: {
                region: env('AWS_REGION'),
                params: {
                  Bucket: env('AWS_BUCKET'),
                  // No ACL header — the bucket has ACLs disabled (BucketOwner
                  // enforced); OAC handles read access. Sending any ACL 400s.
                  ACL: null,
                },
              },
            },
            actionOptions: {
              upload: {},
              uploadStream: {},
              delete: {},
            },
          },
        },
      }
    : {}),
});
