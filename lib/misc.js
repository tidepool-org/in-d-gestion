var _ = require('lodash');
var except = require('amoeba').except;
var moment = require('moment');

var parsing = require('./parsing.js');

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
        return e;
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
  }
};

exports.assertSorted = function(fields, predFn) {
  if (predFn == null) {
    predFn = function(){ return true; };
  }

  var compareFn = exports.buildSortCompareFn(fields.map(parsing.extract.bind(parsing)));

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
  }
}


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
 * Takes an array of fieldDefinitions, or functions that, when given an object, return a key for sorting.
 * The compare function will sort according to the values returned by the fieldDefinitions in left-to-right
 * array order.
 *
 * @param fieldDefinitions an array of functions that each return a key for sorting when given an object to sort
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
  }
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
  }
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

exports.addDeviceTimeFn = function(fieldName, dateFormat){
  return function(e) {
    if (e.deviceTime == null) {
      e.deviceTime = moment(e[fieldName], dateFormat);
    } else if (typeof e.deviceTime == 'string') {
      e.deviceTime = moment(e.deviceTime, 'YYYY-MM-DDTHH:mm:ss');
    }
    return e;
  }
};

exports.convertDeviceTimeToStringFn = function(e) {
  try {
    e.deviceTime = e.deviceTime.format('YYYY-MM-DDTHH:mm:ss');
  } catch (err) {
    console.log(e);
  }
  return e;
}


