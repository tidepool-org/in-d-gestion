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
var Stream = require('stream').Stream;
var rx = require('rx');


var SOURCE = 't:connect';
var PUMP_NAME = 'Pump:t:slim';

var makeParser = function(outStream) {
    var stream = outStream;

    var parseBg = function(item) {
        stream.emit('data', {
            type: 'smbg',
            value: item.BG,
            time: item.EventDateTime,
            deviceId: item.$.DeviceType + ':' + item.$.SerialNumber,
            source: SOURCE
        });
    };

    var parseBolus = function(item) {
        var subType;
        var hasStandard = true;
        var hasExtended = false;
        var baseEvent;
        var extendedCompletion;
        var standardCompletion;

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
            time: item.RequestDateTime,
            deviceId: PUMP_NAME,
            source: 'tconnect'
        };

        if (hasStandard) {
            // baseEvent.value = item.Standard.InsulinRequested;
            baseEvent.value = parseFloat(item.StandardPercent) / 100.0 * parseFloat(item.ActualTotalBolusRequested);
            // You would think that you could use the item.Standard.InsulinRequested value.
            // You can't.  If you cancel it, the field is missing from the XML.  I'm sure
            // that's a bug on Tandem's side.
            standardCompletion = {
                type: baseEvent.type,
                subType: 'normal',
                time: item.Standard.InsulinDelivered.$.CompletionDateTime,
                value: item.Standard.InsulinDelivered.$text,
                deviceId: baseEvent.deviceId,
                source: baseEvent.source,
                previous: baseEvent
            };
        }
        if (hasExtended) {
            //baseEvent.extended = item.Bolex.InsulinRequested;
            baseEvent.extended = (100.0 - parseFloat(item.StandardPercent)) / 100.0 * parseFloat(item.ActualTotalBolusRequested);

            baseEvent.duration = parseInt(item.Duration) * 60000;
            extendedCompletion = {
                type: baseEvent.type,
                subType: 'square',
                time: item.Bolex.InsulinDelivered.$.CompletionDateTime,
                extended: item.Bolex.InsulinDelivered.$text,
                deviceId: baseEvent.deviceId,
                source: baseEvent.source,
                previous: baseEvent
            };
        }

        var wizardEvent = {
            type: 'wizard',
            recommended: parseFloat(item.FoodBolusSize) + parseFloat(item.CorrectionBolusSize),
            payload: {
                targetHigh: item.TargetBG,
                targetLow: item.TargetBG,
                // carbRatio: null, parse from description string?
                insulinSensitivity: item.CorrectionFactor,
                bgInput: item.BG,
                bgUnits: 'mg dL',
                foodInput: item.CarbSize,
                foodUnits: 'g',
                foodEstimate: item.FoodBolusSize,
                correctionEstimate: item.CorrectionBolusSize,
                activeInsulin: item.IOB
            },
            time: item.RequestDateTime,
            deviceId: baseEvent.deviceId,
            source: baseEvent.source
        };
        if (baseEvent)
            stream.emit('data', baseEvent);
        if (hasStandard)
            stream.emit('data', standardCompletion);
        if (hasExtended)
            stream.emit('data', extendedCompletion);
        if (wizardEvent)
            stream.emit('data', wizardEvent);
    };

    var parseBasal = function(item) {
        if (item.$.Interactive == '1')
        // non-interactive rates are sent on date boundaries and with previous rates
        // upon temporary rate transitions.  This might be useful for tracking suppressed
        // doses.
            stream.emit('data', {
                type: 'basal',
                deliveryType: (item.$.TempRateID && !item.$.TempRateCompleted ? 'temp' : 'scheduled'),
                value: item.BasalRate.$text,
                duration: item.$.TempRateActivated ? item.BasalRate.$.Duration : 0,
                time: item.EventDateTime,
                deviceId: PUMP_NAME,
                scheduleName: 'unknown',
                source: SOURCE
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

var tconnectParser = function(inStream) {
    console.log('parsing');
    var stream = new Stream();
    var xml = new XmlStream(inStream);
    xml.on('endElement: Event', makeParser(stream));
    return rx.Node.fromStream(stream);
};

module.exports = tconnectParser;
