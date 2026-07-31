'use strict';

const geo = require('./geo');
const context = require('./context');
const routing = require('./routing');

module.exports = {
  ...geo,
  ...context,
  ...routing,
};
