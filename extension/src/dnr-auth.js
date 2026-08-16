// dnr-auth.js - declarativeNetRequest-based cookie auth injection
//
// Root cause: Chrome enforces the Fetch API "forbidden header name" list.
// The "Cookie" header is forbidden — manually setting it via fetch() is silently
// stripped, causing all authenticated API calls to fail with 401.
//
// Fix: Use chrome.declarativeNetRequest to inject the Cookie header at the
// network layer, which bypasses the Fetch API restriction. This is the
// officially recommended MV3 approach for modifying forbidden headers.
//
// Loaded by: background.js (importScripts), popup.html, options.html (<script>)

const DNR_AUTH_RULE_ID = 1;

/**
 * Reads the current serverUrl + authToken from storage and updates the
 * declarativeNetRequest dynamic rule that injects the Cookie header.
 * Call this after login, logout, token renewal, and before each API call.
 */
async function dnrUpdateAuthRule() {
  try {
    const { serverUrl = '', authToken = '' } = await new Promise(resolve =>
      chrome.storage.local.get(['serverUrl', 'authToken'], resolve)
    );

    // Always remove the old rule first (even if we are about to add a new one)
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_AUTH_RULE_ID]
    });

    if (!serverUrl || !authToken) return;

    let origin;
    try {
      origin = new URL(serverUrl).origin;
    } catch {
      return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: DNR_AUTH_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Cookie',
            operation: 'set',
            value: 'auth_token=' + authToken
          }]
        },
        condition: {
          // | anchors to start of URL — only match our server's /api/ paths
          urlFilter: '|' + origin + '/api/',
          resourceTypes: ['xmlhttprequest']
        }
      }]
    });
  } catch (error) {
    console.error('[dnr-auth] Failed to update auth rule:', error);
  }
}
