'use strict';

/**
 * top-nav service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::top-nav.top-nav');
