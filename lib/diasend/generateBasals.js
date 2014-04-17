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
var except = require('amoeba').except;
var moment = require('moment');
var rx = require('rx');

var misc = require('../misc.js');

var oneMinute = 60 * 1000;
var fiveMinutes = 5 * oneMinute;
var twentyFourHours = 24 * 60 * oneMinute;
var fiveDays = 5 * twentyFourHours;

var millisInADay = twentyFourHours;

/**
 * Generates basal event records given a "settings" object and subsequent "basal" events.
 *
 * The "settings" object must come as the first event and all subsequent events must be in order sorted
 * by `'deviceTime'`.
 *
 * This function generates a normal scheduled basal only if the basal value matches *some* scheduled rate
 * AND if the timing of the event is within +/- 5 minutes of that scheduled rate. Otherwise, generates a temp basal.
 *
 * @param observable The observable object to modify with basals
 * @returns {*|string} The modified observable object that includes basals
 */
module.exports = function(config){
  return function(observable) {
    return observable
      .map(misc.assertSorted(['deviceTime']))
      .link(
      function(outputObservable){
        function emitTempIfExists(currTime) {
          if (tempBasal != null) {

            var dur = currTime.valueOf() - tempBasal.deviceTime.valueOf();
            if (dur === 0) {
              // Apparently, sometimes, when a percentage temp basal is active, diasend will provide
              // two readings for when a basal rate should change according to schedule.  They happen as the
              // temp rate first, followed by the one for the scheduled rate.  This is actually preferrable
              // as an event emission system is concerned, but it fools the logic here into believing that
              // the temp was really short and didn't actually happen.  Thus, if we get a temp that is a
              // duration of 0, then we assume that it is a case like this and the current event we are
              // comparing against to compute our duration is a scheduled rate that didn't actually happen.
              //
              // We do not emit the temp, but we keep it aside to have its duration computed based on the next
              // change in basal rates.
              //
              // If this event turns out to not be a scheduled, the the current event will clobber this temp.
              // But, that also means that we had two temp basals with no duration between this and the new
              // one, so it is effectively just eliminating this event, which is probably the best we can do
              // anyway.
              return false;
            }

            // Emit the temp if we have one,
            var theTemp = _.clone(tempBasal);
            tempBasal = null;

            theTemp.duration = dur;

            // limit the duration to a max of 24 hours.
            if (theTemp.duration > twentyFourHours) {
              theTemp.duration = twentyFourHours;
              misc.annotateEvent(theTemp, 'diasend/temp-limit-24hrs');
            }

            outputObservable.onNext(theTemp);
            return true;
          }
          return false;
        }

        var settings = null;
        var scheduleNames = null;
        var tempBasal = null;
        var activeScheduled = null;
        return rx.Observer.create(
          function(e) {
            if (e.type === 'settings') {
              if (settings == null) {
                settings = e;
                scheduleNames = Object.keys(settings.basalSchedules);

                return outputObservable.onNext(_.assign({}, e, {deviceTime: config.endDate}));
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

                    emitTempIfExists(e.deviceTime);

                    var duration = 0;
                    var prevIndex;
                    var endMillis;
                    var currIndex = j;
                    // https://github.com/tidepool-org/hub/blob/master/diasend/diasendIssues.md
                    do {
                      prevIndex = currIndex;

                      if (currIndex + 1 === schedule.length) {
                        currIndex = 0;
                        endMillis = millisInADay;
                      } else {
                        ++currIndex;
                        endMillis = schedule[currIndex].start;
                      }

                      duration += endMillis - schedule[prevIndex].start;
                    } while (duration < fiveDays && schedule[prevIndex].rate === schedule[currIndex].rate);

                    activeScheduled = {
                      type: 'basal',
                      deviceTime: actualTime,
                      deliveryType: 'scheduled',
                      scheduleName: scheduleNames[i],
                      value: e.value,
                      deviceId: settings.deviceId,
                      duration: duration
                    };
                    return outputObservable.onNext(activeScheduled);
                  }
                }
              }
            }

            // If the loop above didn't exit, then we have a temp basal.
            // We have to figure out when it completes, for this we store the temp aside
            // and emit it on the next event.  But, first, we must check if we have a temp already and emit it
            var emitted = emitTempIfExists(e.deviceTime);

            if (emitted && activeScheduled != null) {
              // If there was a temp, it's possible that we are returning to the previously scheduled
              // basal rate.  If that is the case, we do not want to actually emit this event, 'cause
              // the scheduled rate already has us covered
              var operatesUntil = activeScheduled.deviceTime.clone().add('ms', activeScheduled.duration);
              if (operatesUntil.isAfter(e.deviceTime) && e.value === activeScheduled.value) {
                return;
              }
            }

            tempBasal = misc.annotateEvent(
              _.assign({}, e, { deliveryType: 'temp' }),
              'diasend/temp-basal-fabrication'
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
                  duration: ((i+1 === sched.length) ? millisInADay : sched[i+1].start) - millisInTemp
                })
              );
              tempBasal = null;
            }
            outputObservable.onCompleted();
          }
        );
      });
  };
};