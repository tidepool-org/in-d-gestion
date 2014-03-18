/*
 * == BSD2 LICENSE ==
 */

var pre = require('amoeba').pre;
var rx = require('rx');

var assignId = require('../assignId.js');
var eventParser = require('./eventParser.js');
var generateBasals = require('./generateBasals.js');
var misc = require('../misc.js');
var parsing = require('../parsing.js');
var xlsHandling = require('./xlsHandling.js');

exports.fetch = require('./fetch.js');

function basalOrSettingsType(e) {
  return e.type === 'basal-rate-change' || e.type === 'settings';
}

/**
 * Converts an observable sequence of Buffers taken from a diasend xls file into tidepool platform objects
 *
 * @param observable the observable sequence of Buffers
 * @returns an observable sequence of tidepool platform objects
 */
exports.fromXls = function (observable) {
  var config = {};

  var commonProcessing = observable
      .apply(xlsHandling.parseXls)
      .flatMap(function(xls){
                 config = xlsHandling.xlsToConfig(xls);
                 return xlsHandling.xlsToEvents(xls);
               })
      .map(function (e) {
             if (e.type === 'settings' && e.deviceTime == null) {
               e.deviceTime = pre.hasProperty(config, 'startDate', 'Settings came before the meta dates object, wtf!?');
             }
             return e;
           })
      .map(misc.addDeviceTimeFn('Time', 'DD/MM/YYYY HH:mm'))
      .keep(eventParser)
      .publish();

  var nonBasaly = rx.Observable.create(commonProcessing.subscribe.bind(commonProcessing))
      .filter(function(e) { return ! basalOrSettingsType(e); });

  var basaly = rx.Observable.create(commonProcessing.subscribe.bind(commonProcessing))
      .filter(basalOrSettingsType)
      .sort(misc.buildSortCompareFn(['deviceTime', { spec: 'type', order: 'desc' }]))
      .apply(generateBasals);

  commonProcessing.connect();

  return rx.Observable.merge(nonBasaly, basaly)
    .map(misc.convertDeviceTimeToStringFn)
    .map(function(e){
           e.deviceId = config.deviceId;
           return e;
         })
    .apply(assignId)
    .map(misc.addSourceFn('diasend'));
};
