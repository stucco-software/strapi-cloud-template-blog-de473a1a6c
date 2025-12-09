'use strict';

/**
 * static-resource router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::static-resource.static-resource');
