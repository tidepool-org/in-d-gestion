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
var moment = require('moment');
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
 * It will generate temp basals if it sees a basal with a value that does not match any
 * scheduled rate, *OR* if it sees a basal-rate-chane event that is outside of a +/- 5 minute
 * window of the point at which the rate would start on some schedule.
 *
 * @param observable The observable object to modify with basals
 * @returns {*|string} The modified observable object that includes basals
 */
module.exports = function(observable) {
  return observable
      .map(misc.assertSorted(['deviceTime']))
      .link(
      function(outputObservable){

        function setExpectedNext() {
          var currTime = null;
          if (expectedNext == null) {
            currTime = settings.deviceTime.clone().startOf('day')
          } else {
            currTime = nextTime;
          }

          var currRate = currSchedule[scheduleIndex];
          var endOfRate = (scheduleIndex + 1 < currSchedule.length ? currSchedule[scheduleIndex + 1].start : millisInADay);
          expectedNext = {
            type: 'basal',
            deviceTime: currTime,
            deliveryType: 'scheduled',
            scheduleName: settings.activeBasalSchedule,
            value: currRate.rate,
            deviceId: settings.deviceId,
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

        function emitTempIfExists(currTime) {
          if (tempBasal != null) {
            // Emit the temp if we have one
            var tempDuration = currTime.valueOf() - tempBasal.deviceTime.valueOf();
            outputObservable.onNext(_.assign(tempBasal, { duration: tempDuration }));
            tempBasal = null;
          }
        }

        var settings = null;
        var scheduleNames = null;
        var expectedNext = null;
        var tempBasal = null;
        return rx.Observer.create(
            function(e) {
              if (e.type === 'settings') {
                if (settings == null) {
                  settings = e;
                  scheduleNames = Object.keys(settings.basalSchedules);

                  return outputObservable.onNext(e);
                } else {
                  throw except.ISE('Cannot handle updating the settings event yet, please implement now.');
                }
              }

              if (e.type !== 'basal') {
                return outputObservable.onNext(e);
              }

              var millisInEvent = misc.computeMillisInCurrentDay(e.deviceTime);
              for (var i = 0; i < scheduleNames.length; ++i) {
                var schedule = settings.basalSchedules[scheduleNames[i]];
                for (var j = 0; j < schedule.length; ++j) {
                  if (schedule[j].rate === e.value) {
                    var startMillis = schedule[j].start;
                    if (millisInEvent === startMillis ||
                        (millisInEvent > startMillis && millisInEvent - fiveMinutes <= startMillis) ||
                        (millisInEvent < startMillis && millisInEvent + fiveMinutes >= startMillis)) {
                      var actualTime = moment(e.deviceTime.clone().subtract('ms', millisInEvent).add('ms', startMillis));

                      emitTempIfExists(actualTime);

                      return outputObservable.onNext(
                        {
                          type: 'basal',
                          deviceTime: actualTime,
                          deliveryType: 'scheduled',
                          scheduleName: scheduleNames[i],
                          value: e.value,
                          deviceId: settings.deviceId,
                          duration: ((j+1 === schedule.length) ? millisInADay : schedule[j+1].start) - startMillis
                        }
                      );
                    }
                  }
                }
              }

              // If the loop above didn't exit, then we have a temp basal.
              // We have to figure out when it completes, for this we store the temp aside
              // and emit it on the next event.  But, first, we must check if we have a temp already and emit it
              emitTempIfExists(e.deviceTime);

              tempBasal = misc.annotateEvent(
                _.assign({}, e, { deliveryType: 'temp' }),
                "diasend/temp-basal-fabrication"
              );
            },
            outputObservable.onError.bind(outputObservable),
            function() {
              if (tempBasal != null) {
                // We don't really have a good idea of the duration, so we guess based on the "current" schedule
                var sched = settings.basalSchedules[settings.activeBasalSchedule];
                var millisInTemp = misc.computeMillisInCurrentDay(tempBasal.deviceTime);
                for (var i = 0; i < sched.length - 1; ++i) {
                  if (sched[i + 1].start > millisInTemp) {
                    break;
                  }
                }
                outputObservable.onNext(
                  _.assign(tempBasal, {
                    duration: ((i+1 === sched.length) ? millisInDay : sched[i+1].start) - millisInTemp
                  })
                );
                tempBasal = null;
              }
              outputObservable.onCompleted();
            }
        )
      })
};