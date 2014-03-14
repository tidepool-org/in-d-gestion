var parsing = require('../parsing.js');

function extractBgUnits(selector) {
  return parsing.map(selector, function(e) { return e === 'mg dl' ? 'mg dL' : e; });
}

var extractionSpecs = {
  'BasalProfileStart': {
    type: 'basal-rate-change',
    deliveryType: 'scheduled',
    deviceTime: parsing.extract('deviceTime'),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME']),
    value: parsing.asNumber(['Raw-Values', 'RATE']),
    deviceId: parsing.extract('Raw-Device Type')
  },
  'BolusNormal': {
    type: 'bolus',
    subType: parsing.toLower('Bolus Type'),
    deviceTime: parsing.extract('deviceTime'),
    value: parsing.asNumber('Bolus Volume Delivered (U)'),
    programmed: parsing.asNumber('Bolus Volume Selected (U)'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type')
  },
  'BolusSquare': {
    type: 'bolus',
    subType: parsing.toLower('Bolus Type'),
    deviceTime: parsing.extract('deviceTime'),
    value: parsing.asNumber('Bolus Volume Delivered (U)'),
    programmed: parsing.asNumber('Bolus Volume Selected (U)'),
    duration: parsing.asNumber(['Raw-Values', 'DURATION']),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type')
  },
  'BolusWizardBolusEstimate': {
    type: 'wizard',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    payload: {
      estimate: parsing.asNumber('BWZ Estimate (U)'),
      targetLow: parsing.asNumber('BWZ Target Low BG (mg/dL)'),
      targetHigh: parsing.asNumber('BWZ Target High BG (mg/dL)'),
      carbRatio: parsing.asNumber('BWZ Carb Ratio (grams)'),
      insulinSensitivity: parsing.asNumber('BWZ Insulin Sensitivity (mg/dL)'),
      carbInput: parsing.asNumber(['Raw-Values', 'CARB_INPUT']),
      carbUnits: parsing.extract(['Raw-Values', 'CARB_UNITS']),
      bgInput: parsing.asNumber(['Raw-Values', 'BG_INPUT']),
      bgUnits: parsing.extract(['Raw-Values', 'BG_UNITS']),
      correctionEstimate: parsing.asNumber('BWZ Correction Estimate (U)'),
      foodEstimate: parsing.asNumber('BWZ Food Estimate (U)'),
      activeInsulin: parsing.asNumber('BWZ Active Insulin (U)')
    }
  },
  'CalBGForPH': {
    type: 'smbg',
    deviceTime: parsing.extract('deviceTime'),
    value: parsing.asNumber('Sensor Calibration BG (mg/dL)'),
    deviceId: parsing.extract('Raw-Device Type')
  },
  ChangeActiveBasalProfilePattern: {
    type: 'settingsPart',
    subType: 'activeSchedule',
    deviceTime: parsing.extract('deviceTime'),
    deviceId: parsing.extract('Raw-Device Type'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME']),
    previousSchedule: parsing.extract(['Raw-Values', 'OLD_PATTERN_NAME']),
    lifecycle: 'start'
  },
  ChangeBasalProfilePattern: {
    type: 'settingsPart',
    subType: 'basalScheduleConfig',
    phase: 'basalScheduleSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    lifecycle: 'start',
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'NUM_PROFILES']),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME'])
  },
  ChangeBasalProfile: {
    type: 'settingsPart',
    subtype: 'basalScheduleConfig',
    phase: 'basalSchedule',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'PROFILE_INDEX']),
    payload: {
      rate: parsing.asNumber(['Raw-Values', 'RATE']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  ChangeBasalProfilePatternPre: {
    type: 'settingsPart',
    subType: 'basalScheduleConfig',
    phase: 'basalScheduleSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    lifecycle: 'end',
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'NUM_PROFILES']),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME'])
  },
  ChangeBasalProfilePre: {
    type: 'settingsPart',
    subtype: 'basalScheduleConfig',
    phase: 'basalSchedule',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'PROFILE_INDEX']),
    payload: {
      rate: parsing.asNumber(['Raw-Values', 'RATE']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  ChangeBGTargetRangePattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'bgTargetSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE']),
    units: extractBgUnits(['Raw-Values', 'ORIGINAL_UNITS'])
  },
  ChangeBGTargetRange: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'bgTarget',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      low: parsing.asNumber(['Raw-Values', 'AMOUNT_LOW']),
      high: parsing.asNumber(['Raw-Values', 'AMOUNT_HIGH']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  ChangeBolusWizardSetupConfig: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'start',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    units: {
      carb: parsing.extract(['Raw-Values', 'CARB_UNITS']),
      bg: extractBgUnits(['Raw-Values', 'BG_UNITS'])
    }
  },
  ChangeBolusWizardSetup: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'complete',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    nextConfigId: parsing.extract(['Raw-Values', 'NEW_CONFIG_DATUM']),
    prevConfigId: parsing.extract(['Raw-Values', 'OLD_CONFIG_DATUM'])
  },
  ChangeCarbRatioPattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'carbSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE'])
  },
  ChangeCarbRatio: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'carbRatio',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      amount: parsing.asNumber(['Raw-Values', 'AMOUNT']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME']),
      units: parsing.extract(['Raw-Values', 'UNITS'])
    }
  },
  ChangeInsulinSensitivityPattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'insulinSensitivitySetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE']),
    units: extractBgUnits(['Raw-Values', 'ORIGINAL_UNITS'])
  },
  ChangeInsulinSensitivity: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'insulinSensitivity',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      amount: parsing.asNumber(['Raw-Values', 'AMOUNT']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  ChangeTempBasalPercent: {
    type: 'basal-rate-change',
    deliveryType: 'temp',
    deviceTime: parsing.extract('deviceTime'),
    deviceId: parsing.extract('Raw-Device Type'),
    percent: parsing.asNumber(['Raw-Values', 'PERCENT_OF_RATE']),
    duration: parsing.asNumber(['Raw-Values', 'DURATION'])
  },
  CurrentActiveBasalProfilePattern: {
    type: 'settingsPart',
    subType: 'activeSchedule',
    deviceTime: parsing.extract('deviceTime'),
    deviceId: parsing.extract('Raw-Device Type'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME']),
    lifecycle: 'end'
  },
  CurrentBasalProfilePattern: {
    type: 'settingsPart',
    subType: 'basalScheduleConfig',
    phase: 'basalScheduleSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'NUM_PROFILES']),
    scheduleName: parsing.extract(['Raw-Values', 'PATTERN_NAME']),
    lifecycle: 'end'
  },
  CurrentBasalProfile: {
    type: 'settingsPart',
    subtype: 'basalScheduleConfig',
    phase: 'basalSchedule',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'PROFILE_INDEX']),
    payload: {
      rate: parsing.asNumber(['Raw-Values', 'RATE']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  CurrentBGTargetRangePattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'bgTargetSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE']),
    units: extractBgUnits(['Raw-Values', 'ORIGINAL_UNITS'])
  },
  CurrentBGTargetRange: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'bgTarget',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      low: parsing.asNumber(['Raw-Values', 'AMOUNT_LOW']),
      high: parsing.asNumber(['Raw-Values', 'AMOUNT_HIGH']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  CurrentBolusWizardSetupStatus: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'start',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    units: {},
    lifecycle: 'end'
  },
  CurrentCarbRatioPattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'carbSetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE'])
  },
  CurrentCarbRatio: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'carbRatio',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      amount: parsing.asNumber(['Raw-Values', 'AMOUNT']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME']),
      units: parsing.extract(['Raw-Values', 'UNITS'])
    }
  },
  CurrentInsulinSensitivityPattern: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'insulinSensitivitySetup',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    eventId: parsing.extract('Raw-ID'),
    size: parsing.asNumber(['Raw-Values', 'SIZE']),
    units: extractBgUnits(['Raw-Values', 'ORIGINAL_UNITS'])
  },
  CurrentInsulinSensitivity: {
    type: 'settingsPart',
    subType: 'bolusWizardSetup',
    phase: 'insulinSensitivity',
    deviceTime: parsing.extract('deviceTime'),
    uploadId: parsing.extract('Raw-Upload ID'),
    uploadSeqNum: parsing.asNumber('Raw-Seq Num'),
    deviceId: parsing.extract('Raw-Device Type'),
    setupId: parsing.extract(['Raw-Values', 'PATTERN_DATUM']),
    index: parsing.asNumber(['Raw-Values', 'INDEX']),
    payload: {
      amount: parsing.asNumber(['Raw-Values', 'AMOUNT']),
      start: parsing.asNumber(['Raw-Values', 'START_TIME'])
    }
  },
  'GlucoseSensorData': {
    type: 'cbg',
    deviceTime: parsing.extract('deviceTime'),
    value: parsing.asNumber('Sensor Glucose (mg/dL)'),
    deviceId: parsing.extract('Raw-Device Type')
  }
};

var parserBuilder = parsing.parserBuilder();
Object.keys(extractionSpecs).forEach(function(type) {
  parserBuilder.whenFieldIs('Raw-Type', type).applyConversion(extractionSpecs[type])
});

module.exports = parserBuilder.build();

