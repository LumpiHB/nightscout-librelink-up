"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFormattedMeasurements = exports.getLibreLinkUpConnection = exports.getGlucoseMeasurements = exports.login = void 0;
/**
 * Nightscout LibreLink Up Uploader/Sidecar
 * Script written in TypeScript that uploads CGM readings from LibreLink Up to Nightscout.
 *
 * SPDX-License-Identifier: MIT
 */
const llu_api_endpoints_1 = require("./constants/llu-api-endpoints");
const node_cron_1 = __importDefault(require("node-cron"));
const axios_1 = __importDefault(require("axios"));
const winston_1 = require("winston");
const helpers_1 = require("./helpers/helpers");
const { combine, timestamp, printf } = winston_1.format;
const logFormat = printf(({ level, message }) => {
    return `[${level}]: ${message}`;
});
const logger = (0, winston_1.createLogger)({
    format: combine(timestamp(), logFormat),
    transports: [
        new winston_1.transports.Console({ level: process.env.LOG_LEVEL || "info" }),
    ]
});
axios_1.default.interceptors.response.use(response => {
    return response;
}, error => {
    if (error.response) {
        logger.error(JSON.stringify(error.response.data));
    }
    else {
        logger.error(error.message);
    }
    return error;
});
const USER_AGENT = "FreeStyle LibreLink Up NightScout Uploader";
/**
 * LibreLink Up Credentials
 */
const LINK_UP_USERNAME = process.env.LINK_UP_USERNAME;
const LINK_UP_PASSWORD = process.env.LINK_UP_PASSWORD;
/**
 * LibreLink Up API Settings (Don't change this unless you know what you are doing)
 */
const LIBRE_LINK_UP_VERSION = "4.2.2";
const LIBRE_LINK_UP_PRODUCT = "llu.ios";
const LINK_UP_REGION = process.env.LINK_UP_REGION || "EU";
const LIBRE_LINK_UP_URL = getLibreLinkUpUrl(LINK_UP_REGION);
function getLibreLinkUpUrl(region) {
    if (llu_api_endpoints_1.LLU_API_ENDPOINTS.hasOwnProperty(region)) {
        return llu_api_endpoints_1.LLU_API_ENDPOINTS[region];
    }
    return llu_api_endpoints_1.LLU_API_ENDPOINTS.EU;
}
/**
 * NightScout API
 */
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL;
const NIGHTSCOUT_API_TOKEN = process.env.NIGHTSCOUT_API_TOKEN;
const NIGHTSCOUT_DISABLE_HTTPS = process.env.NIGHTSCOUT_DISABLE_HTTPS || false;
function getNightscoutUrl() {
    if (NIGHTSCOUT_DISABLE_HTTPS === "true") {
        return "http://" + NIGHTSCOUT_URL;
    }
    return "https://" + NIGHTSCOUT_URL;
}
/**
 * last known authTicket
 */
let authTicket = { duration: 0, expires: 0, token: "" };
const libreLinkUpHttpHeaders = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    "version": LIBRE_LINK_UP_VERSION,
    "product": LIBRE_LINK_UP_PRODUCT,
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Authorization": undefined
};
const nightScoutHttpHeaders = {
    "api-secret": NIGHTSCOUT_API_TOKEN,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
};
if (process.env.SINGLE_SHOT === "true") {
    main().then();
}
else {
    const schedule = "*/" + (process.env.LINK_UP_TIME_INTERVAL || 5) + " * * * *";
    logger.info("Starting cron schedule: " + schedule);
    node_cron_1.default.schedule(schedule, () => {
        main().then();
    }, {});
}
async function main() {
    if (!hasValidAuthentication()) {
        logger.info("renew token");
        deleteAuthTicket();
        const authTicket = await login();
        if (!authTicket) {
            deleteAuthTicket();
            return;
        }
        updateAuthTicket(authTicket);
    }
    const glucoseGraphData = await getGlucoseMeasurements();
    if (!glucoseGraphData) {
        return;
    }
    await uploadToNightScout(glucoseGraphData);
}
async function login() {
    try {
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/auth/login";
        const response = await axios_1.default.post(url, {
            email: LINK_UP_USERNAME,
            password: LINK_UP_PASSWORD,
        }, {
            headers: libreLinkUpHttpHeaders
        });
        try {
            logger.info("Logged in to LibreLink Up");
            return response.data.data.authTicket;
        }
        catch (err) {
            logger.error("Invalid authentication token. Please check your LibreLink Up credentials", err);
            return null;
        }
    }
    catch (error) {
        logger.error("Invalid credentials", error);
        return null;
    }
}
exports.login = login;
async function getGlucoseMeasurements() {
    try {
        const connectionId = await getLibreLinkUpConnection();
        if (!connectionId) {
            return null;
        }
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/connections/" + connectionId + "/graph";
        const response = await axios_1.default.get(url, {
            headers: getLluAuthHeaders()
        });
        return response.data.data;
    }
    catch (error) {
        logger.error("Error getting glucose measurements", error);
        deleteAuthTicket();
        return null;
    }
}
exports.getGlucoseMeasurements = getGlucoseMeasurements;
async function getLibreLinkUpConnection() {
    try {
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/connections";
        const response = await axios_1.default.get(url, {
            headers: getLluAuthHeaders()
        });
        const connectionData = response.data.data;
        if (connectionData.length === 0) {
            logger.error("No LibreLink Up connection found");
            return null;
        }
        if (connectionData.length === 1) {
            logger.info("Found 1 LibreLink Up connection.");
            logPickedUpConnection(connectionData[0]);
            return connectionData[0].patientId;
        }
        dumpConnectionData(connectionData);
        if (!process.env.LINK_UP_CONNECTION) {
            logger.warn("You did not specify a Patient-ID in the LINK_UP_CONNECTION environment variable.");
            logPickedUpConnection(connectionData[0]);
            return connectionData[0].patientId;
        }
        const connection = connectionData.filter(connectionEntry => connectionEntry.patientId === process.env.LINK_UP_CONNECTION)[0];
        if (!connection) {
            logger.error("The specified Patient-ID was not found.");
            return null;
        }
        logPickedUpConnection(connection);
        return connection.patientId;
    }
    catch (error) {
        logger.error("getting libreLinkUpConnection: ", error);
        deleteAuthTicket();
        return null;
    }
}
exports.getLibreLinkUpConnection = getLibreLinkUpConnection;
async function lastEntryDate() {
    const url = getNightscoutUrl() + "/api/v1/entries?count=1";
    const response = await axios_1.default.get(url, {
        headers: nightScoutHttpHeaders
    });
    if (!response.data || response.data.length === 0) {
        return null;
    }
    return new Date(response.data.pop().dateString);
}
async function createFormattedMeasurements(measurementData) {
    const formattedMeasurements = [];
    const glucoseMeasurement = measurementData.connection.glucoseMeasurement;
    const measurementDate = (0, helpers_1.getUtcDateFromString)(glucoseMeasurement.FactoryTimestamp);
    const lastEntry = await lastEntryDate();
    // Add the most recent measurement first
    if (lastEntry === null || measurementDate > lastEntry) {
        formattedMeasurements.push({
            "type": "sgv",
            "dateString": measurementDate.toISOString(),
            "date": measurementDate.getTime(),
            "direction": (0, helpers_1.mapTrendArrow)(glucoseMeasurement.TrendArrow),
            "sgv": glucoseMeasurement.ValueInMgPerDl
        });
    }
    measurementData.graphData.forEach((glucoseMeasurementHistoryEntry) => {
        const entryDate = (0, helpers_1.getUtcDateFromString)(glucoseMeasurementHistoryEntry.FactoryTimestamp);
        if (lastEntry === null || entryDate > lastEntry) {
            formattedMeasurements.push({
                "type": "sgv",
                "dateString": entryDate.toISOString(),
                "date": entryDate.getTime(),
                "sgv": glucoseMeasurementHistoryEntry.ValueInMgPerDl
            });
        }
    });
    return formattedMeasurements;
}
exports.createFormattedMeasurements = createFormattedMeasurements;
async function uploadToNightScout(measurementData) {
    const formattedMeasurements = await createFormattedMeasurements(measurementData);
    if (formattedMeasurements.length > 0) {
        logger.info("Trying to upload " + formattedMeasurements.length + " glucose measurement items to Nightscout");
        try {
            const url = getNightscoutUrl() + "/api/v1/entries";
            const response = await axios_1.default.post(url, formattedMeasurements, {
                headers: nightScoutHttpHeaders
            });
            if (response.status !== 200) {
                logger.error("Upload to NightScout failed ", response.statusText);
            }
            else {
                logger.info("Upload of " + formattedMeasurements.length + " measurements to Nightscout succeeded");
            }
        }
        catch (error) {
            logger.error("Upload to NightScout failed ", error);
        }
    }
    else {
        logger.info("No new measurements to upload");
    }
}
function dumpConnectionData(connectionData) {
    logger.debug("Found " + connectionData.length + " LibreLink Up connections:");
    connectionData.map((connectionEntry, index) => {
        logger.debug("[" + (index + 1) + "] " + connectionEntry.firstName + " " + connectionEntry.lastName + " (Patient-ID: " +
            connectionEntry.patientId + ")");
    });
}
function logPickedUpConnection(connection) {
    logger.info("-> The following connection will be used: " + connection.firstName + " " + connection.lastName + " (Patient-ID: " +
        connection.patientId + ")");
}
function getLluAuthHeaders() {
    const authenticatedHttpHeaders = libreLinkUpHttpHeaders;
    authenticatedHttpHeaders.Authorization = "Bearer " + getAuthenticationToken();
    logger.debug("authenticatedHttpHeaders: " + JSON.stringify(authenticatedHttpHeaders));
    return authenticatedHttpHeaders;
}
function deleteAuthTicket() {
    authTicket = { duration: 0, expires: 0, token: "" };
}
function updateAuthTicket(newAuthTicket) {
    authTicket = newAuthTicket;
}
function getAuthenticationToken() {
    if (authTicket.token) {
        return authTicket.token;
    }
    logger.warn("no authTicket.token");
    return null;
}
function hasValidAuthentication() {
    if (authTicket.expires !== undefined) {
        const currentDate = Math.round(new Date().getTime() / 1000);
        return currentDate < authTicket.expires;
    }
    logger.info("no authTicket.expires");
    return false;
}
