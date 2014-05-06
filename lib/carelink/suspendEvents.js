/*
 * == BSD2 LICENSE ==
 */

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
    throw expect.IAE('Bad event type[%s]', e.type);
  }

  e = _.assign(e, convertStatus(e, 'status'));
  e.previousStatus = convertStatus(e, 'previousStatus').status;

  return e;
};