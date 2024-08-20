import * as utils from '../src/utils.js';
import MD5 from 'crypto-js/md5.js';
import { ajax } from '../src/ajax.js';
import { BANNER, NATIVE } from '../src/mediaTypes.js';
import { config } from '../src/config.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidderRequest} BidderRequest
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 * @typedef {import('../src/adapters/bidderFactory.js').ServerResponse} ServerResponse
 */

const BIDDER_CODE = 'freedomadnetwork';
const BASE_URL = 'https://srv.freedomadnetwork.com';

/**
 * Get user id from bid request. if no user id module used, return a new uuid.
 *
 * @param {BidRequest} bidRequest
 * @returns {String} userId
 */
function getUserId(bidRequest) {
  return generateUserId();
}

/**
 * Get browser language
 *
 * @returns {String} language
 */
function getLanguage() {
  const lang = (navigator.languages && navigator.languages[0]) ||
    navigator.language || navigator.userLanguage;
  return lang ? lang.split('-')[0] : 'en';
}

/**
 * Get device info
 *
 * @returns {Object}
 */
function getDevice() {
  const device = config.getConfig('device') || {};

  device.w = device.w || window.screen.width;
  device.h = device.h || window.screen.height;
  device.ua = device.ua || navigator.userAgent;
  device.language = device.language || getLanguage();
  device.dnt = typeof device.dnt === 'number'
    ? device.dnt : (utils.getDNT() ? 1 : 0);

  return device;
}

/**
 * Build OpenRTB request from bidRequest and bidderRequest
 *
 * @param {BidRequest} bid
 * @param {BidderRequest} bidderRequest
 * @returns {Request}
 */
function buildBidRequest(bid, bidderRequest) {
  const userId = getUserId(bid);

  const payload = {
    id: bid.bidId,
    tmax: bidderRequest.timeout,
    placements: [bid.params.placementId],
    test: config.getConfig('debug') ? 1 : 0,
    device: getDevice(),
    at: 2,
    user: {
      coppa: config.getConfig('coppa') ? 1 : 0,
    }
  }

  const gdprConsent = utils.deepAccess(bidderRequest, 'gdprConsent');
  if (!!gdprConsent && gdprConsent.gdprApplies) {
    payload.user.gdpr = 1;
    payload.user.consent = gdprConsent.consentString;
  }

  const uspConsent = utils.deepAccess(bidderRequest, 'uspConsent');
  if (uspConsent) {
    payload.user.usp = uspConsent;
  }

  return {
    method: 'POST',
    url: BASE_URL + '/pb/req',
    data: JSON.stringify(payload),
    options: {
      contentType: 'application/json',
      withCredentials: false,
      customHeaders: {
        'Accept-Language': 'en;q=10',
        'Authorization': 'Bearer ' + userId
      },
    },
    originalBidRequest: bid
  }
}

/**
 * Generate stable user id
 *
 * @returns {String} userId
 */
function generateUserId() {
  var hash = MD5(navigator.userAgent).toString();

  return hash;
}

export const spec = {
  code: BIDDER_CODE,
  isBidRequestValid: function(bid) {
    if (!bid) {
      utils.logWarn(BIDDER_CODE, 'Invalid bid', bid);

      return false;
    }

    if (!bid.params) {
      utils.logWarn(BIDDER_CODE, 'bid.params is required');

      return false;
    }

    if (!bid.params.placementId) {
      utils.logWarn(BIDDER_CODE, 'bid.params.placementId is required');

      return false;
    }

    var banner = utils.deepAccess(bid, 'mediaTypes.banner');
    if (banner === undefined) {
      return false;
    }

    return true;
  },

  buildRequests: function(validBidRequests, bidderRequest) {
    return validBidRequests.map(bid => buildBidRequest(bid, bidderRequest));
  },

  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {ServerResponse} serverResponse A successful response from the server.
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function (serverResponse, bidRequest) {
    const serverBody = serverResponse.body;
    let bidResponses = [];

    if (!serverBody) {
      return bidResponses;
    }

    serverBody.forEach((response) => {
      const bidResponse = {
        requestId: response.id,
        bidid: response.bidid,
        impid: response.impid,
        userId: response.userId,
        cpm: response.cpm,
        currency: response.currency,
        width: response.width,
        height: response.height,
        ad: response.payload,
        ttl: response.ttl,
        creativeId: response.crid,
        netRevenue: response.netRevenue,
        trackers: response.trackers,
        meta: {
          mediaType: response.mediaType,
          advertiserDomains: response.domains,
        }
      };

      bidResponses.push(bidResponse);
    });

    return bidResponses;
  },

  /**
   * Register bidder specific code, which will execute if a bid from this bidder won the auction
   *
   * @param {Bid} bid The bid that won the auction
   */
  onBidWon: function (bid) {
    if (!bid) {
      return;
    }

    const payload = {
      id: bid.bidid,
      impid: bid.impid,
      t: bid.cpm,
    }

    ajax(BASE_URL + '/pb/imp', null, JSON.stringify(payload), {
      method: 'POST',
      customHeaders: {
        'Accept-Language': 'en;q=10',
        'Authorization': 'Bearer ' + bid.userId
      },
    });

    if (bid.trackers && bid.trackers.length > 0) {
      for (var i = 0; i < bid.trackers.length; i++) {
        if (bid.trackers[i].type == 0) {
          utils.triggerPixel(bid.trackers[i].url);
        }
      }
    }
  },
  onSetTargeting: function(bid) {},
  onBidderError: function(error) {
    utils.logError(`${BIDDER_CODE} bidder error`, error);
  },
  getUserSyncs: function(syncOptions, serverResponses, gdprConsent, uspConsent) {
    const syncs = [];
    return syncs;
  },
  onTimeout: function(timeoutData) {},
  supportedMediaTypes: [BANNER, NATIVE]
}

registerBidder(spec);
