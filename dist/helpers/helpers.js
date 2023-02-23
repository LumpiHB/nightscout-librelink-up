"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUtcDateFromString = exports.mapTrendArrow = void 0;
/**
 * Helper Functions
 *
 * SPDX-License-Identifier: MIT
 */
const nightscout_trend_arrows_1 = require("../constants/nightscout-trend-arrows");
function mapTrendArrow(libreTrendArrowRaw) {
    switch (libreTrendArrowRaw) {
        case 1:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.singleDown;
        case 2:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.fortyFiveDown;
        case 3:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.flat;
        case 4:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.fortyFiveUp;
        case 5:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.singleUp;
        default:
            return nightscout_trend_arrows_1.NIGHTSCOUT_TREND_ARROWS.notComputable;
    }
}
exports.mapTrendArrow = mapTrendArrow;
function getUtcDateFromString(timeStamp) {
    const utcDate = new Date(timeStamp);
    utcDate.setTime(utcDate.getTime() - utcDate.getTimezoneOffset() * 60 * 1000);
    return utcDate;
}
exports.getUtcDateFromString = getUtcDateFromString;
