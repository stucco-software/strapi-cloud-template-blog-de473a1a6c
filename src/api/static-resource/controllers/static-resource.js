'use strict';

/**
 * static-resource controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::static-resource.static-resource');
