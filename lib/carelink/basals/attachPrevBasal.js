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

var misc = require('../../misc.js');

module.exports = function (observable) {
  return observable.link(
    function (outputObservable) {
      var currBasal = null;

      function withPrevious(next) {
        // If the next object happens after the previous one was totally and completely done, don't attach the previous
        // "totally and completely done" means the previous item's duration + 5 seconds
        if (moment.utc(currBasal.deviceTime).valueOf() + currBasal.duration + 5000 < moment.utc(next.deviceTime).valueOf()) {
          return next;
        }
        return _.assign({}, next, { previous: _.omit(currBasal, 'previous') });
      }

      function walkDownCurrBasal(e) {
        var theBasal = currBasal;
        while (theBasal != null &&
               moment.utc(theBasal.deviceTime).valueOf() + theBasal.duration < moment.utc(e.deviceTime).valueOf()) {
          switch (theBasal.deliveryType) {
            case 'suspend':
            case 'temp':
              if (theBasal.suppressed != null && theBasal.suppressed.duration == null) {
                theBasal = theBasal.suppressed.suppressed;
              } else if (misc.isAnnotated(theBasal.suppressed, 'carelink/basal/temp-percent-create-scheduled')
                || theBasal.suppressed.deliveryType === 'temp' ) {
                var oldTemp = theBasal;
                var endOfTemp = moment.utc(oldTemp.deviceTime).valueOf() + oldTemp.duration;
                theBasal = _.assign(
                  {},
                  theBasal.suppressed,
                  {
                    deviceTime: moment.utc(moment.utc(oldTemp.deviceTime).valueOf() + oldTemp.duration).format('YYYY-MM-DDTHH:mm:ss'),
                    duration: theBasal.suppressed.duration - (endOfTemp - moment.utc(theBasal.suppressed.deviceTime).valueOf()),
                    previous: _.omit(theBasal, 'previous')
                  }
                );
                outputObservable.onNext(theBasal);
                currBasal = theBasal;
              } else {
                theBasal = null;
              }
              break;
            case 'scheduled':
              theBasal = null;
              break;
            default:
              throw new Error('Unknown basal type[' + theBasal.deliveryType + ']');
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
            // Ignore 0 duration temps, they are "cancellations"
            if (!(e.deliveryType === 'temp' && e.duration === 0)) {
              currBasal = _.clone(e);
            }
          } else {
            var nextDur = null;
            switch (e.deliveryType) {
              case 'suspend':
              case 'temp':
                if (e.duration === 0) {
                  if (currBasal.deliveryType === 'temp') {
                    currBasal.duration = moment.utc(e.deviceTime).valueOf() - moment.utc(currBasal.deviceTime).valueOf();
                    return null;
                  } else {
                    return null;
                  }
                } else {
                  if (moment.utc(currBasal.deviceTime).valueOf() + currBasal.duration > moment.utc(e.deviceTime).valueOf()) {
                    e.suppressed = _.omit(currBasal, 'previous');
                  }
                  currBasal = withPrevious(e);
                }
                break;
              case 'scheduled':
                if (currBasal.deliveryType === 'temp' || currBasal.deliveryType === 'suspend') {
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