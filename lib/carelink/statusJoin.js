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

// Make sure rx stuff is registered
require('../rx');

var _ = require('lodash');
var except = require('amoeba').except;
var rx = require('rx');

module.exports = function(observable) {
  return observable
    .link(function(outputObs){
            var suspendEvents = [];

            return rx.Observer.create(
              function(e) {
                if (! (e.type === 'deviceMeta' && e.subType === 'status')) {
                  return outputObs.onNext(e);
                }

                switch (e.status) {
                  case 'suspended':
                    suspendEvents.push(e);
                    break;
                  case 'resume':
                    if (suspendEvents.length < 1) {
                      outputObs.onNext(e);
                      return;
                    }

                    if (e.joinKey == null) {
                      var wife = suspendEvents.shift();
                      outputObs.onNext(wife);
                      outputObs.onNext(_.assign({}, e, { joinKey: wife.id }));
                    } else {
                      for (var i = 0; i < suspendEvents.length; ++i) {
                        if (suspendEvents[i].id === e.joinKey) {
                          outputObs.onNext(suspendEvents.splice(i, 1)[0]);
                          outputObs.onNext(e);
                          return;
                        }
                      }
                      outputObs.onNext(e);
                    }
                    break;
                  default:
                    throw except.ISE('Unknown status[%s], ts[%s]', e.status, e.deviceTime);
                }


              },
              outputObs.onError.bind(outputObs),
              function() {
                suspendEvents.forEach(outputObs.onNext.bind(outputObs));
                outputObs.onCompleted();
              }
            );
          });
};