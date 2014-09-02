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

module.exports = function (observable) {
  var currBasal = null;

  function withPrevious(next) {
    return _.assign({}, next, { previous: _.omit(currBasal, 'previous') });
  }

  return observable.keep(
    function (e) {
      if (e.type !== 'basal') {
        return e;
      }

      if (currBasal != null &&
          moment.utc(currBasal.deviceTime).valueOf() + currBasal.duration < moment.utc(e.deviceTime).valueOf()) {
        // The current event happens after the current basal stops, so the series is disjoint
        // This means that we throw away the current basal as it has run its course.
        currBasal = null;
      }

      if (currBasal == null) {
        if (! (e.deliveryType === 'temp' && e.duration === 0)) {  // Ignore 0 duration temps, they are "cancellations"
          currBasal = _.clone(e);
        }
      } else {
        switch (e.deliveryType) {
          case 'temp':
            if (e.duration === 0) {
              if (currBasal.deliveryType === 'temp' && currBasal.suppressed != null) {
                var nextBasal = currBasal.suppressed;
                currBasal = withPrevious(
                  _.assign(
                    {},
                    nextBasal,
                    {
                      deviceTime: e.deviceTime,
                      time: e.time,
                      timezoneOffset: e.timezoneOffset,
                      duration: nextBasal.duration - (moment.utc(e.deviceTime).valueOf() - moment.utc(nextBasal.deviceTime).valueOf())
                    }
                  )
                );
              } else {
                return null;
              }
            } else {
              e.suppressed = _.omit(currBasal, 'previous');
              currBasal = withPrevious(e);
            }
            break;
          case 'scheduled':
            if (currBasal.deliveryType === 'temp') {
              var currTs = moment.utc(currBasal.deviceTime).valueOf();
              var eventTs = moment.utc(e.deviceTime).valueOf();

              if (eventTs < currTs + currBasal.duration) { // The scheduled basal is overshadowed by the temp
                currBasal = withPrevious(
                  _.assign(
                    {},
                    currBasal,
                    _.pick(e, 'deviceTime', 'time', 'timezoneOffset'),
                    {
                      suppressed: _.omit(e, 'previous'),
                      duration: currBasal.duration - (eventTs - currTs)
                    }
                  )
                );
              } else {
                currBasal = withPrevious(e);
              }
            } else {
              currBasal = withPrevious(e);
            }
            break;
          default:
            throw except.ISE('Unknown deliveryType[%s]', e.deliveryType);
        }
      }

      return currBasal;
    }
  );
};