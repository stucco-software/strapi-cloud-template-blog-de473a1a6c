'use strict';

/**
 * static-resource service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::static-resource.static-resource');
