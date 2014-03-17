/*
 * == BSD2 LICENSE ==
 */

var _ = require('lodash');
var except = require('amoeba').except;
var moment = require('moment');
var rx = require('rx');
var xlsjs = require('xlsjs');

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
    if (sheet['A2'].v !== 'Time') {
      throw except.ISE('Unknown xls format for "Name and glucose", Header not on row 5?');
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
      activeBasalSchedule: null,
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
          retVal.activeBasalSchedule = 'Program ' + getCell(sheet, row, 1);
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
            row = fillArray(schedule, row, function(rowNum) {
              return {
                rate: Number(getCell(sheet, rowNum, 2)),
                start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
              };
            });
            retVal.basalSchedules['Program ' + program] = schedule;

            row += 3; // skip current line, sum line and empty line
          }
          break;
        case 'I:C ratio settings':
          row = fillArray(retVal.carbRatio, row, function(rowNum) {
            return {
              amount: Number(getCell(sheet, rowNum, 2)),
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
          break;
        case 'ISF programs':
          row = fillArray(retVal.insulinSensitivity, row, function(rowNum) {
            return {
              amount: Number(getCell(sheet, rowNum, 2)),
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
          break;
        case 'BG target range settings':
          row = fillArray(retVal.bgTarget, row, function(rowNum){
            var target = Number(getCell(sheet, rowNum, 2));
            var range = Number(getCell(sheet, rowNum, 3).replace('+/- ', ''));

            return {
              low: target - range,
              high: target + range,
              start: moment.duration(getCell(sheet, rowNum, 1)).asMilliseconds()
            };
          });
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

    var dateRange = getCell(sheet, 3, 1);
    var dates = dateRange.split(' to ');
    return {
      startDate: moment(dates[0], 'DD/MM/YYYY').format('YYYY-MM-DDTHH:mm:ss'),
      endDate: moment(dates[1], 'DD/MM/YYYY').format('YYYY-MM-DDTHH:mm:ss')
    };
  },
  CGM: function(sheet) {
    return {};
  },
  'Insulin use and carbs': function(sheet) {
    return {};
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
  return _.assign.apply(_, [{}].concat(Object.keys(xls.Sheets).map(function(sheet){
    var handler = configSheetHandlers[sheet];
    if (handler == null) {
      throw except.ISE('Unknown xls sheet[%s]', sheet);
    }
    return handler(xls.Sheets[sheet]);
  })));
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
