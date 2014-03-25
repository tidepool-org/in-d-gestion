/*
 * == BSD2 LICENSE ==
 */

'use strict';
var dxcomParser;

var es = require('event-stream');
var moment = require('moment');

var columns = {
  NA_1: 0,
  NA_2: 1,
  GlucoseInternalTime_1: 2,
  GlucoseDisplayTime_1: 3,
  GlucoseValue_1: 4,
  MeterInternalTime_2: 5,
  MeterDisplayTime_2: 6,
  MeterGlucoseValue_2: 7
};

var DEXCOM_TIME = 'YYYY-MM-DD HH:mm:ss';
var OUTPUT_TIME = 'YYYY-MM-DDTHH:mm:ss';

function reformatISO (str) {
  var m = moment(str, DEXCOM_TIME);
  return m.format(OUTPUT_TIME);
}

function validTime (str) {
  return moment(str, OUTPUT_TIME).isValid( );
}

dxcomParser = function() {
  var responder, stream;

  stream = es.pipeline(es.split(), es.map(function(data, cb) {

    if(data){
      var sugarsInRow = splitBGRecords(data);

      sugarsInRow.forEach(function(sugar){
        var rec = {
          type: 'cbg',
          data: sugar
        };
        stream.emit('type', rec);
      });
    }
    return cb();
  }));

  responder = function(filter) {
    var tr;
    tr = es.through();
    stream.on('type', function(data) {
      if (data.type.match(filter)) {
        return tr.push(data.data);
      }
    });
    return es.pipeline(stream, tr);
  };

  return es.pipeline(responder('cbg'), es.map(parse), es.map(valid));
};

dxcomParser.desalinate = function( ) {
  return dxcomParser().desalinate( );
};

dxcomParser.sugars = function( ) {
  return dxcomParser().sugars( );
};

dxcomParser.cbg = function( ) {
  return dxcomParser().cbg( );
};

dxcomParser.columns = function() {
  return columns;
};

dxcomParser.splitBGRecords =function(rawData){
  return splitBGRecords(rawData);
};

dxcomParser.isValidCbg = function(cbg){
  return isValidCbg(cbg);
};

function parse (rawData, callback) {
  var entryValues, processedSugar;

  var stringReadingToNum = function(value) {
    if (rawData.value.match(/lo./i)) {
      return "39";
    }
    else if (rawData.value.match(/hi./i)) {
      return "401";
    }
  }

  if ((rawData.value.match(/lo./i)) || rawData.value.match(/hi./i)) {
    processedSugar = {
      value: stringReadingToNum(rawData.value),
      type: 'cbg',
      deviceTime: reformatISO(rawData.displayTime),
      special: rawData.value
    };
  }
  else {
    processedSugar = {
      value: rawData.value,
      type: 'cbg',
      deviceTime: reformatISO(rawData.displayTime)
    };
  }

  return callback(null, processedSugar);
}

function valid (data, next) {
  if (isValidCbg(data)) {
    return next(null, data);
  }
  next( );
}

function isValidCbg (cbg) {
  if (isNaN(parseInt(cbg.value))) {
    if (cbg.value.match(/lo./i) || cbg.value.match(/hi./i)) {
      return (cbg.type === 'cbg' && validTime(cbg.deviceTime));
    }
    else {
      return false;
    }
  }
  else {
    return (!isNaN(parseInt(cbg.value)) &&
            cbg.type === 'cbg' && validTime(cbg.deviceTime));
  }

};

var splitBGRecords = function(rawData){
  var records, entryValues, sugarOne, sugarTwo;

  entryValues = rawData.split('\t');
  sugarOne = {};

  sugarOne.value = entryValues[columns['GlucoseValue_1']];
  sugarOne.displayTime = entryValues[columns['GlucoseDisplayTime_1']];

  records = [sugarOne];
  return records;
};

module.exports = dxcomParser;

