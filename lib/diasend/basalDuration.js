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

module.exports = function(config){
  return function(observable) {
    return observable.link(
      function(outputObs) {
        var currBasal = null;

        return rx.Observer.create(
          function(e) {
            if (e.type !== 'basal') {
              outputObs.onNext(e);
              return;
            }

            if (currBasal == null) {
              currBasal = e;
              return;
            }

            var dur = e.deviceTime.valueOf() - currBasal.deviceTime.valueOf();
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
              // This means that `e` is going to get thrown away.  From the admittedly small amount of empirical
              // evidence we have gathered so far with diasend xls exports, this is the correct course of action.
              // If there is an example where the second event is the one that is supposed to be kept, then that
              // means that we cannot actually make a correct decision in this situation and should throw all basal
              // events with the same timestamp away.
              return;
            }

            outputObs.onNext(_.assign(currBasal, { duration: dur }));
            currBasal = e;
          },
          outputObs.onError.bind(outputObs),
          function() {
            if (currBasal != null) {
              var dur = config.endDate.valueOf() - currBasal.deviceTime.valueOf();
              if (dur > 0) {
                outputObs.onNext(_.assign(currBasal, { duration: dur }));
              }
            }
            outputObs.onCompleted();
          }
        );
      }
    );
  };
};