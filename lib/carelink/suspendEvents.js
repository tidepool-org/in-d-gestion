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

function convertStatus(e, field) {
  switch(e[field]) {
    case null:
    case 'null':
      return { status: null };
    case 'user_suspend':
      return { status: 'suspended', reason: 'manual' };
    case 'low_suspend_mode_1':
      return { status: 'suspended', reason: 'low_glucose' };
    case 'alarm_suspend':
    case 'low_suspend_no_response':
      return { status: 'suspended', reason: 'alarm' };
    case 'low_suspend_user_selected':
      return { status: 'suspended', reason: 'unknown' };

    // resume events
    case 'normal_pumping':
      return { status: 'resumed', reason: 'manual' };
    case 'user_restart_basal':
      return { status: 'resumed', reason: 'user_override' };
    case 'auto_resume_complete':
    case 'auto_resume_reduced':
      return { status: 'resumed', reason: 'automatic' };

    default:
      throw except.IAE('Unknown status[%s] on field[%s], ts[%s]', e[field], field, e.deviceTime);
  }
}

module.exports = function(e) {
  if (e.type !== 'deviceMeta') {
    throw except.IAE('Bad event type[%s]', e.type);
  }

  e = _.assign(e, convertStatus(e, 'status'));
  e.previousStatus = convertStatus(e, 'previousStatus').status;

  return e;
};