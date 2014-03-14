var _ = require('lodash');

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


function compareFn(lhs, rhs) {
  if (lhs < rhs) {
    return -1;
  } else if (lhs > rhs) {
    return 1;
  } else {
    return 0;
  }
}

/**
 * Builds a compare function for the `sort()` function.
 *
 * Takes an array of fieldExtractors, or functions that, when given an object, return a key for sorting.
 * The compare function will sort according to the values returned by the fieldExtractors in left-to-right
 * array order.
 *
 * @param fieldExtractors an array of functions that each return a key for sorting when given an object to sort
 * @returns {Function} a compare function suitable for use in `Array.sort()` style sorting functions
 */
exports.buildSortCompareFn = function(fieldExtractors) {
  return function (lhs, rhs) {
    var retVal = 0;
    for (var i = 0; i < fieldExtractors.length && retVal === 0; ++i) {
      retVal = compareFn(fieldExtractors[i](lhs), fieldExtractors[i](rhs));
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
};


