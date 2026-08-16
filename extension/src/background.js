importScripts('dnr-auth.js');

let contextInfo = null;
let tokenCheckInterval = null;

// 新项目 bookmark-nav 的会话 Cookie 有效期为 7 天
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RENEW_THRESHOLD = 5 * 60 * 1000; // 剩余5分钟时自动续期
const CHECK_INTERVAL = 5 * 60 * 1000; // 每5分钟检查一次

function storageGet(area, keys) {
  return new Promise(resolve => chrome.storage[area].get(keys, resolve));
}

function storageSet(area, items) {
  return new Promise(resolve => chrome.storage[area].set(items, resolve));
}

// 解析 JWT 的 exp 声明作为过期时间（新项目用 Cookie 鉴权，token 即 JWT）
function parseTokenExpiry(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const payload = JSON.parse(atob(b));
    if (payload && payload.exp) return payload.exp * 1000;
  } catch (error) {
    // 忽略
  }
  return null;
}

// 从浏览器 Cookie 存储中读取 bookmark-nav 的会话 Cookie（HttpOnly，可通过 chrome.cookies 读取）
async function getAuthCookie(serverUrl) {
  try {
    const url = (serverUrl || '').replace(/\/+$/, '');
    const cookie = await chrome.cookies.get({ url, name: 'auth_token' });
    return cookie ? cookie.value : null;
  } catch (error) {
    return null;
  }
}

// 密码解密函数（与 options.js 保持一致）
async function decryptPassword(encryptedPassword) {
  try {
    const combined = Uint8Array.from(atob(encryptedPassword), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('bookmark-extension-encryption-key-32-byte!'),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = new TextEncoder().encode('bookmark-salt-16-byte');
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    try {
      return atob(encryptedPassword);
    } catch {
      return '';
    }
  }
}

// 检查 token 是否需要续期
function shouldRenewToken(tokenExpiry) {
  if (!tokenExpiry) return false;
  const remaining = tokenExpiry - Date.now();
  return remaining > 0 && remaining < TOKEN_RENEW_THRESHOLD;
}

// 自动续期 token：bookmark-nav 用 HttpOnly Cookie 鉴权，重新登录即可刷新 Cookie
async function autoRenewToken() {
  const { serverUrl = '', username = '', encryptedPassword = '', autoRenew = false } = await storageGet('local', ['serverUrl', 'username', 'encryptedPassword', 'autoRenew']);

  if (!autoRenew || !serverUrl || !username || !encryptedPassword) {
    return false;
  }

  try {
    const password = await decryptPassword(encryptedPassword);
    if (!password) {
      console.error('Failed to decrypt password');
      return false;
    }

    // 新项目登录接口：POST /api/auth/login，仅通过 Set-Cookie 下发会话，响应体不含 token
    const response = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      console.error('Auto renew token failed: HTTP', response.status);
      return false;
    }

    const cookieVal = await getAuthCookie(serverUrl);
    if (!cookieVal) {
      console.error('Auto renew token failed: cookie not found');
      return false;
    }

    const expiry = parseTokenExpiry(cookieVal) || (Date.now() + TOKEN_TTL);
    await storageSet('local', {
      authToken: cookieVal,
      tokenExpiry: expiry
    });

    // 更新 DNR 鉴权规则（storage.onChanged 也会触发，但同步调用确保即时生效）
    dnrUpdateAuthRule();

    return true;
  } catch (error) {
    console.error('Auto renew token error:', error);
    return false;
  }
}

// 检查并自动续期 token
async function checkAndRenewToken() {
  try {
    const { authToken = '', tokenExpiry = 0, autoRenew = false } = await storageGet('local', ['authToken', 'tokenExpiry', 'autoRenew']);

    if (!autoRenew || !authToken) {
      return;
    }

    const expiry = tokenExpiry || parseTokenExpiry(authToken);
    if (!expiry) {
      return;
    }

    // 如果 token 已过期或即将过期，自动续期
    if (Date.now() >= expiry || shouldRenewToken(expiry)) {
      await autoRenewToken();
    }
  } catch (error) {
    console.error('Token check error:', error);
  }
}

// 启动定期检查
function startTokenCheck() {
  // 清除之前的定时器
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval);
  }

  // 立即检查一次
  checkAndRenewToken();

  // 设置定期检查
  tokenCheckInterval = setInterval(() => {
    checkAndRenewToken();
  }, CHECK_INTERVAL);
}

// 停止定期检查
function stopTokenCheck() {
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval);
    tokenCheckInterval = null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-bookmark',
    title: '添加书签',
    contexts: ['page', 'link']
  });

  // 启动 token 检查
  startTokenCheck();
  // 同步 DNR 鉴权规则
  dnrUpdateAuthRule();
});

// 监听存储变化，如果启用/禁用自动续期，重新启动/停止检查
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.autoRenew !== undefined || changes.authToken !== undefined || changes.serverUrl !== undefined) {
      const { autoRenew = false, authToken = '' } = changes;
      if (autoRenew?.newValue && authToken?.newValue) {
        startTokenCheck();
      } else if (!autoRenew?.newValue || !authToken?.newValue) {
        stopTokenCheck();
      }
      // serverUrl 或 authToken 变化时同步 DNR 规则
      dnrUpdateAuthRule();
    }
  }
});

// 扩展启动时检查配置并启动检查
chrome.runtime.onStartup.addListener(() => {
  storageGet('local', ['autoRenew', 'authToken']).then(({ autoRenew = false, authToken = '' }) => {
    if (autoRenew && authToken) {
      startTokenCheck();
    }
    // 恢复 DNR 鉴权规则
    dnrUpdateAuthRule();
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-bookmark') {
    contextInfo = {
      url: info.linkUrl || info.pageUrl || (tab ? tab.url : ''),
      title: info.selectionText || (tab ? tab.title : ''),
      from: 'contextMenu'
    };

    if (chrome.action.openPopup) {
      const maybePromise = chrome.action.openPopup();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          chrome.windows.create({
            url: chrome.runtime.getURL('popup.html'),
            type: 'popup',
            width: 420,
            height: 640
          });
        });
      }
    } else {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 420,
        height: 640
      });
    }

    setTimeout(() => {
      contextInfo = null;
    }, 5000);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'request-context-info') {
    sendResponse(contextInfo);
    contextInfo = null;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  contextInfo = {
    url: tab.url || '',
    title: tab.title || '',
    from: 'browserAction'
  };
});
