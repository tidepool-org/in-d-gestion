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

module.exports = function (observable) {
  return observable.link(
    function (outputObservable) {
      var currBasal = null;

      function withPrevious(next) {
        return _.assign({}, next, { previous: _.omit(currBasal, 'previous') });
      }

      function walkDownCurrBasal(e) {
        while (currBasal != null &&
               moment.utc(currBasal.deviceTime).valueOf() + currBasal.duration < moment.utc(e.deviceTime).valueOf()) {
          switch (currBasal.deliveryType) {
            case 'temp':
              if (currBasal.suppressed.duration == null) {
                currBasal = currBasal.suppressed.suppressed;
              } else {
                var oldTemp = currBasal;
                var endOfTemp = moment.utc(oldTemp.deviceTime).valueOf() + oldTemp.duration;
                currBasal = _.assign(
                  {},
                  currBasal.suppressed,
                  {
                    deviceTime: moment.utc(moment.utc(oldTemp.deviceTime).valueOf() + oldTemp.duration).format('YYYY-MM-DDTHH:mm:ss'),
                    duration: currBasal.suppressed.duration - (endOfTemp - moment.utc(currBasal.suppressed.deviceTime).valueOf()),
                    previous: _.omit(currBasal, 'previous')
                  }
                );
                outputObservable.onNext(currBasal);
              }
              break;
            case 'scheduled':
              currBasal = null;
              break;
          }
        }
      }

      return rx.Observer.create(
        function (e) {
          if (e.type !== 'basal') {
            outputObservable.onNext(e);
            return;
          }

          walkDownCurrBasal(e);

          if (currBasal == null) {
            if (!(e.deliveryType === 'temp' && e.duration === 0)) {  // Ignore 0 duration temps, they are "cancellations"
              currBasal = _.clone(e);
            }
          } else {
            var nextDur = null;
            switch (e.deliveryType) {
              case 'temp':
                if (e.duration === 0) {
                  if (currBasal.deliveryType === 'temp' && currBasal.suppressed != null) {
                    var nextBasal = currBasal.suppressed;
                    if (nextBasal.duration != null) {
                      nextDur = nextBasal.duration - (moment.utc(e.deviceTime).valueOf() - moment.utc(nextBasal.deviceTime).valueOf());
                    }

                    currBasal = withPrevious(
                      _.assign({}, nextBasal,
                               { deviceTime: e.deviceTime, time: e.time, timezoneOffset: e.timezoneOffset })
                    );

                    if (nextDur != null) {
                      currBasal.duration = nextDur;
                    }
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
                    if (currBasal.duration != null) {
                      nextDur = currBasal.duration - (eventTs - currTs);
                    }

                    currBasal = withPrevious(
                      _.assign(
                        {}, currBasal, _.pick(e, 'deviceTime', 'time', 'timezoneOffset'),
                        {suppressed: _.omit(e, 'previous')}
                      )
                    );

                    if (nextDur != null) {
                      currBasal.duration = nextDur;
                    }
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

          if (currBasal != null) {
            outputObservable.onNext(currBasal);
          }
        },
        outputObservable.onError.bind(outputObservable),
        function() {
          outputObservable.completed();
        }
      );
    }
  );
};