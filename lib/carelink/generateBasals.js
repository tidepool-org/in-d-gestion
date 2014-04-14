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
 * @param observable The observable object to modify with basals
 * @returns {*|string} The modified observable object that includes basals
 */
module.exports = function(observable) {
  return observable
      .map(misc.assertSorted([function(e){ return e.deviceTime.valueOf(); }, { spec: 'type', order: 'desc' }]))
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
          return e.value === expectedNext.value &&
                 (eventMillis === expectedMillis ||
                  (eventMillis > expectedMillis && eventMillis - fiveMinutes <= expectedMillis) ||
                  (eventMillis < expectedMillis &&  eventMillis + fiveMinutes >= expectedMillis));
        }

        function addToSchedule(rate, schedule) {
          for (var i = 0; i < schedule.length; ++i) {
            if (schedule[i].start === rate.start) {
              schedule[i] = rate;
              return;
            } else if (schedule[i].start > rate.start) {
              schedule.splice(i, 0, rate);
              return;
            }
          }
          schedule.push(rate);
        }

        var cloneEmDeep = ['basalSchedules', 'units', 'bgTarget', 'carbRatio', 'insulinSensitivity'];
        function cloneCurrSettings() {
          var retVal = {};
          _.assign(
            retVal,
            _.omit(currSettings, ['deviceTime'].concat(cloneEmDeep))
          );

          retVal.deviceTime = currSettings.deviceTime.clone();
          cloneEmDeep.forEach(function(key) {
            retVal[key] = _.cloneDeep(currSettings[key]);
          });

          return retVal;
        }

        var currSettings = null;
        var currSchedule = null;
        var currBasalRate = null;
        var expectedNext = null;
        var scheduleIndex = 0;
        var nextTime = null;

        function setExpectedNext() {
          var currTime = null;
          if (expectedNext == null) {
            var startMillis;

            // Figure out what scheduled rate we should currently be on, given the timestamp of the
            // current schedule
            if (currSchedule.length < 1) {
              // No actual schedule, so default to a basal rate of 0 and start it "tomorrow"
              scheduleIndex = 0;
              startMillis = millisInADay;
            } else {
              var currentDayMillis = misc.computeMillisInCurrentDay(currSettings.deviceTime);
              for (scheduleIndex = 0; scheduleIndex < currSchedule.length; ++scheduleIndex) {
                if (currentDayMillis <= currSchedule[scheduleIndex].start) {
                  break;
                }
              }
              if (scheduleIndex == currSchedule.length ) {
                // We are in the last rate of the current set of schedules, so we should start
                // fabricating data at the first scheduled rate tomorrow
                scheduleIndex = 0;
                startMillis = millisInADay;
                currBasalRate = currSchedule[currSchedule.length - 1].rate;
              } else {
                startMillis = currSchedule[scheduleIndex].start;
                currBasalRate = currSchedule[scheduleIndex - 1 < 0 ? currSchedule.length - 1 : scheduleIndex - 1].rate;
              }
            }

            currTime = currSettings.deviceTime.clone().startOf('day').add(startMillis);
          } else {
            currTime = nextTime;
            currBasalRate = expectedNext.value;
          }


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

              // If the event happens before our expected next, fabricate whatever events we
              // should fabricate in order to maintain the time-based ordering
              var nextMillis = expectedNext.deviceTime.valueOf();
              var eventMillis = e.deviceTime.valueOf();

              // If the events are separated by more than 24 hours, don't create events
              var fabricateEvents = (eventMillis - nextMillis) < 24 * 60 * 60 * 1000;
              while (nextMillis < eventMillis) {
                if (fabricateEvents) {
                  outputObservable.onNext(expectedNext);
                }
                setExpectedNext();
                nextMillis = expectedNext.deviceTime.valueOf();
              }

              if (e.type !== 'basal' || e.deliveryType !== 'scheduled') {
                return outputObservable.onNext(e);
              }

              if (matchesExpectedNext(e)) {
                outputObservable.onNext(expectedNext);
                setExpectedNext();
              } else {
                if (currBasalRate === e.value) {
                  // It's just a continuation of our current basal, so ignore it
                } else {
                  // The executive decision was made that this case means that our schedule must have
                  // changed without us knowing.  So, we must fix the settings object and make it show
                  // users something that their pump might or might not have actually shown them.  We do
                  // not and cannot know.

                  // This happens because there are times when we do not receive all settings changes
                  // from the pump.  Or for other cases that we are unaware of at this time.  Assuming
                  // a valid stream from a pump, this shouldn't ever actually occur as the Medtronic
                  // pump reports things correctly.  Issues appear to potentially happen when pumps are
                  // reset, shared or when the full data set is not retrieved from carelink.  Once this
                  // occurs once, all events generated from "tainted" settings until we are given a
                  // settings object that we know to be 100% accurate are annotated to indicate
                  // that they are fabricated data points.  Visualizations using our data should expose
                  // these annotations to users in some fashion.

                  var startMillis = misc.computeMillisInCurrentDay(e.deviceTime);
                  var newRate = { rate: e.value, start: startMillis };

                  // Do a bit of a cloning dance to ensure that we don't just repeatedly
                  // mutate the same object over and over again
                  var cloneSettings = cloneCurrSettings();
                  var theSchedule = cloneSettings.basalSchedules[cloneSettings.activeBasalSchedule];
                  addToSchedule(newRate, theSchedule);

                  misc.annotateEvent(cloneSettings, 'basal-changed-settings');
                  cloneSettings.deviceTime = e.deviceTime.clone();
                  currSettings = cloneSettings;
                  setExpectedNext();

                  outputObservable.onNext(cloneSettings);
                  outputObservable.onNext(e);
                }
              }
            },
            outputObservable.onError.bind(outputObservable),
            function() {
              outputObservable.onCompleted();
            }
        );
      });
};