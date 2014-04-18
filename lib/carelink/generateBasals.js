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
var rx = require('rx');

var misc = require('../misc.js');

var oneMinute = 60 * 1000;
var twentyFourHours = 24 * 60 * oneMinute;

/**
 * Generates basal event records given a "settings" object and subsequent "basal" events.
 *
 * The "settings" object must come as the first event and all subsequent events must be in order sorted
 * by `'deviceTime'`.
 *
 * This function passes through normal scheduled basals, potentially annotation them if they don't agree with the
 * current settings.  If a temp percent basal is active, it will also generate intermediate scheduled basal events
 * to accomodate for the fact that carelink doesn't generate them.
 *
 * @param observable The observable object to modify with basals
 * @returns {*|string} The modified observable object that includes basals
 */
module.exports = function (observable) {
  return observable
    .map(misc.assertSorted(['deviceTime']))
    .link(
    function (outputObservable) {
      function determineDuration(schedule, index) {
        if (index + 1 === schedule.length) {
          return twentyFourHours - schedule[index].start;
        } else {
          return schedule[index + 1].start - schedule[index].start;
        }
      }

      function emitSchedulesForTempIfExists(endTime) {
        if (tempBasal != null) {
          var tempMillisInDay = misc.computeMillisInCurrentDay(tempBasal.deviceTime);
          var schedule = settings.basalSchedules[settings.activeBasalSchedule];

          if (schedule == null || schedule.length === 0) {
            tempBasal = null;
            return;
          }

          var endOfTemp = tempBasal.deviceTime.clone().add('ms', tempBasal.duration);
          if (endTime.isBefore(endOfTemp)) {
            endOfTemp = endTime;
          }

          var i;
          for (i = 0; i < schedule.length; ++i) {
            if (schedule[i].start >= tempMillisInDay) {
              break;
            }
          }

          var prevMillis = tempMillisInDay;
          var currTime = tempBasal.deviceTime.clone();
          while (currTime.isBefore(endOfTemp)) {
            if (i === schedule.length) {
              currTime.add('ms', twentyFourHours - prevMillis);
              prevMillis = 0;
              i = 0;
            } else {
              currTime.add('ms', schedule[i].start - prevMillis);
              prevMillis = schedule[i].start;
            }

            if (currTime.isBefore(endOfTemp)) {
              outputObservable.onNext(
                misc.annotateEvent(
                  {
                    type: 'basal',
                    deviceTime: currTime.clone(),
                    deliveryType: 'scheduled',
                    scheduleName: settings.activeBasalSchedule,
                    value: schedule[i].rate,
                    deviceId: settings.deviceId,
                    duration: determineDuration(schedule, i)
                  },
                  'carelink/temp-percent-create-scheduled'
                )
              );
              ++i;
            } else {
              break;
            }
          }

          tempBasal = null;
        }
      }

      function doScheduled(e) {
        var millisInEvent = misc.computeMillisInCurrentDay(e.deviceTime);
        var schedule = settings.basalSchedules[e.scheduleName];

        if (schedule == null) {
          schedule = [];
        }

        for (var j = 0; j < schedule.length; ++j) {
          if (schedule[j].rate === e.value && millisInEvent === schedule[j].start) {
            return outputObservable.onNext(_.assign({}, e, { duration: determineDuration(schedule, j)}));
          }
        }
        return outputObservable.onNext(misc.annotateEvent(e, 'basal/off-schedule-rate'));
      }

      var settings = null;
      var tempBasal = null;
      return rx.Observer.create(
        function (e) {
          if (e.type === 'settings') {
            settings = e;
            return outputObservable.onNext(e);
          }

          // Let non basals flow through and if we don't have a settings yet, then we can't do much
          if (e.type !== 'basal' || settings == null) {
            return outputObservable.onNext(e);
          }

          emitSchedulesForTempIfExists(e.deviceTime);

          switch (e.deliveryType) {
            case 'scheduled':
              doScheduled(e);
              break;
            case 'temp':
              tempBasal = e;
              outputObservable.onNext(e);
              break;
            case 'temp-stop':
              tempBasal = null;
              outputObservable.onNext(e);
              break;
            default:
              throw except.IAE('Unknown deliveryType[%s], ts[%s]', e.deliveryType, e.deviceTime);
          }
        },
        outputObservable.onError.bind(outputObservable),
        function () {
          outputObservable.onCompleted();
        }
      );
    });
};