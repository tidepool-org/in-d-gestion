/*
 * == BSD2 LICENSE ==
 */

// Make sure our extensions are registered
require('../rx');

var fs = require('fs');

var pre = require('amoeba').pre;
var rx = require('rx');

var transformer = require('./parse.js');


exports.fetch = function(config, cb) {
  var dexcomFile = pre.hasProperty(config, 'file', 'Can only read local files, please specify the \'file\' field');
  return cb(null, fs.createReadStream(dexcomFile));
};

/**
 * Converts a dexcom file stream (defined as what fetch would provide) into an observable of tidepool
 * platform events
 *
 * @param inStream input stream
 */
exports.parse = function(inStream) {
  return rx.Node.fromStream(inStream)
    .passThroughStream(transformer());
};