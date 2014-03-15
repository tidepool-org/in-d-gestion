/*
 * == BSD2 LICENSE ==
 */

var pre = require('amoeba').pre;
var rx = require('rx');

var csvToEvents = require('./csvToEvents.js');
var eventParser = require('./eventParser.js');
var misc = require('../misc.js');

exports.fetch = require('./fetch.js');

/**
 * Converts an observable sequence of Buffers taken from a diasend xls file into tidepool platform objects
 *
 * @param observable the observable sequence of Buffers
 * @returns an observable sequence of tidepool platform objects
 */
exports.fromXls = function (observable) {
  var config = {};

  return observable
      .apply(csvToEvents)
      .keep(function (e) {
              if (e.type === 'meta' && e.subType === 'dates') {
                config.startDate = e.start;
                config.endDate = e.end;
                return null;
              }
              return e;
            })
      .map(function (e) {
             if (e.type === 'settings' && e.deviceTime == null) {
               e.deviceTime = pre.hasProperty(config, 'endDate', 'Settings came before the meta dates object, wtf!?');
             }
             return e;
           })
      .map(misc.addDeviceTimeFn('Time', 'DD/MM/YYYY HH:mm'))
      .keep(eventParser);
};
