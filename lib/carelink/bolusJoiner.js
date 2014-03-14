// Ensure rx extensions are loaded
require('../rx');

var crypto = require('crypto');

var _ = require('lodash');
var amoeba = require('amoeba');
var base32hex = amoeba.base32hex;
var except = amoeba.except;

var misc = require('./misc.js');

var EVENT_BUFFER_LIMIT = 100;
/*
 * Wraps a handler such that it will buffer up events when the main handler returns 'buffer'.
 *
 * This handler technically re-defines the semantics of the handlers, so it is important to note
 * that handlers in this file are written to a slightly different set of semantics than normal
 * selfJoin handlers.
 */
function handlerWithLimitedEventBuffer(handler) {
  var eventBuffer = [];
  return {
    handle: function (e) {
      var retVal = handler.handle(e);
      if (Array.isArray(retVal)) {
        return retVal.concat(eventBuffer);
      }

      if (retVal === 'buffer') {
        eventBuffer.push(e);
        if (eventBuffer.length > EVENT_BUFFER_LIMIT) {
          return handler.completed().concat(eventBuffer);
        }
      }
      return null;
    },
    completed: function () {
      return handler.completed().concat(eventBuffer);
    }
  };
}

/*
 * Wraps a handler such that it is not given events of different uploadIds
 */
function handlerOfSameUpload(handler) {
  var uploadId = null;
  return {
    handle: function (e) {
      if (uploadId != null && uploadId !== e.uploadId) {
        // New upload id, so the handler is done!
        return handler.completed().concat(e);
      }

      var retVal = handler.handle(e);
      if (retVal == null) {
        // The handler consumed the message, so record the uploadId
        uploadId = e.uploadId;
      }
      return retVal;
    },
    completed: function () {
      return handler.completed();
    }
  }
}

/*
 * Convenience method to wrap around handler functions.  Wraps their returned handlers with the
 * helper handlers defined above.
 */
function wrapHandler(handlerFn) {
  return function (event) {
    var retVal = handlerFn(event);
    if (retVal != null) {
      return handlerWithLimitedEventBuffer(
        handlerOfSameUpload(
          retVal
        )
      );
    }
    return null;
  }
}

function finalizeWithJoinKey(obj, joinKey) {
  if (joinKey == null) {
    var hasher = crypto.createHash('sha1');
    hasher.update(obj.uploadId);
    hasher.update(String(obj.uploadSeqNum));
    hasher.update(obj.deviceId);
    joinKey = base32hex.encodeBuffer(hasher.digest(), { paddingChar: '-' });
  }

  return _.assign({}, _.omit(obj, 'uploadId', 'uploadSeqNum'), { joinKey: joinKey });
}

/*
 * Handles a wizard object coming first.  Given our assumed sort order, a wizard coming first means that it is a
 * standalone object.
 */
function handleWizardFirst(event) {
  if (event.type !== 'wizard') {
    return null;
  }

  if (event.joinKey != null) {
    return null;
  }

  return {
    handle: function (e) {
      // First event will always be the one we started with, just return it as a stand-alone
      return [finalizeWithJoinKey(e)];
    },
    completed: function () {
      throw except.ISE("This should run because handle always handles the event immediately");
    }
  };
}

/*
 * If we get a single bolus (meaning "normal" or "square" subType), then we either correlate it with the next
 * wizard event, or just emit it when we get another bolus event.
 */
function handleSingleBolusFirst(event) {
  if (!(event.type === 'bolus' && (event.subType === 'normal' || event.subType === 'square'))) {
    return null;
  }

  if (event.joinKey != null) {
    return null;
  }

  var bolus = null;
  return {
    handle: function (e) {
      // First event will always be the one we started with, capture it.
      if (bolus == null) {
        bolus = e;
        return null;
      } else if (e.type === 'wizard') {
        var finalNormal = finalizeWithJoinKey(bolus);
        return [finalNormal, finalizeWithJoinKey(e, finalNormal.joinKey)];
      } else if (e.type === 'bolus') {
        return [finalizeWithJoinKey(bolus), e];
      } else {
        return 'buffer';
      }
    },
    completed: function () {
      return [finalizeWithJoinKey(bolus)];
    }
  };
}

/*
 * If we get a dual/square bolus first, then it is a dual-wave bolus with a 0 value dual/normal that we must fabricate.
 * The expected order is dual/square -> wizard.  We give up if we get another bolus event before a wizard
 */
function handleDualSquareFirst(event) {
  if (!(event.type === 'bolus' && event.subType === 'dual/square')) {
    return null;
  }

  if (event.joinKey != null) {
    return null;
  }

  var square = null;

  function finalize(e) {
    var finalSquare = finalizeWithJoinKey(square);
    var retVal = [
      _.assign({}, finalSquare, { subType: 'dual/normal', value: 0, programmed: 0 }),
      finalSquare
    ];

    if (e != null) {
      retVal.push(finalizeWithJoinKey(e, finalSquare.joinKey));
    }

    return retVal;
  }

  return {
    handle: function (e) {
      // First event will always be the one we started with, capture it.
      if (square == null) {
        square = e;
        return null;
      } else if (e.type === 'wizard') {
        return finalize(e);
      } else if (e.type === 'bolus') {
        return finalize().concat(e);
      } else {
        return 'buffer';
      }
    },
    completed: finalize
  };
}

/*
 * If we get a dual/normal first, then we have a dual-wave.
 * The order of a dual-wave is dual/normal -> dual/square -> wizard.  If we get a wizard first, we fabricate a
 * dual/square of value 0.  If we get a non dual/square bolus or another bolus type before the wizard, we give
 * up and correlate what we have so far.
 */
function handleDualNormalFirst(event) {
  if (!(event.type === 'bolus' && event.subType === 'dual/normal')) {
    return null;
  }

  if (event.joinKey != null) {
    return null;
  }

  var normal = null;
  var square = null;

  function finalize(e) {
    var finalNormal = finalizeWithJoinKey(normal);
    var retVal = [finalNormal];

    if (square != null) {
      retVal.push(finalizeWithJoinKey(square, finalNormal.joinKey));
    }
    if (e != null) {
      retVal.push(finalizeWithJoinKey(e, finalNormal.joinKey));
    }

    return retVal;
  }

  return {
    handle: function (e) {
      // First event will always be the one we started with, capture it.
      if (normal == null) {
        normal = e;
        return null;
      }

      // Haven't seen the square bolus yet.
      if (square == null) {
        if (e.type === 'bolus' && e.subType === 'dual/square') {
          square = e;
          return null;
        } else if (e.type === 'wizard') {
          square = _.assign({}, normal, { subType: 'dual/square', value: 0, programmed: 0 });
          // Don't return, fall through to next chunk
        } else if (e.type === 'bolus') {
          return finalize().concat(e);
        } else {
          return 'buffer';
        }
      }

      // We have both normal and square, so waiting on wizard
      if (e.type === 'wizard') {
        return finalize(e);
      } else if (e.type === 'bolus') {
        return finalize().concat(e);
      } else {
        return 'buffer';
      }
    },
    completed: finalize
  };
}

/*
 * This attempts to correlate bolus and bolus wizard events.  It's not an exact science, unfortunately.
 *
 * The various bolus events are not guaranteed to happen in any specific chronological order.  They do,
 * however, appear to happen in "sequence" order.  This means that if we assume that the data is
 * sorted in `(uploadId, uploadSeqNum)` order, then we will see the events in a semi-deterministic order
 *
 * Thus, we first ensure that we are looking at the data in the correct sort order and then do a selfJoin
 * on the stream.  The selfJoin has a number of handlers, each of them charged with handling the case that
 * a certain type of event is seen first.
 */
module.exports = function (obs) {
  return obs
    .apply(misc.assertSortedByUploadIdAndSeqNum(
      function (e) {
        return e.type === 'bolus' || e.type === 'wizard';
      }
    ))
    .selfJoin(
      [
        handleWizardFirst,
        handleSingleBolusFirst,
        handleDualSquareFirst,
        handleDualNormalFirst
      ].map(wrapHandler)
    );
};