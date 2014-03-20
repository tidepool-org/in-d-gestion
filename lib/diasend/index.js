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

var pre = require('amoeba').pre;
var rx = require('rx');

var assignId = require('../assignId.js');
var eventParser = require('./eventParser.js');
var generateBasals = require('./generateBasals.js');
var misc = require('../misc.js');
var parsing = require('../parsing.js');
var xlsHandling = require('./xlsHandling.js');

exports.fetch = require('./fetch.js');

function basalOrSettingsType(e) {
  return e.type === 'basal' || e.type === 'settings';
}

/**
 * Converts an observable sequence of Buffers taken from a diasend xls file into tidepool platform objects
 *
 * @param observable the observable sequence of Buffers
 * @returns an observable sequence of tidepool platform objects
 */
exports.fromXls = function (observable) {
  var config = {};

  return observable
    .apply(xlsHandling.parseXls)
    .flatMap(function (xls) {
               config = xlsHandling.xlsToConfig(xls);
               return xlsHandling.xlsToEvents(xls);
             })
    .map(function (e) {
           if (e.type === 'settings' && e.deviceTime == null) {
             e.deviceTime = pre.hasProperty(config, 'startDate', 'Settings came before the meta dates object, wtf!?');
           }
           return e;
         })
    .map(misc.addDeviceTimeFn('Time', 'DD/MM/YYYY HH:mm'))
    .keep(eventParser)
    .splitMerge(function (e) {
             return basalOrSettingsType(e) ? 'basaly' : 'nonBasaly';
           },
           {
             basaly: function (observable) {
               return observable
                 .sort(misc.buildSortCompareFn(['deviceTime', { spec: 'type', order: 'desc' }]))
                 .apply(generateBasals);
             },
             nonBasaly: function (observable) {
               return observable;
             }
           })
    .map(misc.convertDeviceTimeToString)
    .map(function (e) {
           e.deviceId = config.deviceId;
           return e;
         })
    .map(assignId)
    .map(misc.attachFieldFn('source', 'diasend'));
};
