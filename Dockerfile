# Strapi 5 (Pro, self-hosted) — production container image.
#
# Build stage compiles the admin panel (`strapi build`) with the native toolchain
# needed by sharp (vips) and better-sqlite3; runtime stage runs `strapi start`.
#
# Runtime env (injected by ECS from Secrets Manager / task def — see areaa-infra):
#   STRAPI_LICENSE                              Strapi Pro license key
#   DATABASE_CLIENT=postgres
#   DATABASE_URL  (or DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD) + DATABASE_SSL
#   APP_KEYS, API_TOKEN_SALT, ADMIN_JWT_SECRET, JWT_SECRET,
#   TRANSFER_TOKEN_SALT, ENCRYPTION_KEY
#   URL           public origin (CloudFront domain) for correct admin/asset URLs
#   CLIENT_URL    Astro origin, for Live Preview + CORS
#   AWS_* / S3 bucket vars for the media upload provider
#
# NOTE: switch the upload provider to S3 (config/plugins.js) before first upload —
# Fargate's filesystem is ephemeral, so local uploads vanish on restart.

# ---- build ----
FROM node:22-alpine AS build
# Native build deps for sharp (vips) + better-sqlite3.
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev nasm bash vips-dev git
WORKDIR /opt/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
# vips runtime lib for sharp.
RUN apk add --no-cache vips-dev
ENV NODE_ENV=production
WORKDIR /opt/app
# Carry over installed deps + built admin panel from the build stage.
COPY --from=build /opt/app ./
EXPOSE 1337
CMD ["npm", "run", "start"]
