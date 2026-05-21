'use strict';

/**
 * committee service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::committee.committee');
