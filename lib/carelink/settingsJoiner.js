/*
 * == BSD2 LICENSE ==
 */

// Make sure rx stuff is registered
require('../rx');

var util = require('util');

var _ = require('lodash');
var except = require('amoeba').except;
var rx = require('rx');

var misc = require('./misc.js');
var parsing = require('../parsing.js');

function bolusWizardSetupPredicate(setupType) {
  return function (e) {
    return e.type === 'settingsPart' && e.subType === 'bolusWizardSetup' && e.phase === setupType;
  };
}

/**
 * A listJoiner is a handler that understands how to combine the event-based representation of
 * an array of settings used by the medtronic pump.
 *
 * The predicate function defines the "starter" event that keys off the sequences of items in the array.
 * It then has an itemType which defines the "phase" of the events that form the elements of the array.
 *
 * It will generate an event with a type of "settingsPart", subType of `itemType` and a payload field
 * of the array of items it collected.
 *
 * @param setupPredicateFn predicate that defines the start of the array events
 * @param itemType `phase` value that all array element entries will have
 * @returns {Function} A handler function to be used in a selfJoin
 */
function makeListJoiner(setupPredicateFn, itemType) {
  return function (event) {
    if (!setupPredicateFn(event)) {
      return null;
    }

    var setup = null;
    var payload = [];
    return {
      handle: function (e) {
        // First event is always the one we started with
        if (setup == null) {
          setup = e;
          return null;
        }

        if (e.phase == null || e.phase !== itemType) {
          if (payload.length === setup.size) {
            // Done, emit stuff.
            return [
              _.assign(
                {},
                _.omit(setup, 'subType', 'phase', 'eventId', 'uploadId', 'uploadSeqNum', 'size'),
                { subType: itemType, payload: payload}
              ),
              e
            ];
          } else {
            throw except.ISE(
              'Expected %s event, got [%s,%s,%s], ts[%s]', itemType, e.type, e.subType, e.phase, e.deviceTime
            );
          }
        }

        if (e.setupId !== setup.eventId) {
          throw except.ISE('%s event for wrong setup[%s], expected[%s]', itemType, e.setupId, setup.eventId);
        }

        if (e.index !== payload.length) {
          throw except.ISE(
            '%s event out of order, index[%s], but [%s] stored, setupId[%s]',
            itemType, e.index, payload.length, e.setupId
          );
        }

        payload.push(e.payload);
        return null;
      },
      completed: function () {
        throw except.ISE('Incomplete %s event, ts[%s]', itemType, setup.deviceTime);
      }
    }
  }
}

function expectSettingsEvent(e) {
  if (e.type !== 'settingsPart') {
    throw except.ISE('Bad event[%s], expected a settingsPart event, ts[%s]', e.type, e.deviceTime);
  }
}

/**
 * Combines together the various chunks of bolus wizard settings objects into a bolus wizard settings
 * object.
 *
 * @param event an event
 * @returns {*} A handler that eventually returns a completed bolusWizardSettings object
 */
function wizardSettingsBuilder(event) {
  if (!(event.type === 'settingsPart' && event.subType === 'bolusWizardSetup' && event.phase === 'start')) {
    return null;
  }

  var currSettings = null;
  var expectedSubEvents = ['carbRatio', 'insulinSensitivity', 'bgTarget'];
  return {
    handle: function (e) {
      expectSettingsEvent(e);

      if (e.subType === 'bolusWizardSetup') {
        // First event
        currSettings = _.assign(
          _.omit(e, 'uploadId', 'uploadSeqNum', 'phase'),
          {
            type: 'settingsPart',
            subType: 'bolusWizard',
            units: {},
            payload: {}
          }
        );

        if (e.eventId != null) {
          // Attach the eventId if it exists so that the lifecycle annotator can do its thing
          currSettings.eventId = e.eventId;
        }

        return null;
      }

      if (currSettings.payload[e.subType] != null) {
        throw except.ISE('Attempt to override subType[%s], ts[%s]', e.subType, e.deviceTime);
      }

      if (e.subType === 'carbRatio') {
        currSettings.payload[e.subType] = e.payload.map(function(element){ return _.omit(element, 'units'); });
        if (e.payload.length > 0) {
          currSettings.units.carb = e.payload[0].units;
        }
      } else if (e.subType === 'insulinSensitivity') {
        currSettings.payload[e.subType] = e.payload;
        currSettings.units.bg = e.units;
      } else if (e.subType === 'bgTarget') {
        currSettings.payload[e.subType] = e.payload;
        currSettings.units.bg = e.units;
      } else {
        throw except.ISE('Unknown subType[%s], ts[%s]', e.subType, e.deviceTime);
      }

      expectedSubEvents = _.without(expectedSubEvents, e.subType);
      if (expectedSubEvents.length === 0) {
        return [currSettings];
      } else {
        return null;
      }
    },
    completed: function () {
      throw except.ISE('Incomplete schedule events, ts[%s].', currSettings.deviceTime);
    }
  }
}

/**
 * Combines together bolusWizardSettings events with a `(bolusWizardSetup, complete)` event
 * to determine the stage of lifecycle that bolusWizardSettings object represents.
 *
 * "Stage of lifecycle" is either
 *
 * * "start" meaning that the object represents the start of a period of time where these
 * settings were in effect
 * * "end" meaning that the object represents the end of a period of time where these
 * settings were in effect
 *
 * @param event an event
 * @returns {*} a handler that annotates bolusWizardSettings objects with their lifecycle
 */
function scheduleLifecycleAnnotator(event) {
  if (! (event.type === 'settingsPart' && event.subType === 'bolusWizard' && event.eventId != null)) {
    return null;
  }

  var settingsHolder = {};
  return {
    handle: function(e) {
      expectSettingsEvent(e);

      switch(e.subType) {
        case 'bolusWizard':
          settingsHolder[e.eventId] = _.omit(e, 'eventId');
          break;
        case 'bolusWizardSetup':
          settingsHolder[e.prevConfigId].lifecycle = 'end';
          settingsHolder[e.nextConfigId].lifecycle = 'start';
          return [settingsHolder[e.prevConfigId], settingsHolder[e.nextConfigId]];
          break;
        default:
          throw except.ISE('Unexpected settings object of subType[%s], ts[%s]', e.subType, e.deviceTime);
      }
    },
    completed: function() {
      throw except.ISE('Incomplete lifecycle annotator [%s]', Object.keys(settingsHolder));
    }
  };
}

var timestampComparator = misc.invertSort(
  misc.buildSortCompareFn([parsing.extract('deviceTime')])
);

function convertLifecycleToNumber(e) {
  if (e.type !== 'settingsPart') {
    return -1;
  }

  switch (e.lifecycle) {
    case 'start':
      return 0;
    case 'end':
      return 1;
    default:
      throw except.ISE('Unknown lifecycle[%s], ts[%s]', e.lifecycle, e.deviceTime);
  }
}

function timestampAndLifecycleComparator(lhs, rhs) {
  var retVal = timestampComparator(lhs, rhs);

  if (retVal === 0) {
    retVal = convertLifecycleToNumber(lhs) - convertLifecycleToNumber(rhs);
  }

  return retVal;
}

/**
 * Combines together intermediate "settingsPart" events to produce the initial full-fledged "settings"
 * event required by the tidepool API.
 *
 * Handled types are "activeSchedule", "bolusWizard", "basalSchedule"
 *
 * This expects to be dealing with "lifecycle": "end" events generated by the "CurrentXXXX" set of
 * events from Carelink.
 *
 * @returns {*} a Handler that will combine the first set of "CurrentXXXX" objects to create a "complete" settings object
 */
function makeFirstCompleteScheduleHandler(){
  var runOnce = false;
  return function(event) {
    if (event.type !== 'settingsPart') {
      return null;
    }

    if (runOnce) {
      return null;
    }
    runOnce = true;

    var commonFields = ['deviceTime', 'deviceId'];

    var currSettings = {
      type: 'settings',
      lifecycle: 'end'
    };
    function updateOrVerifyCommonFields(e) {
      for (var i = 0; i < commonFields.length; ++i) {
        var field = commonFields[i];
        if (currSettings[field] == null) {
          currSettings[field] = e[field];
        } else if (currSettings[field] !== e[field]) {
          throw except.ISE('Mismatched field[%s], [%s] !== [%s]', field, currSettings[field], e[field]);
        }
      }
      if (currSettings.deviceTime == null) {
        currSettings.deviceTime = e.deviceTime;
      } else if (currSettings.deviceTime !== e.deviceTime) {
        throw except.ISE('Mismatched timestamps[%s] !== [%s]', currSettings.deviceTime, e.deviceTime);
      }
    }

    function hasBasalSchedule() {
      return currSettings.activeBasalSchedule !== undefined;
    }

    function hasBolusWizardSettings() {
      return currSettings.carbRatio !== undefined;
    }

    function hasScheduleName(scheduleName) {
      if (currSettings.basalSchedules == null) {
        currSettings.basalSchedules = {};
      }

      return currSettings.basalSchedules[scheduleName] !== undefined;
    }

    function isCompleteSettingsObject() {
      return hasBasalSchedule()
        && hasBolusWizardSettings()
        && hasScheduleName('standard')
        && hasScheduleName('pattern a')
        && hasScheduleName('pattern b');
    }

    return {
      handle: function(e) {
        if (isCompleteSettingsObject()) {
          return [currSettings, e];
        }

        if (e.type !== 'settingsPart') {
          throw except.ISE('Unexpected event[%s] in between settings, ts[%s]', e.type, e.deviceTime);
        }

        if (e.lifecycle == null || e.lifecycle !== 'end') {
          throw except.ISE('Unexpected value for lifecycle[%s]', e.lifecycle);
        }

        switch (e.subType) {
          case 'activeSchedule':
            if (hasBasalSchedule()) {
              throw except.ISE('Got an activeSchedule event when one already existed.  ts[%s]', e.deviceTime);
            }

            updateOrVerifyCommonFields(e);
            currSettings.activeBasalSchedule = e.scheduleName;
            break;
          case 'bolusWizard':
            if (hasBolusWizardSettings()) {
              throw except.ISE('Got a bolusWizard event when one already existed.  ts[%s]', e.deviceTime);
            }

            updateOrVerifyCommonFields(e);
            _.assign(currSettings, e.payload);
            currSettings.units = e.units;
            break;
          case 'basalSchedule':
            if (hasScheduleName(e.scheduleName)) {
              throw except.ISE(
                'Got a basalSchedule event[%s] when one already existed.  ts[%s]', e.scheduleName, e.deviceTime
              );
            }

            updateOrVerifyCommonFields(e);
            currSettings.basalSchedules[e.scheduleName] = e.payload;
            break;
          default:
            throw except.ISE('Unknown subType[%s]', e.subType);
        }

        return null;
      },
      completed: function() {
        if (isCompleteSettingsObject()) {
          return [currSettings];
        }
        throw except.ISE('completed() called, but still aggregating a schedule. ts[%s]', currSettings.deviceTime);
      }
    };
  }
}

/**
 * Generates a function that "Marries" the settings objects.
 *
 * The algorithm is to grab the first one, and then as other settings objects come, apply them to the current state
 * and re-emit.  This is easy to say, but hard to implement and get "right".
 *
 * The test coverage for this code isn't as great as it should be.  It would be best to create unit tests
 * specific to this at the next time we have to deal with issues in this code.  I'm sorry to whoever
 * has to do that.
 *
 * @param configFn A function that, when executed, will return a configuration object
 * @returns {*} an observable with "married" settings objects
 */
function marrySettings(configFn) {
  return function(observable) {
    return observable.link(function(observer) {

      var currSettings = null;
      var emittedSomething = false;

      function err() {
        retVal.onError(new Error(util.format.apply(util, Array.prototype.slice.call(arguments, 0))));
        return false;
      }

      var settingsHandlers = {
        activeSchedule: {
          onLifecycleEnd: function(e) {
            if (currSettings.activeBasalSchedule == null) {
              currSettings.activeBasalSchedule = e.scheduleName;
            } else if (currSettings.activeBasalSchedule !== e.scheduleName) {
              return err(
                'basalSchedules don\'t match, [%s] !== [%s], ts[%s]',
                currSettings.activeBasalSchedule, e.scheduleName, e.deviceTime
              );
            }
          },
          onLifecycleStart: function(e) {
            if (currSettings.activeBasalSchedule !== e.scheduleName) {
              currSettings.activeBasalSchedule = null;
              this.onLifecycleEnd(e);
              misc.annotateEvent(currSettings, 'settings-mismatch/activeSchedule');
            }

            currSettings.deviceTime = e.deviceTime;
            var retVal = currSettings;

            currSettings = _.clone(retVal);
            currSettings.activeBasalSchedule = e.previousSchedule;
            return retVal;
          }
        },
        bolusWizard: {
          onLifecycleEnd: function(e) {
            currSettings.carbRatio = e.payload.carbRatio;
            currSettings.insulinSensitivity = e.payload.insulinSensitivity;
            currSettings.bgTarget = e.payload.bgTarget;
            currSettings.units = e.units;
          },
          onLifecycleStart: function(e) {
            if (! this.isUpToDate(e)) {
              this.onLifecycleEnd(e);
              misc.annotateEvent(currSettings, 'settings-mismatch/wizard');
            }
            currSettings.deviceTime = e.deviceTime;
            return currSettings;
          },
          isUpToDate: function(e) {
            return _.isEqual(currSettings.carbRatio, e.payload.carbRatio)
              && _.isEqual(currSettings.insulinSensitivity, e.payload.insulinSensitivity)
              && _.isEqual(currSettings.bgTarget, e.payload.bgTarget)
              && _.isEqual(currSettings.units, e.units);
          }
        },
        basalSchedule: {
          onLifecycleEnd: function(e) {
            currSettings.basalSchedules[e.scheduleName] = e.payload;
          },
          onLifecycleStart: function(e) {
            if (! _.isEqual(currSettings.basalSchedules[e.scheduleName], e.payload)) {
              this.onLifecycleEnd(e);
              misc.annotateEvent(currSettings, 'settings-mismatch/basal');
            }

            currSettings.deviceTime = e.deviceTime;
            var retVal = currSettings;

            currSettings = _.cloneDeep(retVal);
            currSettings.basalSchedules[e.scheduleName] = [];
            return retVal;
          }
        }
      };

      var retVal = rx.Observer.create(
        function(e){
          if (! (e.type === 'settings' || e.type === 'settingsPart') ) {
            observer.onNext(e);
            return;
          }

          if (e.type === 'settings') {
            if (currSettings == null && e.lifecycle === 'end') {
              currSettings = e;
              return;
            } else {
              err('Unexpected \'settings\' events in stream, ts[%s], lifecycle[%s]', e.deviceTime, e.lifecycle);
              return;
            }
          }

          if (! (e.lifecycle === 'start' || e.lifecycle === 'end') ) {
            err('Unexpected lifecycle[%s], type[%s], subType[%s], ts[%s]', e.lifecycle, e.type, e.subType, e.deviceTime);
            return;
          }

          var handler = settingsHandlers[e.subType];
          if (handler == null) {
            err('Unknown subType[%s] in stream, type[%s], ts[%s]', e.subType, e.type, e.deviceTime);
            return;
          }

          if (e.lifecycle === 'end') {
            handler.onLifecycleEnd(e);
          } else {
            var toEmit = handler.onLifecycleStart(e);
            if (toEmit != null) {
              emittedSomething = true;
              observer.onNext(_.omit(toEmit, 'lifecycle'));
            }
          }
        },
        function(error) {
          observer.onError(error);
        },
        function() {
          var config = configFn();
          if (! emittedSomething) {
            // If we have gone through all of the data and we never emitted something, that means that the
            // settings never changed throughout the entire data stream.  In this case, we need to take the
            // currSettings, which are derived from the settings at the time of upload, attach a timestamp
            // of the earliest message we have seen and call that our settings.
            //
            // If, on the other hand, we did emit an event while processing, then it is actually impossible
            // for us to know with 100% accuracy what the schedule was before that event, so we do not
            // attempt to even guess.
            observer.onNext(_.assign({}, _.omit(currSettings, 'lifecycle'), {deviceTime: config.startTime}));
          }
          observer.completed();
        }
      );

      return retVal;
    });
  }
}

/**
 * Generating full-fledged settings objects is a tricky proposition.
 *
 * Carelink provides data in individual events.  When settings are changed, the changes get dumped out as
 * events.  We need to combine those events together into more complex "basal schedule" and "bolus wizard
 * settings" objects.
 *
 * Some of these objects are created at the "end" of the effectiveness of the setting and other events
 * are created at the "start" of the effectiveness.  We need to keep track of this semantic difference
 * in order to build up as good of an indication of the actual schedule as possible.  That is, there are
 * times where we only get the "end" event and we want to interpolate those settings as far back as
 * possible.  So, we annotate all of these events with a "lifecycle" field indicating the semantics of
 * what it represents.
 *
 * Once we have all the events aggregated up into their complex object counterparts, and we have it all
 * annotated for its lifecycle semantics, we then re-sort those datums according to their timestamp
 * and start walking them backwards in order to combine all of the data together into full-fledged
 * "settingsPart" objects.
 *
 * @param configFn A function that, when executed, will return a configuration object
 * @returns {Function} A function that modifies an Observable such that it will join together settingsPart events
 * into full settings events.
 */
module.exports = function(configFn) {
  return function (obs) {
    return obs.apply(misc.assertSortedByUploadIdAndSeqNum(
        function(e) {
          return e.type === 'settingsPart';
        }
      )).selfJoin(
        [
          makeListJoiner(bolusWizardSetupPredicate('carbSetup'), 'carbRatio'),
          makeListJoiner(bolusWizardSetupPredicate('insulinSensitivitySetup'), 'insulinSensitivity'),
          makeListJoiner(bolusWizardSetupPredicate('bgTargetSetup'), 'bgTarget')
        ]
      )
      .selfJoin(wizardSettingsBuilder)
      .selfJoin(scheduleLifecycleAnnotator)
      .selfJoin(makeListJoiner(
        function (e) {
          return e.type === 'settingsPart' && e.subType === 'basalScheduleConfig' && e.phase === 'basalScheduleSetup'
        },
        'basalSchedule'
      ))
      // re-sort by timestamp decreasing in order to walk the settings backwards
      .sort(timestampAndLifecycleComparator)
      // Multiple devices can exist in the same stream, so we need to fork them off dynamically to individual
      // Observable flows.
      .link(
      function(observer) {
        var perDeviceFlow = {};

        function buildNewFlow(deviceName) {
          deviceFlow = new rx.Subject();

          deviceFlow
            .selfJoin(makeFirstCompleteScheduleHandler())
            .apply(marrySettings(configFn))
            .subscribe(function (e){
                         observer.onNext(e);
                       },
                       function(err) {
                         retVal.onError(err);
                       },
                       function(){
                         delete perDeviceFlow[deviceName];
                         if (_.isEmpty(perDeviceFlow)) {
                           observer.onCompleted();
                         }
                       });

          return deviceFlow;
        }

        var retVal = rx.Observer.create(
          function(e) {
            if (e.type !== 'settingsPart') {
              return observer.onNext(e);
            }

            var deviceFlow = perDeviceFlow[e.deviceId];
            if (deviceFlow == null) {
              deviceFlow = buildNewFlow(e.deviceId);
              perDeviceFlow[e.deviceId] = deviceFlow;
            }

            deviceFlow.onNext(e);
          },
          function(err) {
            observer.onError(err);
          },
          function() {
            Object.keys(perDeviceFlow).forEach(function(device){
              perDeviceFlow[device].onCompleted();
            });
          }
        );

        return retVal;
      });
  };
};