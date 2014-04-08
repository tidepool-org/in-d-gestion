/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2014, Tidepool Project
 * 
 * This program is free software; you can redistribute it and/or modify it under
 * the terms of the associated License, which is identical to the BSD 2-Clause
 * License as published by the Open Source Initiative at opensource.org.
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the License for more details.
 * 
 * You should have received a copy of the License along with this program; if
 * not, you can obtain one from Tidepool Project at tidepool.org.
 * == BSD2 LICENSE ==
 */
'use strict';

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
    .passThroughStream(transformer())
    .map(function (e) {
           e.value = Number(e.value);
           return e;
         });
};