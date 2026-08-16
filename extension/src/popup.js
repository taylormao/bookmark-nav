const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天（与新项目 Cookie 有效期一致）
const TOKEN_RENEW_THRESHOLD = 5 * 60 * 1000; // 剩余5分钟时自动续期
let settings = {};
let categories = [];

function storageGet(area, keys) {
  return new Promise(resolve => chrome.storage[area].get(keys, resolve));
}

function storageSet(area, items) {
  return new Promise(resolve => chrome.storage[area].set(items, resolve));
}

function storageRemove(area, keys) {
  return new Promise(resolve => chrome.storage[area].remove(keys, resolve));
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

// 从浏览器 Cookie 存储读取 bookmark-nav 会话 Cookie
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

// 自动续期 token：重新登录以刷新会话 Cookie
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

    // 更新 settings 对象
    settings.authToken = cookieVal;
    settings.tokenExpiry = expiry;

    // 同步 DNR 鉴权规则（确保新 token 立即生效）
    await dnrUpdateAuthRule();

    return true;
  } catch (error) {
    console.error('Auto renew token error:', error);
    return false;
  }
}

// 确保 token 有效（检查并自动续期）
async function ensureTokenValid() {
  if (!settings.authToken || !settings.tokenExpiry) {
    return false;
  }

  const now = Date.now();
  if (now > settings.tokenExpiry) {
    return await autoRenewToken();
  }

  if (shouldRenewToken(settings.tokenExpiry)) {
    return await autoRenewToken();
  }

  return true;
}

// 构造请求头（Cookie 头由 declarativeNetRequest 规则注入，不再手动设置）
async function buildHeaders() {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  return headers;
}

async function loadSettings() {
  const result = await storageGet('local', ['serverUrl', 'authToken', 'tokenExpiry', 'autoRenew']);
  let { serverUrl = '', authToken = '', tokenExpiry = 0, autoRenew = false } = result;

  if (authToken) {
    const expiry = tokenExpiry || parseTokenExpiry(authToken);
    if (!expiry || Date.now() > expiry) {
      if (autoRenew) {
        const renewed = await autoRenewToken();
        if (renewed) {
          const { authToken: newToken, tokenExpiry: newExpiry } = await storageGet('local', ['authToken', 'tokenExpiry']);
          if (newToken && newExpiry && Date.now() < newExpiry) {
            authToken = newToken;
            tokenExpiry = newExpiry;
          } else {
            await storageRemove('local', ['authToken', 'tokenExpiry']);
            authToken = '';
            tokenExpiry = 0;
          }
        } else {
          await storageRemove('local', ['authToken', 'tokenExpiry']);
          authToken = '';
          tokenExpiry = 0;
        }
      } else {
        await storageRemove('local', ['authToken', 'tokenExpiry']);
        authToken = '';
        tokenExpiry = 0;
      }
    }
  }

  settings = { serverUrl, authToken, tokenExpiry, autoRenew };
  return settings;
}

function showSection(sectionId) {
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('form-section').classList.add('hidden');
  document.getElementById('loading-section').classList.add('hidden');
  document.getElementById(sectionId).classList.remove('hidden');
}

function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  statusEl.classList.remove('hidden');

  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 4000);
}

async function loadCategories() {
  try {
    await ensureTokenValid();
    await dnrUpdateAuthRule();

    const headers = await buildHeaders();
    const response = await fetch(`${settings.serverUrl}/api/admin/categories`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      if (response.status === 401) {
        await storageRemove('local', ['authToken', 'tokenExpiry']);
        settings.authToken = '';
      }
      throw new Error('Failed to load categories');
    }

    const result = await response.json();
    const rawCategories = result.categories || [];

    const categoryMap = new Map();
    rawCategories.forEach(cat => {
      categoryMap.set(cat.id, { ...cat });
    });

    categories = rawCategories.map(cat => {
      const base = categoryMap.get(cat.id);
      const segments = [];
      const visited = new Set();
      let current = base;

      while (current) {
        if (visited.has(current.id)) {
          break;
        }
        visited.add(current.id);
        segments.unshift(current.name);
        if (!current.parentId) {
          break;
        }
        current = categoryMap.get(current.parentId);
      }

      return {
        ...base,
        path: segments.join(' / ')
      };
    });

    const select = document.getElementById('category');
    select.innerHTML = '<option value="">选择分类...</option>';

    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = String(cat.id);
      option.textContent = cat.path || cat.name;
      select.appendChild(option);
    });

    if (categories.length > 0) {
      select.value = String(categories[0].id);
    }

    return true;
  } catch (error) {
    console.error('Failed to load categories:', error);
    return false;
  }
}

async function getCurrentTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      resolve(tabs && tabs.length ? tabs[0] : null);
    });
  });
}

async function maybeUseContextInfo() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'request-context-info' }, info => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(info || null);
    });
  });
}

async function saveBookmark(event) {
  event.preventDefault();

  await ensureTokenValid();
  await dnrUpdateAuthRule();

  const title = document.getElementById('title').value.trim();
  const url = document.getElementById('url').value.trim();
  const description = document.getElementById('description').value.trim();
  const categoryId = document.getElementById('category').value;
  const isPrivate = document.getElementById('is-private').checked;

  if (!title || !url || !categoryId) {
    showStatus('请填写所有必填项', 'error');
    return;
  }

  const saveBtn = document.getElementById('save-btn');
  const saveText = document.getElementById('save-text');
  saveBtn.disabled = true;
  saveText.textContent = '保存中...';

  try {
    const headers = await buildHeaders();
      const response = await fetch(`${settings.serverUrl}/api/admin/bookmarks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
        title: title,
        url: url,
        description: description || null,
        icon: null,
        categoryId: parseInt(categoryId, 10),
        visibility: isPrivate ? 'private' : 'public'
      })
    });

    if (response.status === 401) {
      await storageRemove('local', ['authToken', 'tokenExpiry']);
      settings.authToken = '';
      showStatus('登录已失效，请重新登录', 'error');
      saveBtn.disabled = false;
      saveText.textContent = '保存书签';
      setTimeout(() => showSection('auth-section'), 1200);
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (response.ok && result.bookmark) {
      showStatus('✅ 书签保存成功', 'success');
      setTimeout(() => {
        window.close();
      }, 1000);
    } else {
      showStatus(result.error || '保存失败', 'error');
      saveBtn.disabled = false;
      saveText.textContent = '保存书签';
    }
  } catch (error) {
    console.error('Save error:', error);
    showStatus('网络错误，请检查服务器地址', 'error');
    saveBtn.disabled = false;
    saveText.textContent = '保存书签';
  }
}

async function init() {
  showSection('loading-section');

  await loadSettings();

  if (!settings.serverUrl || !settings.authToken) {
    showSection('auth-section');
    return;
  }

  const categoriesLoaded = await loadCategories();

  if (!categoriesLoaded) {
    showSection('auth-section');
    return;
  }

  const contextInfo = await maybeUseContextInfo();
  const tab = contextInfo || await getCurrentTab();

  if (tab) {
    document.getElementById('title').value = tab.title || '';
    document.getElementById('url').value = tab.url || '';
  }

  showSection('form-section');
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('goto-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('bookmark-form').addEventListener('submit', saveBookmark);
});
