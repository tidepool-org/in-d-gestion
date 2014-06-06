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

var XmlStream = require('xml-stream');
var rx = require('rx');
var EventEmitter = require('events').EventEmitter;

var PUMP_NAME = 'Pump:t:slim';

var makeParser = function(outEmitter) {
    var emitter = outEmitter;

    var parseBg = function(item) {
        emitter.emit('data', {
            type: 'smbg',
            value: parseFloat(item.BG),
            deviceTime: item.EventDateTime,
            deviceId: item.$.DeviceType + ':' + item.$.SerialNumber,
        });
    };

    var parseBolus = function(item) {
        var subType;
        var hasStandard = true;
        var hasExtended = false;
        var baseEvent;
        var extendedCompletion = null;
        var standardCompletion = null;

        var round10 = function(value, exp) {
            value = +value;
            exp = +exp;

            value = value.toString().split('e');
            value = Math.round(+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp)));
            value = value.toString().split('e');
            return +(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp));
        };

        if (item.StandardPercent === '100.00') {
            subType = 'normal';
        } else {
            hasExtended = true;
            if (item.StandardPercent === '0.00') {
                subType = 'square';
                hasStandard = false;
            } else
                subType = 'dual/square';
        }

        baseEvent = {
            type: 'bolus',
            subType: subType,
            deviceTime: item.RequestDateTime,
            deviceId: PUMP_NAME,
        };

        if (hasStandard) {
            // baseEvent.value = item.Standard.InsulinRequested;
            baseEvent.value = round10((parseFloat(item.StandardPercent) / 100.0 * parseFloat(item.ActualTotalBolusRequested)), -2);
            // You would think that you could use the item.Standard.InsulinRequested value.
            // You can't.  If you cancel it, the field is missing from the XML.
            //  I'm sure that's a bug on Tandem's side
            if (item.Standard.InsulinDelivered && item.Standard.InsulinDelivered.$) {
                standardCompletion = {
                    type: baseEvent.type,
                    subType: 'normal',
                    deviceTime: item.Standard.InsulinDelivered.$.CompletionDateTime,
                    value: parseFloat(item.Standard.InsulinDelivered.$text),
                    deviceId: baseEvent.deviceId,
                    previous: baseEvent
                };
            }
        }
        if (hasExtended) {
            //baseEvent.extended = item.Bolex.InsulinRequested;
            baseEvent.extended = round10((100.0 - parseFloat(item.StandardPercent)) / 100.0 * parseFloat(item.ActualTotalBolusRequested), -2);

            baseEvent.duration = parseInt(item.Duration) * 60000;
            if (item.Bolex.InsulinDelivered) {
              extendedCompletion = {
                  type: baseEvent.type,
                  subType: 'square',
                  deviceTime: item.Bolex.InsulinDelivered.$.CompletionDateTime,
                  extended: parseFloat(item.Bolex.InsulinDelivered.$text),
                  deviceId: baseEvent.deviceId,
                  previous: baseEvent
            };
          }
        }

        var wizardEvent = {
            type: 'wizard',
            recommended: round10(parseFloat(item.FoodBolusSize) + parseFloat(item.CorrectionBolusSize), -2),
            payload: {
                targetHigh: parseInt(item.TargetBG),
                targetLow: parseInt(item.TargetBG),
                carbRatio: round10(parseFloat(item.CarbSize) / parseFloat(item.FoodBolusSize), -1),
                insulinSensitivity: parseFloat(item.CorrectionFactor),
                bgInput: item.BG ? parseFloat(item.BG) : '',
                bgUnits: 'mg/dL',
                foodInput: parseFloat(item.CarbSize),
                foodUnits: 'g',
                foodEstimate: parseFloat(item.FoodBolusSize),
                correctionEstimate: parseFloat(item.CorrectionBolusSize),
                activeInsulin: parseFloat(item.IOB)
            },
            deviceTime: item.RequestDateTime,
            deviceId: baseEvent.deviceId,
        };
        
        if (baseEvent)
            emitter.emit('data', baseEvent);
        if (standardCompletion)
            emitter.emit('data', standardCompletion);
        if (extendedCompletion)
            emitter.emit('data', extendedCompletion);
        if (wizardEvent)
            emitter.emit('data', wizardEvent);
    };

    var parseBasal = function(item) {
        if (item.$.Interactive == '1')
        // non-interactive rates are sent on date boundaries and with previous rates
        // upon temporary rate transitions.  This might be useful for tracking suppressed
        // doses.
            emitter.emit('data', {
                type: 'basal',
                deliveryType: (item.$.TempRateID && !item.$.TempRateCompleted ? 'temp' : 'scheduled'),
                value: parseFloat(item.BasalRate.$text),
                duration: item.$.TempRateActivated ? item.BasalRate.$.Duration * 60000 : 0,
                deviceTime: item.EventDateTime,
                deviceId: PUMP_NAME,
                scheduleName: 'unknown',
            });
    };

    var parseEvent = function(item) {
        var eventType = item.$.Type;
        if (eventType == 'BG') {
            parseBg(item);
        } else if (eventType == 'Basal') {
            parseBasal(item);
        } else if (eventType == 'Bolus') {
            parseBolus(item);
        }
    };
    return parseEvent;
};

exports.parseXml = function(inStream) {
    var emitter = new EventEmitter();
    var xml = new XmlStream(inStream);
    xml.on('endElement: Event', makeParser(emitter));
    xml.on('end', function() { emitter.emit('end'); });
    xml.on('error', function(e) { emitter.emit('error', e); });
    return rx.Node.fromStream(emitter);
};

