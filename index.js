'use strict';

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/flux.min.js');
} else {
  module.exports = require('./dist/flux.js');
}
