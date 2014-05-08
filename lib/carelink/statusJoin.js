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

var misc = require('../misc.js');

module.exports = function(observable) {
  return observable
    .map(misc.assertSorted('deviceTime'))
    .link(function(outputObs){
            var suspendEvent = null;

            return rx.Observer.create(
              function(e) {
                if (! (e.type === 'deviceMeta' && e.subType === 'status')) {
                  outputObs.onNext(e);
                  return;
                }

                switch (e.status) {
                  case 'suspended':
                    if (e.previousStatus == null || e.previousStatus === 'resumed') {
                      if (suspendEvent != null) {
                        outputObs.onNext(suspendEvent);
                      }
                      suspendEvent = e;
                    }
                    break;
                  case 'resumed':
                    if (! (e.previousStatus == null || e.previousStatus === 'suspended')) {
                      return;
                    }

                    if (suspendEvent == null) {
                      outputObs.onNext(e);
                      return;
                    }

                    if (e.joinKey == null) {
                      outputObs.onNext(suspendEvent);
                      outputObs.onNext(_.assign({}, e, { joinKey: suspendEvent.id }));
                      suspendEvent = null;
                    } else {
                      throw new except.ISE('Resume event with joinKey, code doesn\'t handle multiple passes.');
                    }
                    break;
                  default:
                    throw except.ISE('Unknown status[%s], ts[%s]', e.status, e.deviceTime);
                }


              },
              outputObs.onError.bind(outputObs),
              function() {
                if (suspendEvent != null) {
                  outputObs.onNext(suspendEvent);
                }
                outputObs.onCompleted();
              }
            );
          })
    .map(function(e) {
           return _.omit(e, 'previousStatus');
         });
};