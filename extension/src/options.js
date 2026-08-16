const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天（与新项目 Cookie 有效期一致）
const TOKEN_RENEW_THRESHOLD = 5 * 60 * 1000; // 剩余5分钟时自动续期
const runtimeApi = typeof browser !== 'undefined' ? browser : chrome;
const permissionsApi = runtimeApi && runtimeApi.permissions ? runtimeApi.permissions : null;

function storageGet(area, keys) {
  return new Promise(resolve => chrome.storage[area].get(keys, resolve));
}

function storageSet(area, items) {
  return new Promise(resolve => chrome.storage[area].set(items, resolve));
}

function storageRemove(area, keys) {
  return new Promise(resolve => chrome.storage[area].remove(keys, resolve));
}

function sanitizeUrl(value) {
  if (!value) return '';
  let url = value.trim();
  if (url.endsWith('/')) {
    url = url.replace(/\/+$/, '');
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch (error) {
    return '';
  }
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

function formatExpiry(expiry) {
  if (!expiry) return '未知';
  const diff = expiry - Date.now();
  if (diff <= 0) return '已过期';
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes} 分 ${seconds} 秒后过期`;
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

async function clearAuthCookie(serverUrl) {
  try {
    await chrome.cookies.remove({ url: (serverUrl || '').replace(/\/+$/, ''), name: 'auth_token' });
  } catch (error) {
    // 忽略
  }
}

// 密码加密函数（使用 Web Crypto API）
async function encryptPassword(password) {
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('bookmark-extension-encryption-key-32-byte!'), // 32字节密钥
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = new TextEncoder().encode('bookmark-salt-16-byte'); // 16字节盐值
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
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 12字节 IV
    const encoded = new TextEncoder().encode(password);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoded
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('Encryption error:', error);
    return btoa(password);
  }
}

// 密码解密函数
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

    // 同步 DNR 鉴权规则（确保新 token 立即生效）
    await dnrUpdateAuthRule();

    return true;
  } catch (error) {
    console.error('Auto renew token error:', error);
    return false;
  }
}

async function updateStatusView() {
  const { serverUrl = '', authToken = '', tokenExpiry = 0, username = '', autoRenew = false } = await storageGet('local', ['serverUrl', 'authToken', 'tokenExpiry', 'username', 'autoRenew']);
  const statusInfo = document.getElementById('status-info');
  const logoutBtn = document.getElementById('logout-btn');
  const serverInput = document.getElementById('server-url');
  const usernameInput = document.getElementById('username');
  const autoRenewCheckbox = document.getElementById('auto-renew');

  if (serverUrl) {
    serverInput.value = serverUrl;
  }
  if (username) {
    usernameInput.value = username;
  }
  if (autoRenewCheckbox) {
    autoRenewCheckbox.checked = autoRenew || false;
  }

  if (authToken) {
    const expiry = tokenExpiry || parseTokenExpiry(authToken);
    if (!expiry || Date.now() > expiry) {
      if (autoRenew) {
        const renewed = await autoRenewToken();
        if (renewed) {
          const { authToken: newToken, tokenExpiry: newExpiry } = await storageGet('local', ['authToken', 'tokenExpiry']);
          if (newToken && newExpiry && Date.now() < newExpiry) {
            statusInfo.textContent = `已连接到 ${serverUrl}，账号 ${username || '管理员'}，令牌将在 ${formatExpiry(newExpiry)} 后过期（已自动续期）。`;
            logoutBtn.style.display = 'block';
            return;
          }
        }
      }

      await storageRemove('local', ['authToken', 'tokenExpiry']);
      statusInfo.textContent = '认证令牌已过期，请重新登录。';
      logoutBtn.style.display = 'none';
      return;
    }

    if (autoRenew && shouldRenewToken(expiry)) {
      const renewed = await autoRenewToken();
      if (renewed) {
        const { tokenExpiry: newExpiry } = await storageGet('local', ['tokenExpiry']);
        if (newExpiry) {
          statusInfo.textContent = `已连接到 ${serverUrl}，账号 ${username || '管理员'}，令牌将在 ${formatExpiry(newExpiry)} 后过期（已自动续期）。`;
          logoutBtn.style.display = 'block';
          return;
        }
      }
    }

    statusInfo.textContent = `已连接到 ${serverUrl}，账号 ${username || '管理员'}，令牌将在 ${formatExpiry(expiry)} 后过期${autoRenew ? '（自动续期已启用）' : ''}。`;
    logoutBtn.style.display = 'block';
  } else if (serverUrl) {
    statusInfo.textContent = `服务器地址已配置：${serverUrl}，请登录。`;
    logoutBtn.style.display = 'none';
  } else {
    statusInfo.textContent = '请配置服务器地址并登录。';
    logoutBtn.style.display = 'none';
  }
}

function displayConnectionStatus(message, type = 'info') {
  const status = document.getElementById('connection-status');
  status.textContent = message;
  status.classList.remove('hidden', 'status-connected', 'status-disconnected');
  if (type === 'success') {
    status.classList.add('status-connected');
  } else if (type === 'error') {
    status.classList.add('status-disconnected');
  }
}

async function requestHostPermission(origin) {
  if (!permissionsApi || !permissionsApi.request) {
    return true;
  }

  const details = { origins: [`${origin}/*`] };
  const length = permissionsApi.request.length;

  if (length >= 2) {
    return new Promise(resolve => {
      permissionsApi.request(details, granted => {
        resolve(Boolean(granted));
      });
    });
  }

  try {
    const result = permissionsApi.request(details);
    if (result && typeof result.then === 'function') {
      const granted = await result;
      return Boolean(granted);
    }
    return Boolean(result);
  } catch (error) {
    console.warn('Permission request failed:', error);
    return false;
  }
}

async function removePreviousPermissions(exceptOrigin) {
  if (!permissionsApi || !permissionsApi.getAll || !permissionsApi.remove) {
    return;
  }

  let current = { origins: [] };
  const length = permissionsApi.getAll.length;

  if (length >= 1) {
    current = await new Promise(resolve => permissionsApi.getAll(resolve));
  } else {
    try {
      const result = permissionsApi.getAll();
      current = result && typeof result.then === 'function' ? await result : (result || current);
    } catch (error) {
      console.warn('Get permissions failed:', error);
    }
  }

  const toRemove = (current.origins || []).filter(origin => origin !== `${exceptOrigin}/*`);
  if (toRemove.length === 0) {
    return;
  }

  const removeLength = permissionsApi.remove.length;
  if (removeLength >= 2) {
    await new Promise(resolve => permissionsApi.remove({ origins: toRemove }, () => resolve()));
  } else {
    try {
      const result = permissionsApi.remove({ origins: toRemove });
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (error) {
      console.warn('Remove permissions failed:', error);
    }
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const serverInput = document.getElementById('server-url');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('login-btn');
  const loginText = document.getElementById('login-text');
  const autoRenewCheckbox = document.getElementById('auto-renew');

  const serverUrl = sanitizeUrl(serverInput.value);
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const autoRenew = autoRenewCheckbox ? autoRenewCheckbox.checked : false;

  if (!serverUrl || !username || !password) {
    displayConnectionStatus('请填写所有必填项。', 'error');
    return;
  }

  loginBtn.disabled = true;
  loginText.textContent = '登录中...';
  displayConnectionStatus('正在请求权限...', 'info');

  const granted = await requestHostPermission(serverUrl);
  if (!granted) {
    displayConnectionStatus('未获得访问权限，无法连接服务器。', 'error');
    loginBtn.disabled = false;
    loginText.textContent = '登录并保存';
    return;
  }

  await removePreviousPermissions(serverUrl);

  displayConnectionStatus('正在连接服务器...', 'info');

  try {
    // 新项目 bookmark-nav：POST /api/auth/login，仅通过 Set-Cookie 下发会话
    const response = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('用户名或密码不正确。');
      }
      throw new Error('服务器返回错误，请检查地址并重试。');
    }

    // 登录成功，从浏览器 Cookie 存储读取会话 token
    const cookieVal = await getAuthCookie(serverUrl);
    if (!cookieVal) {
      throw new Error('登录成功但未获取到会话 Cookie，请检查浏览器 Cookie 设置后重试。');
    }

    const expiry = parseTokenExpiry(cookieVal) || (Date.now() + TOKEN_TTL);
    const storageData = {
      serverUrl,
      username,
      authToken: cookieVal,
      tokenExpiry: expiry,
      autoRenew: autoRenew
    };

    // 如果启用了自动续期，加密保存密码
    if (autoRenew) {
      try {
        storageData.encryptedPassword = await encryptPassword(password);
      } catch (error) {
        console.error('Failed to encrypt password:', error);
        displayConnectionStatus('密码加密失败，自动续期功能可能无法使用。', 'error');
      }
    } else {
      await storageRemove('local', ['encryptedPassword']);
    }

    await storageSet('local', storageData);

    // 设置 DNR 鉴权规则（注入 Cookie 头到 API 请求）
    await dnrUpdateAuthRule();

    passwordInput.value = '';
    displayConnectionStatus('登录成功，设置已保存。', 'success');
    await updateStatusView();
  } catch (error) {
    console.error('Login error:', error);
    displayConnectionStatus(error.message || '网络错误，请稍后重试。', 'error');
  } finally {
    loginBtn.disabled = false;
    loginText.textContent = '登录并保存';
  }
}

async function handleLogout() {
  const { serverUrl = '', authToken = '' } = await storageGet('local', ['serverUrl', 'authToken']);

  if (serverUrl) {
    try {
      await fetch(`${serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
    } catch (error) {
      console.warn('Logout request failed:', error);
    }
    await clearAuthCookie(serverUrl);
  }

  await storageRemove('local', ['authToken', 'tokenExpiry', 'encryptedPassword', 'autoRenew']);
  // 移除 DNR 鉴权规则
  await dnrUpdateAuthRule();
  displayConnectionStatus('已登出。', 'info');
  updateStatusView();
}

async function init() {
  await updateStatusView();

  const { theme } = await storageGet('local', ['theme']);
  if (theme === 'dark') {
    document.body.classList.add('dark');
  }

  document.getElementById('settings-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

document.addEventListener('DOMContentLoaded', init);
