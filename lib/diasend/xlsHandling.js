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
var xlsjs = require('xlsjs');

/* jshint -W069 */

function getCell(sheet, row, col) {
  var cell = sheet[xlsjs.utils.encode_cell({ r: row, c: col })];
  if (cell == null) {
    return null;
  }
  return cell.v;
}

var sheetHandlers = {
  'Name and glucose': function(sheet, observer) {
    if (getCell(sheet, 4, 0) !== 'Time') {
      throw except.ISE('Unknown xls format for "Name and glucose", Header not on row 5?');
    }

    // Extract the units out of the header row and replace it with a better header
    var units = sheet['B5'].v;
    sheet['B5'].v = 'value';

    // Now, adjust the "range" of the sheet so that we can use the util library to make pretty objects for us
    var range = xlsjs.utils.decode_range(sheet['!ref']);
    range.s.r = 4; // 4 is the magic row where we believe we will find the header
    sheet['!ref'] = xlsjs.utils.encode_range(range);

    xlsjs.utils.sheet_to_row_object_array(sheet).forEach(function(e){
      e.units = units;
      e.sheetName = 'Name and glucose';
      observer.onNext(e);
    });
  },
  CGM: function(sheet, observer) {
    if (getCell(sheet, 1, 0) !== 'Time') {
      throw except.ISE('Unknown xls format for "Name and glucose", Header not on row 1?');
    }

    // Extract the units out of the header row and replace it with a better header
    var units = sheet['B2'].v;
    sheet['B2'].v = 'value';

    // Now, adjust the "range" of the sheet so that we can use the util library to make pretty objects for us
    var range = xlsjs.utils.decode_range(sheet['!ref']);
    range.s.r = 1; // 1 is the magic row where we believe we will find the header
    sheet['!ref'] = xlsjs.utils.encode_range(range);

    xlsjs.utils.sheet_to_row_object_array(sheet).forEach(function(e){
      e.units = units;
      e.sheetName = 'CGM';
      observer.onNext(e);
    });
  },
  'Insulin use and carbs': function(sheet, observer) {
    xlsjs.utils.sheet_to_row_object_array(sheet).forEach(function(e){
      e.sheetName = 'Insulin use and carbs';
      observer.onNext(e);
    });
  },
  'Insulin pump settings': function(sheet, observer) {
    var retVal = {
      type: 'settings',
      deviceTime: null,
      activeSchedule: null,
      units: {},
      basalSchedules: {},
      carbRatio: [],
      insulinSensitivity: [],
      bgTarget: [],
      deviceId: ''
    };

    function fillArray(array, rowNum, getEntryFn) {
      var row = rowNum;
      row += 2; // point to line after header
      while (getCell(sheet, row, 0) != null) {
        var entry = getEntryFn(row);
        array.push(entry);

        var interval = Number(getCell(sheet, row, 0));
        if (array[interval - 1] !== entry) {
          throw except.ISE('Expected row[%s] to be array entry[%s], but it wasn\'t!', row, interval);
        }
        ++row;
      }
      return row;
    }

    for (var row = 0; row < sheet['!range'].e.r; ++row) {
      var cell = getCell(sheet, row, 0);
      switch(cell) {
        case 'Insulin pump settings for Serial number:':
          retVal.deviceId = getCell(sheet, row, 1);
          break;
        case 'Active basal program':
          retVal.activeSchedule = 'Program ' + getCell(sheet, row, 1);
          break;
        case 'BG unit':
          var bgUnits = getCell(sheet, row, 1);
          switch (bgUnits) {
            case 'mmol/l': retVal.units.bg = 'mmol/L'; break;
            case 'mg/dl': retVal.units.bg = 'mg/dL'; break;
            default: retVal.units.bg = bgUnits;
          }
          break;
        case 'Basal profiles':
          ++row;

          for (var program = 1; program <= 4; ++program) {
            if (getCell(sheet, row, 0) !== 'Program: ' + program) {
              throw except.ISE('Unexpected value[%s] on row[%s]', getCell(sheet, row, 0), row);
            }

            var schedule = [];
            /* jshint -W083 */
            row = fillArray(schedule, row, function(rowNum) {
              return {
                rate: Number(getCell(sheet, rowNum, 2)),
                start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
              };
            });
            /* jshint +W083 */
            if (schedule.length === 1 && schedule[0].rate === 0 && schedule[0].start === 0) {
              // Empty schedule if it's just a single entry with 0s
              schedule = [];
            }

            retVal.basalSchedules['Program ' + program] = schedule;

            row += 3; // skip current line, sum line and empty line
          }
          break;
        case 'I:C ratio settings':
          /* jshint -W083 */
          row = fillArray(retVal.carbRatio, row, function(rowNum) {
            return {
              amount: Number(getCell(sheet, rowNum, 2)),
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
          /* jshint +W083 */
          break;
        case 'ISF programs':
          /* jshint -W083 */
          row = fillArray(retVal.insulinSensitivity, row, function(rowNum) {
            return {
              amount: Number(getCell(sheet, rowNum, 2)),
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
          /* jshint +W083 */
          break;
        case 'BG target range settings':
          /* jshint -W083 */
          row = fillArray(retVal.bgTarget, row, function(rowNum){
            var target = Number(getCell(sheet, rowNum, 2));
            var range = Number(getCell(sheet, rowNum, 3).replace('+/- ', ''));

            return {
              low: target - range,
              high: target + range,
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
        /* jshint +W083 */
      }
    }

    observer.onNext(retVal);
  }
};

var configSheetHandlers = {
  'Name and glucose': function(sheet) {
    if (getCell(sheet, 4, 0) !== 'Time') {
      throw except.ISE('Unknown xls format for "Name and glucose", Header not on the 5th row?');
    }

    // Figure out the range of the sheet so that we can extract the first and last timestamp
    var range = xlsjs.utils.decode_range(sheet['!ref']);
    return {
      startDate: moment.utc(getCell(sheet, 5, 0), 'DD/MM/YYYY HH:mm'),
      endDate: moment.utc(getCell(sheet, range.e.r, 0), 'DD/MM/YYYY HH:mm')
    };
  },
  CGM: function(sheet) {
    if (getCell(sheet, 1, 0) !== 'Time') {
      throw except.ISE('Unknown xls format for "Name and glucose", Header not on row 1?');
    }

    // Figure out the range of the sheet so that we can extract the first and last timestamp
    var range = xlsjs.utils.decode_range(sheet['!ref']);
    return {
      startDate: moment.utc(getCell(sheet, 2, 0), 'DD/MM/YYYY HH:mm'),
      endDate: moment.utc(getCell(sheet, range.e.r, 0), 'DD/MM/YYYY HH:mm')
    };
  },
  'Insulin use and carbs': function(sheet) {
    // Figure out the range of the sheet so that we can extract the first and last timestamp
    var range = xlsjs.utils.decode_range(sheet['!ref']);
    return {
      startDate: moment.utc(getCell(sheet, 1, 0), 'DD/MM/YYYY HH:mm'),
      endDate: moment.utc(getCell(sheet, range.e.r, 0), 'DD/MM/YYYY HH:mm')
    };
  },
  'Insulin pump settings': function(sheet) {
    if (getCell(sheet, 0, 0) !== 'Insulin pump settings for Serial number:') {
      throw except.ISE('Bad format for sheet "Insulin pump settings", should have SN on 1st row.');
    }
    return {
      deviceId: getCell(sheet, 0, 1)
    };
  }
};

/**
 * Converts an observable sequence of Buffers into an xls file
 *
 * @param observable the observable sequence of Buffers
 * @returns a disposable that can unsubscribe from the sequence of buffers
 */
exports.parseXls = function (observable) {
  return observable
      .toArray()
      .map(
          function(arrayOfBuffers) {
            return xlsjs.read(Buffer.concat(arrayOfBuffers), {type: 'none'});
          }
      );
};

/**
 * Converts a diasend xls file into a configuration object with information about the xls.
 *
 * @param xls the diasend xls file
 * @returns an observable sequence of tidepool platform objects
 */
exports.xlsToConfig = function (xls) {
  var objs = Object.keys(xls.Sheets).map(function(sheet){
    var handler = configSheetHandlers[sheet];
    if (handler == null) {
      throw except.ISE('Unknown xls sheet[%s]', sheet);
    }
    return handler(xls.Sheets[sheet]);
  });

  var retVal = {};
  for (var i = 0; i < objs.length; ++i) {
    if (objs[i].startDate != null && retVal.startDate != null) {
      retVal.startDate = retVal.startDate.isBefore(objs[i].startDate) ? retVal.startDate : objs[i].startDate;
      delete objs[i].startDate;
    }

    if (objs[i].endDate != null && retVal.endDate != null) {
      retVal.endDate = retVal.endDate.isAfter(objs[i].endDate) ? retVal.endDate : objs[i].endDate;
      delete objs[i].endDate;
    }

    retVal = _.assign(retVal, objs[i]);
  }
  return retVal;
};


/**
 * Converts a diasend xls file into Javascript objects.
 *
 * @param xls the diasend xls file
 * @returns an observable sequence of tidepool platform objects
 */
exports.xlsToEvents = function (xls) {
  return rx.Observable.create(
      function (outputObserver) {
        try {
          Object.keys(xls.Sheets).forEach(function(sheet){
            var handler = sheetHandlers[sheet];
            if (handler == null) {
              throw except.ISE('Unknown xls sheet[%s]', sheet);
            }
            handler(xls.Sheets[sheet], outputObserver);
          });
          outputObserver.onCompleted();
        }
        catch (ex) {
          outputObserver.onError(ex);
        }
      }
  );
};
