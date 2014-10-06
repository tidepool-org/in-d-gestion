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
        function processParts(parts) {
          var i;
          for (i = 1; i < parts.length; ++i) {
            var part = parts[i];
            if (misc.isAnnotated(part, 'carelink/basal/temp-percent-create-scheduled') || part.deliveryType === 'temp') {
              var endOfTemp = moment.utc(part.deviceTime).valueOf() + part.duration;
              var endDeviceTime = moment.utc(endOfTemp).format('YYYY-MM-DDTHH:mm:ss');
              if (endOfTemp < moment.utc(e.deviceTime).valueOf() &&
                  endDeviceTime < moment.utc(parts[0].deviceTime).add(parts[0].duration, 'ms').format('YYYY-MM-DDTHH:mm:ss')) {
                _.assign(
                  parts[0],
                  {
                    deviceTime: endDeviceTime,
                    duration: parts[0].duration - (endOfTemp - moment.utc(parts[0].deviceTime).valueOf()),
                    previous: _.omit(parts[0], 'previous')
                  }
                );
                ptr = parts[0];
                for (var j = 1; j < parts.length; ++j) {
                  if (j !== i) {
                    ptr.suppressed = parts[j];
                    ptr = ptr.suppressed;
                  }
                }
                currBasal = parts[0];
                outputObservable.onNext(currBasal);
                return false;
              }
            }
          }
          return true
        }

        while (currBasal != null) {
          var ptr = currBasal;
          var parts = [];
          while (ptr != null) {
            parts.push(_.omit(ptr, 'suppressed'));
            ptr = ptr.suppressed;
          }

          if (processParts(parts)) {
            if (moment.utc(currBasal.deviceTime).valueOf() + currBasal.duration < moment.utc(e.deviceTime).valueOf()) {
              switch (currBasal.deliveryType) {
                case 'suspend':
                case 'temp':
                  if (currBasal.suppressed != null && currBasal.suppressed.duration == null) {
                    currBasal = currBasal.suppressed.suppressed;
                  } else if (misc.isAnnotated(currBasal.suppressed, 'carelink/basal/temp-percent-create-scheduled') ||
                             (currBasal.suppressed != null && currBasal.suppressed.deliveryType === 'temp') ) {
                    var oldTemp = currBasal;
                    var endOfTemp = moment.utc(oldTemp.deviceTime).valueOf() + oldTemp.duration;
                    currBasal = _.assign(
                      {},
                      currBasal.suppressed,
                      {
                        deviceTime: moment.utc(endOfTemp).format('YYYY-MM-DDTHH:mm:ss'),
                        duration: currBasal.suppressed.duration - (endOfTemp - moment.utc(currBasal.suppressed.deviceTime).valueOf()),
                        previous: _.omit(currBasal, 'previous')
                      }
                    );
                    outputObservable.onNext(currBasal);
                  } else {
                    currBasal = null;
                  }
                  break;
                case 'scheduled':
                  currBasal = null;
                  break;
                default:
                  throw new Error('Unknown basal type[' + currBasal.deliveryType + ']');
              }
            } else {
              return;
            }
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

                    var replaceScheduledSuppressed = function(event) {
                      if (event.suppressed != null &&
                          (event.suppressed.deliveryType === 'temp' || event.suppressed.deliveryType === 'suspend')) {
                        return _.assign({}, event, {suppressed: replaceScheduledSuppressed(event.suppressed)});
                      } else {
                        return _.assign({}, event, {suppressed: _.omit(e, 'previous')});
                      }
                    };

                    currBasal = replaceScheduledSuppressed(
                      _.assign({}, currBasal, _.pick(e, 'deviceTime', 'time', 'timezoneOffset'))
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