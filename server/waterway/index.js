'use strict';

const geo = require('./geo');
const context = require('./context');
const routing = require('./routing');
const trekRoute = require('./trek-route');
const places = require('./places');
const plan = require('./plan');
const search = require('./search');

module.exports = {
  ...geo,
  ...context,
  ...routing,
  ...trekRoute,
  ...places,
  ...plan,
  ...search,
};
