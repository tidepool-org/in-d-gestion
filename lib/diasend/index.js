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

var _ = require('lodash');
var rx = require('rx');

var eventParser = require('./eventParser.js');
var misc = require('../misc.js');
var xlsHandling = require('./xlsHandling.js');

exports.fetch = require('./fetch.js');

/**
 * Converts an observable sequence of Buffers taken from a diasend xls file into tidepool platform objects
 *
 * @param inStream a stream from the file pulled via fetch (expect it to be an XLS)
 * @returns an observable sequence of tidepool platform objects
 */
exports.parse = function (inStream, config) {
  config = _.cloneDeep(config);

  return rx.Node.fromStream(inStream)
    .apply(xlsHandling.parseXls)
    .flatMap(function (xls) {
               _.assign(config, xlsHandling.xlsToConfig(xls));
               return xlsHandling.xlsToEvents(xls);
             })
    .map(misc.addDeviceTimeFn('Time', 'DD/MM/YYYY HH:mm'))
    .map(function (e) {
           if (e.type === 'settings') {
             e.deviceTime = config.endDate;
           }
           return e;
         })
    .keep(eventParser)
    .apply(require('./basalDuration.js')(config))
    .map(misc.deviceTimeToUtc(config.timezone))
    .map(function (e) {
           e.deviceId = config.deviceId;
           return e;
         })
    .map(misc.convertDeviceTimeToString)
    .map(misc.attachFieldFn('source', 'diasend'));
};
