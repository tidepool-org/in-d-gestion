/*
 * == BSD2 LICENSE ==
 */

var _ = require('lodash');
var except = require('amoeba').except;
var rx = require('rx');

var misc = require('../misc.js');

var millisInADay = 24 * 60 * 60 * 1000;
var fiveMinutes = 5 * 60 * 1000;

module.exports = function(observable) {
  return observable
      .map(misc.assertSorted(['deviceTime']))
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

        var currSettings = null;
        var currSchedule = null;
        var expectedNext = null;
        var scheduleIndex = 0;
        var nextTime = null;

        function setExpectedNext() {
          var currTime = null;
          if (expectedNext == null) {
            currTime = currSettings.deviceTime.clone().startOf('day')
          } else {
            currTime = nextTime;
          }

          var currRate = currSchedule[scheduleIndex];
          var endOfRate = (scheduleIndex + 1 < currSchedule.length ? currSchedule[scheduleIndex + 1].start : millisInADay);
          expectedNext = {
            type: 'basal-rate-change',
            deviceTime: currTime,
            deliveryType: 'scheduled',
            scheduleName: currSettings.activeBasalSchedule,
            value: currRate.rate,
            deviceId: currSettings.deviceId,
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

        return rx.Observer.create(
            function(e) {
              if (e.type === 'settings') {
                if (currSettings == null) {
                  currSettings = e;
                  currSchedule = currSettings.basalSchedules[currSettings.activeBasalSchedule];
                  setExpectedNext();

                  return outputObservable.onNext(e);
                } else {
                  throw except.ISE('Cannot handle updating the settings event yet, please implement now.');
                }
              }

              if (e.type !== 'basal-rate-change') {
                return outputObservable.onNext(e);
              }

              if (matchesExpectedNext(e)) {
                outputObservable.onNext(expectedNext);
                setExpectedNext();
              } else {
                // It doesn't match, so therefore it is a temp basal!
                // We check if the timestamp is after our expected next
                var nextMillis = expectedNext.deviceTime.valueOf();
                var eventMillis = e.deviceTime.valueOf();
                while (nextMillis < eventMillis) {
                  // It is after our expected next, so generate events for all expectations until it is not.
                  outputObservable.onNext(expectedNext);
                  setExpectedNext();
                  nextMillis = expectedNext.deviceTime.valueOf();
                }

                // Emit the temp as if it runs until our expectation
                outputObservable.onNext(
                  misc.annotateEvent(
                    _.assign({}, e, { deliveryType: 'temp', duration: nextMillis - eventMillis}),
                    "diasend/temp-basal-fabrication"
                  )
                );
              }
            },
            outputObservable.onError.bind(outputObservable),
            function() {
              outputObservable.onCompleted();
            }
        )
      })
};