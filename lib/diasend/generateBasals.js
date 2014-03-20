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

var _ = require('lodash');
var except = require('amoeba').except;
var rx = require('rx');

var misc = require('../misc.js');

var millisInADay = 24 * 60 * 60 * 1000;
var fiveMinutes = 5 * 60 * 1000;

/**
 * Generates basal event records given a "settings" object and subsequent "basal" events.
 *
 * The "settings" object must come as the first event and all subsequent events must be in order sorted
 * by `'deviceTime'`.
 *
 * This function will generate "scheduled" basal events according to the given schedule.
 *
 * It will generate temp basals if it sees a basal with a value that does not match the
 * currently scheduled rate, *OR* if it sees a basal-rate-chane event that is outside of a +/- 5 minute
 * window of the point at which the given schedule should start.
 *
 * @param observable The observable object to modify with basals
 * @returns {*|string} The modified observable object that includes basals
 */
module.exports = function(observable) {
  return observable
      .map(misc.assertSorted(['deviceTime']))
      .link(
      function(outputObservable){

        /**
         * Matching is defined as having the same value and being within 5 minutes.
         *
         * @param e the event that might match
         * @returns {boolean} whether the event matches
         */
        function matchesExpectedNext(e) {
          var eventMillis = e.deviceTime.valueOf();
          var expectedMillis = expectedNext.deviceTime.valueOf();
          return e.value === expectedNext.value
            && (eventMillis - fiveMinutes <= expectedMillis || eventMillis <= expectedMillis + fiveMinutes);
        }

        var currSettings = null;
        var currSchedule = null;
        var expectedNext = null;
        var scheduleIndex = 0;
        var nextTime = null;

        function setExpectedNext() {
          var currTime = null;
          if (expectedNext == null) {
            currTime = currSettings.deviceTime.clone().startOf('day')
          } else {
            currTime = nextTime;
          }

          var currRate = currSchedule[scheduleIndex];
          var endOfRate = (scheduleIndex + 1 < currSchedule.length ? currSchedule[scheduleIndex + 1].start : millisInADay);
          expectedNext = {
            type: 'basal',
            deviceTime: currTime,
            deliveryType: 'scheduled',
            scheduleName: currSettings.activeBasalSchedule,
            value: currRate.rate,
            deviceId: currSettings.deviceId,
            duration: endOfRate - currRate.start
          };
          ++scheduleIndex;
          if (scheduleIndex >= currSchedule.length) {
            scheduleIndex = 0;
            nextTime = expectedNext.deviceTime.clone().startOf('day').add('day', 1);
          } else {
            nextTime = expectedNext.deviceTime.clone().add('ms', expectedNext.duration);
          }
        }

        return rx.Observer.create(
            function(e) {
              if (e.type === 'settings') {
                if (currSettings == null) {
                  currSettings = e;
                  currSchedule = currSettings.basalSchedules[currSettings.activeBasalSchedule];
                  setExpectedNext();

                  return outputObservable.onNext(e);
                } else {
                  throw except.ISE('Cannot handle updating the settings event yet, please implement now.');
                }
              }

              if (e.type !== 'basal') {
                return outputObservable.onNext(e);
              }

              if (matchesExpectedNext(e)) {
                outputObservable.onNext(expectedNext);
                setExpectedNext();
              } else {
                // It doesn't match, so therefore it is a temp basal!
                // We check if the timestamp is after our expected next
                var nextMillis = expectedNext.deviceTime.valueOf();
                var eventMillis = e.deviceTime.valueOf();
                while (nextMillis < eventMillis) {
                  // It is after our expected next, so generate events for all expectations until it is not.
                  outputObservable.onNext(expectedNext);
                  setExpectedNext();
                  nextMillis = expectedNext.deviceTime.valueOf();
                }

                // Emit the temp as if it runs until our expectation
                outputObservable.onNext(
                  misc.annotateEvent(
                    _.assign({}, e, { deliveryType: 'temp', duration: nextMillis - eventMillis}),
                    "diasend/temp-basal-fabrication"
                  )
                );
              }
            },
            outputObservable.onError.bind(outputObservable),
            function() {
              outputObservable.onCompleted();
            }
        )
      })
};