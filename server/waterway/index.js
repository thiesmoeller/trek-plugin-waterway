'use strict';

const geo = require('./geo');
const context = require('./context');
const routing = require('./routing');
const trekRoute = require('./trek-route');

module.exports = {
  ...geo,
  ...context,
  ...routing,
  ...trekRoute,
};
