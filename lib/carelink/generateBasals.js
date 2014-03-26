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
      .map(misc.assertSorted(function(e){ return e.deviceTime.valueOf(); }))
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

        function computeMillisInDay(dateTime) {
          var millisInDay = dateTime.hour() * 60 * 60 * 1000;
          millisInDay += dateTime.minute() * 60 * 1000;
          millisInDay += dateTime.second() * 1000;
          millisInDay += dateTime.milliseconds();
          return millisInDay;
        }

        var currSettings = null;
        var currSchedule = null;
        var currBasal = null;
        var expectedNext = null;
        var scheduleIndex = 0;
        var nextTime = null;

        function setExpectedNext() {
          var currTime = null;
          if (expectedNext == null) {
            var startMillis;
            if (currSchedule.length <= 1) {
              scheduleIndex = 0;
              startMillis = 0;
            } else {
              var millisInDay = computeMillisInDay(currSettings.deviceTime);
              for (scheduleIndex = 0; scheduleIndex < currSchedule.length; ++scheduleIndex) {
                if (millisInDay < currSchedule[scheduleIndex].start) {
                  --scheduleIndex;
                  break;
                }
              }
              if (scheduleIndex == currSchedule.length ) {
                --scheduleIndex;
              }
              startMillis = currSchedule[scheduleIndex].start;
            }

            currTime = currSettings.deviceTime.clone().startOf('day').add(startMillis);
          } else {
            currTime = nextTime;
          }

          currBasal = expectedNext;

          var currRate;
          if (scheduleIndex < currSchedule.length) {
            currRate = currSchedule[scheduleIndex];
          } else {
            currRate = { rate: 0, start: 0 };
          }

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
          if (currSettings.annotations != null) {
            expectedNext.annotations = _.cloneDeep(currSettings.annotations);
          }

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
                currSettings = e;
                currSchedule = currSettings.basalSchedules[currSettings.activeBasalSchedule];

                expectedNext = null;
                setExpectedNext();
                return outputObservable.onNext(e);
              }

              if (currSettings == null) {
                // If we don't have a settings object yet, then just assume that things are on the up-and-up
                return outputObservable.onNext(e);
              }

              if (e.type !== 'basal' || e.deliveryType !== 'scheduled') {
                return outputObservable.onNext(e);
              }

              // We check if the timestamp is after our expected next
              var nextMillis = expectedNext.deviceTime.valueOf();
              var eventMillis = e.deviceTime.valueOf();
              while (nextMillis < eventMillis) {
                // It is after our expected next, so generate events for all expectations until it is not.
                outputObservable.onNext(expectedNext);
                setExpectedNext();
                nextMillis = expectedNext.deviceTime.valueOf();
              }

              if (matchesExpectedNext(e)) {
                outputObservable.onNext(expectedNext);
                setExpectedNext();
              } else {
                if (currBasal.value === e.value) {
                  // It's just a continuation of our current basal, so ignore it
                } else {
                  // The executive decision was made that this means that our schedule must have changed
                  // without us knowing!  So, we must fix the settings object and make it show users
                  // something that their pump might or might not have actually shown them.  We do not
                  // know and cannot know.

                  var startMillis = computeMillisInDay(e.deviceTime);

                  // Do a bit of a cloning dance to ensure that we don't just repeatedly
                  // mutate the same object over and over again
                  var cloneSettings = _.clone(currSettings);
                  var theSchedule = _.cloneDeep(cloneSettings.basalSchedules[cloneSettings.activeBasalSchedule]);
                  theSchedule[scheduleIndex == 0 ? scheduleIndex.length - 1 : scheduleIndex - 1] = {
                    rate: e.value,
                    start: startMillis
                  };
                  cloneSettings.basalSchedules[cloneSettings.activeBasalSchedule] = theSchedule;

                  misc.annotateEvent(cloneSettings, 'basal-changed-settings');
                  currSettings = cloneSettings;

                  outputObservable.onNext(cloneSettings);
                  outputObservable.onNext(e);
                }
              }
            },
            outputObservable.onError.bind(outputObservable),
            function() {
              outputObservable.onCompleted();
            }
        )
      })
};