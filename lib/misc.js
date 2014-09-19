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
var moment = require('moment-timezone');

/**
 * Builds a function that can be applied to an observable to assert that messages
 * which meet the given predicate are ordered by uploadId -> seqNum
 *
 * @param predicateFn predicate to determine if the event is one that should be sorted
 * @returns {Function} a function that can be `apply()`d to an observable to assert the ordering
 */
exports.assertSortedByUploadIdAndSeqNum = function(predicateFn) {
  return function(obs) {
    var maxUploadId = '';
    var maxSeqNum = -1;

    return obs.map(function (e) {
      if (! predicateFn(e)) {
        return e;
      }

      if (e.uploadId == null || e.uploadSeqNum == null) {
        throw except.ISE(
          '%s message without uploadId[%s] or uploadSeqNum[%s]!? WTF',
          e.type, e.uploadId, e.uploadSeqNum
        );
      }

      if (e.uploadId > maxUploadId) {
        maxUploadId = e.uploadId;
        maxSeqNum = -1;
      }

      if (e.uploadId !== maxUploadId || e.uploadSeqNum <= maxSeqNum) {
        throw except.ISE(
          'Unsorted input. (uploadId,seqNum)[%s,%s] < [%s,%s]',
          e.uploadId, e.uploadSeqNum, maxUploadId, maxSeqNum
        );
      }

      maxSeqNum = e.uploadSeqNum;
      return e;
    });
  };
};

/**
 * Generates a function that can be passed to `map()` calls which asserts that the
 * the sequence of events is sorted.
 *
 * If it is not sorted, an exception is thrown.
 *
 * @param fields an array of field definitions as in `buildSortCompareFn()`
 * @param predFn a predicate function to determine if the event is a candidate for requiring the sort
 * @returns {Function} a function that can be `map()`d
 */
exports.assertSorted = function(fields, predFn) {
  if (predFn == null) {
    predFn = function(){ return true; };
  }

  var compareFn = exports.buildSortCompareFn(fields);

  var prev = null;
  return function(e) {
    if (! predFn(e)) {
      return e;
    }

    if (prev != null && compareFn(prev, e) > 0) {
      throw except.ISE(
          'Unsorted input, expected sort by[%s], prevTs[%s], currTs[%s]', fields, prev.deviceTime, e.deviceTime
      );
    }

    prev = e;
    return e;
  };
};


function compareFn(lhs, rhs) {
  if (lhs < rhs) {
    return -1;
  } else if (lhs > rhs) {
    return 1;
  } else {
    return 0;
  }
}

function convertFieldDefinition(defn) {
  if (Array.isArray(defn)) {
    return exports.buildSortCompareFn(defn);
  }

  switch (typeof (defn)) {
    case 'string':
      return function (lhs, rhs) {
        return compareFn(lhs[defn], rhs[defn]);
      };
    case 'object':
      var retVal = exports.buildSortCompareFn(defn.spec);
      if (defn.order === 'desc') {
        retVal = exports.invertSort(retVal);
      }
      return retVal;
    case 'function':
      return function (lhs, rhs) {
        return compareFn(defn(lhs), defn(rhs));
      };
    default:
      throw except.ISE('Unknown type[%s] for field definition', typeof(defn));
  }
}

/**
 * Builds a compare function for the `sort()` function.
 *
 * Takes an array of fieldDefinitions and builds a compare function that will sort according
 * to the values returned by the fieldDefinitions in left-to-right array order.
 *
 * fieldDefinitions can be
 *
 * * An array of objects that can also be field definitions
 * * An object with a `spec` field and an `order` field.
 * ** `spec` is something that can also be a field definition
 * ** `order` is `'desc'` for descending sort, anything else means ascending
 * * A string that will be interpreted as a field to extract out of the events for comparison
 * * A function that will be used to extract a value out of the events for comparison
 *
 * @param fieldDefinitions defined above
 * @returns {Function} a compare function suitable for use in `Array.sort()` style sorting functions
 */
exports.buildSortCompareFn = function(fieldDefinitions) {
  var compareFns = null;
  if (Array.isArray(fieldDefinitions)) {
    compareFns = fieldDefinitions.map(convertFieldDefinition);
  } else {
    compareFns = [convertFieldDefinition(fieldDefinitions)];
  }

  return function (lhs, rhs) {
    var retVal = 0;
    for (var i = 0; i < compareFns.length && retVal === 0; ++i) {
      retVal = compareFns[i](lhs, rhs);
    }
    return retVal;
  };
};

/**
 * Inverts a compare function
 *
 * @param compareFn A compare function suitable for use by `Array.sort()`
 * @returns {Function} A compare function that will sort in the reverse order when passed to `Array.sort()`
 */
exports.invertSort = function(compareFn) {
  return function(lhs, rhs) {
    return -compareFn(lhs, rhs);
  };
};

/**
 * Adds an annotation to an event.
 *
 * @param event the event
 * @param ann the opaque string code for the annotation to add, or the annotation object itself
 */
exports.annotateEvent = function(event, ann) {
  if (event.annotations == null) {
    event.annotations = [];
  }

  var annotation = typeof(ann) === 'string' ? { code: ann } : ann;
  var exists = false;
  for (var i = 0; i < event.annotations.length; ++i) {
    if (_.isEqual(event.annotations[i], annotation)) {
      exists = true;
      break;
    }
  }

  if (! exists) {
    event.annotations.push(annotation);
  }

  return event;
};

/**
 * Generates a function that can be passed to `map()` which attaches a moment object as the
 * deviceTime field on objects in the collection.
 *
 * If the event doesn't have a deviceTime yet, the time is pulled from the given
 * `fieldName` and parsed with the given `dateFormat`,
 *
 * If the event already has a deviceTime set and it is a string, it is assumed to be in timezone-less
 * ISO8601 format and parsed out
 *
 * @param fieldName field to extract the time from if deviceTime doesn't exist
 * @param dateFormat format to parse the time extracted from `fieldName` with
 * @returns {Function} a function that can be passed to `map()` calls
 */
exports.addDeviceTimeFn = function(fieldName, dateFormat){
  return function(e) {
    if (e.deviceTime == null) {
      e.deviceTime = moment.utc(e[fieldName], dateFormat);
    } else if (typeof e.deviceTime == 'string') {
      return _.assign({}, e, { deviceTime: moment.utc(e.deviceTime, 'YYYY-MM-DDTHH:mm:ss') });
    }
    return e;
  };
};

/**
 * A function that converts the moment object on the `deviceTime` field to a timezone-less string
 *
 * @param e event with a moment for the deviceTime field
 * @returns {*} event with the deviceTime field replaced with a timezone-less string
 */
exports.convertDeviceTimeToString = function(e) {
  return _.assign({}, e, { deviceTime: e.deviceTime.format('YYYY-MM-DDTHH:mm:ss') });
};


/**
 * A function that converts the String `deviceTime` field to UTC given a specific timezone.
 *
 * @param timezone the timezone to convert to UTC for
 * @returns a function that converts the `deviceTime` field for events passed into it.
 */
exports.deviceTimeToUtc = function(timezone) {
  function converterFn(e) {
    var deviceTime = e.deviceTime;
    if (typeof(deviceTime) !== 'string') {
      deviceTime = deviceTime.format('YYYY-MM-DDTHH:mm:ss');
    }

    e.time = moment.tz(deviceTime, 'YYYY-MM-DDTHH:mm:ss', timezone).toISOString();
    e.timezoneOffset = (moment.utc(deviceTime).valueOf() - moment.utc(e.time).valueOf()) / 60000;
    return e;
  }

  return function(e) {
    e = converterFn(e);
    if (e.previous != null) {
      e.previous = converterFn(e.previous);
    }
    return e;
  };
};

/**
 * Generates a function that can be passed to a call to `map()` which will assign the given `value` to
 * the given `field` on the objects in the collection.
 *
 * @param field field to assign
 * @param value value to assign
 * @returns {Function} function that can be `map()`d
 */
exports.attachFieldFn = function(field, value) {
  return function (e) {
    e[field] = value;
    return e;
  };
};

/**
 * Generates a function that can be passed to a call to `map()` which will remove the given `field`
 * from objects in the collection
 *
 * @param field field to assign
 * @returns {Function} function that can be `map()`d
 */
exports.removeFieldFn = function(field) {
  return function (e) {
    return _.omit(e, field);
  };
};

/**
 * Computes the number of milliseconds after midnight on the date specified.
 *
 * @param dateTime DateTime object to figure out millis from
 * @returns {number} number of millis in current day
 */
exports.computeMillisInCurrentDay = function(dateTime) {
  var millisInDay = dateTime.hour() * 60 * 60 * 1000;
  millisInDay += dateTime.minute() * 60 * 1000;
  millisInDay += dateTime.second() * 1000;
  millisInDay += dateTime.milliseconds();
  return millisInDay;
};



