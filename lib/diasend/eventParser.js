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

var parsing = require('../parsing.js');

function extractBgUnits(selector) {
  return parsing.map(selector, function (e) { return e === 'mg dl' ? 'mg dL' : e; });
}

var parserBuilder = parsing.parserBuilder();

parserBuilder
    .whenFieldIs('sheetName', 'Name and glucose')
    .applyConversion({
                       type: 'smbg',
                       deviceTime: parsing.extract('deviceTime'),
                       value: parsing.asNumber('value'),
                       units: extractBgUnits('units'),
                       deviceId: parsing.extract('deviceId')
                     })
    .done()
    .whenFieldIs('sheetName', 'CGM')
    .applyConversion({
                       type: 'cbg',
                       deviceTime: parsing.extract('deviceTime'),
                       value: parsing.asNumber('value'),
                       units: parsing.extract('units'),
                       deviceId: parsing.extract('deviceId')
                     })
    .done()
    .whenFieldIs('sheetName', 'Insulin use and carbs').newBuilder()
        .whenFieldIsDefined('Basal Amount (U/h)')
        .applyConversion({
                           type: 'basal',
                           deliveryType: 'scheduled',
                           scheduleName: 'unknown',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Basal Amount (U/h)'),
                           deviceId: parsing.extract('deviceId')
                         })
        .done()
        .whenFieldIsDefined('Carbs(g)')
        .applyConversion({
                           type: 'wizard',
                           deviceTime: parsing.extract('deviceTime'),
                           deviceId: parsing.extract('deviceId'),
                           payload: {
                             carbInput: parsing.asNumber('Carbs(g)'),
                             carbUnits: 'grams'
                           }
                         })
        .done()
        .whenFieldIs('Bolus Type', 'Normal')
        .applyConversion({
                           type: 'bolus',
                           subType: 'normal',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Bolus Volume (U)'),
                           deviceId: parsing.extract('deviceId')
                         })
        .done()
        .whenFieldIs('Bolus Type', 'Combination')
        .applyConversion({
                           type: 'bolus',
                           subType: 'square',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Bolus Volume (U)'),
                           immediate: parsing.asNumber('Immediate Volume (U)', null),
                           extended: parsing.asNumber('Extended Volume (U)', null),
                           duration: [parsing.asNumber('Duration (min)'), function(dur) { return dur * 60 * 1000; }],
                           deviceId: parsing.extract('deviceId'),
                           annotations: parsing.annotate('diasend/bolus/extended')
                         })
        .done()
        .build();

var parser = parserBuilder.build();

module.exports = function (e) {
  if (e.type == null) {
    return parser(e);
  }
  return e;
};

