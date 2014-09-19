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

var misc = require('../../misc.js');

var oneMinute = 60 * 1000;
var twentyFourHours = 24 * 60 * oneMinute;

/**
 * Generates basal event records given a "settings" object and subsequent "basal" events.
 *
 * The "settings" object must come as the first event and all subsequent events must be in order sorted
 * by `'deviceTime'`.
 *
 * This function passes through normal scheduled basals, potentially annotating them if they don't agree with the
 * current settings.  It will also generate intermediate scheduled basal events to accomodate for the instances
 * where carelink doesn't generate them.
 *
 * Start and stop events are defined by the types parameter passed in.  types is an object of String -> function()
 * where the function is given the "stored event" and the currently processing event and should return either the
 * new event to be stored or null to clear the storage.
 *
 * The stored event is used to determine which scheduled events need to be created.  If there is a stored
 * event active, then scheduled basal events that do not already exist will be generated until either
 *
 * 1. The current stored event is cleared or
 * 2. If the current stored event has a duration field, events start showing up with a timestamp that is older
 *    than the given duration.
 *
 * @param types An object of event type to function, as described above.
 * @returns {*} A function that can be applied to an observable to generate basals
 */
module.exports = function(types, configFn){
  return function (observable) {
    return observable
      .map(misc.assertSorted(['deviceTime']))
      .link(
      function (outputObservable) {
        function determineDuration(timestamp, schedule, index) {
          var millisInDay = misc.computeMillisInCurrentDay(timestamp);
          if (index + 1 === schedule.length) {
            return twentyFourHours - millisInDay;
          } else {
            return schedule[index + 1].start - millisInDay;
          }
        }

        function emitSchedulesBetweenEventsIfExists(endTime) {
          if (currEvent != null) {
            var tempMillisInDay = misc.computeMillisInCurrentDay(currEvent.deviceTime);
            var schedule = settings.basalSchedules[settings.activeSchedule];

            if (schedule == null || schedule.length === 0) {
              currEvent = null;
              return;
            }

            if (currEvent.duration != null) {
              var durationEnd = currEvent.deviceTime.clone().add(currEvent.duration, 'ms');
              if (durationEnd.isBefore(endTime)) {
                endTime = durationEnd;
              }
            }

            var i;
            for (i = 0; i < schedule.length; ++i) {
              if (schedule[i].start >= tempMillisInDay) {
                break;
              }
            }

            var prevMillis = tempMillisInDay;
            var currTime = currEvent.deviceTime.clone();
            while (currTime.isBefore(endTime)) {
              if (i === schedule.length) {
                currTime.add(twentyFourHours - prevMillis, 'ms');
                prevMillis = 0;
                i = 0;
              } else {
                currTime.add(schedule[i].start - prevMillis, 'ms');
                prevMillis = schedule[i].start;
              }

              if (currTime.isBefore(endTime)) {
                emit(
                  misc.annotateEvent(
                    {
                      type: 'basal',
                      deviceTime: currTime.clone(),
                      deliveryType: 'scheduled',
                      scheduleName: settings.activeSchedule,
                      rate: schedule[i].rate,
                      deviceId: settings.deviceId,
                      duration: determineDuration(currTime, schedule, i)
                    },
                    'carelink/basal/temp-percent-create-scheduled'
                  )
                );
                ++i;
              } else {
                break;
              }
            }

            currEvent = null;
          }
        }

        function doScheduled(e) {
          if (e.startTime == null) {
            return emit(e);
          }

          var schedule = settings.basalSchedules[e.scheduleName];

          if (schedule == null) {
            schedule = [];
          }

          for (var j = 0; j < schedule.length; ++j) {
            if (schedule[j].rate === e.rate && e.startTime === schedule[j].start) {
              currScheduled = _.assign({}, e, { duration: determineDuration(e.deviceTime, schedule, j)});

              return emit(currScheduled);
            }
          }
          currScheduled = null;
          return emit(misc.annotateEvent(e, 'carelink/basal/off-schedule-rate'));
        }

        function fillInSchedulesForStaticBasal(newTime) {
          if (previousTime == null || settings == null) {
            return;
          }

          var schedule = settings.basalSchedules[settings.activeSchedule];
          if (schedule != null && schedule.length === 1) {
            while (newTime.valueOf() > previousTime.valueOf() && newTime.dayOfYear() !== previousTime.dayOfYear()) {
              var ts = previousTime.clone().add(24, 'hours');
              ts.subtract(misc.computeMillisInCurrentDay(ts), 'ms');

              if (ts.valueOf() === newTime.valueOf()) {
                return;
              }

              emit(
                misc.annotateEvent(
                  {
                    type: 'basal',
                    deviceTime: ts,
                    deliveryType: 'scheduled',
                    scheduleName: settings.activeSchedule,
                    rate: schedule[0].rate,
                    deviceId: settings.deviceId,
                    duration: 24 * 60 * 60 * 1000
                  },
                  'carelink/basal/static-rate-create-scheduled'
                )
              );
            }
          }
        }

        function emit(e) {
          fillInSchedulesForStaticBasal(e.deviceTime);
          previousTime = e.deviceTime.clone();
          return outputObservable.onNext(_.omit(e, 'startTime'));
        }

        var settings = null;
        var currEvent = null;
        var currScheduled = null;
        var previousTime = null;
        return rx.Observer.create(
          function (e) {
            if (e.type === 'settings') {
              settings = e;
              return emit(e);
            }

            // If we don't have a settings yet, we can't actually do any of what we'd like to
            if (settings == null) {
              return emit(e);
            }

            if (e.type === 'basal' && e.deliveryType === 'scheduled') {
              emitSchedulesBetweenEventsIfExists(e.deviceTime);
              doScheduled(e);
              return;
            }

            var handler = types[e.type];
            if (handler != null) {
              emitSchedulesBetweenEventsIfExists(e.deviceTime);
              currEvent = handler(currEvent, e);
            }
            emit(e);
          },
          outputObservable.onError.bind(outputObservable),
          function () {
            if (configFn != null) {
              var config = configFn();
              if (config.endTime != null) {
                fillInSchedulesForStaticBasal(config.endTime);
              }
            }
            outputObservable.onCompleted();
          }
        );
      });
  };
};