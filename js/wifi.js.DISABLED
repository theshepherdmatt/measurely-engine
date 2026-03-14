// web/js/wifi.js - WiFi management

import { $, fetchJSON, showToast } from './api.js';

let wifiNetworks = [];
let currentStatus = {};

export async function scanWifi() {
  const scanBtn = $('wifiScanBtn');
  const select = $('wifiSelect');
  
  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Scanning...';
  }
  
  try {
    const data = await fetchJSON('/api/wifi/scan', { method: 'POST' });
    
    if (data.ok && data.networks) {
      wifiNetworks = data.networks;
      populateWifiSelect(data.networks);
      showToast(`Found ${data.networks.length} networks`, 'success');
    } else {
      throw new Error(data.error || 'Scan failed');
    }
    
  } catch (error) {
    console.error('WiFi scan error:', error);
    showToast('WiFi scan failed', 'error');
    
    // Fallback to empty select
    if (select) {
      select.innerHTML = '<option value="">No networks found</option>';
    }
  } finally {
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<i class="fas fa-search mr-2"></i>Scan Networks';
    }
  }
}

export async function connectWifi(ssid = null, password = null) {
  const connectBtn = $('wifiConnectBtn');
  const select = $('wifiSelect');
  const passwordInput = $('wifiPassword');
  
  // Get SSID and password if not provided
  if (!ssid && select) {
    ssid = select.value;
  }
  
  if (!password && passwordInput) {
    password = passwordInput.value;
  }
  
  if (!ssid) {
    showToast('Please select a network', 'error');
    return false;
  }
  
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Connecting...';
  }
  
  try {
    const data = await fetchJSON('/api/wifi/connect', { 
      method: 'POST', 
      body: { ssid, password } 
    });
    
    if (data.ok) {
      showToast('Connected successfully', 'success');
      await wifiStatus(); // Update status
      return true;
    } else {
      throw new Error(data.error || 'Connection failed');
    }
    
  } catch (error) {
    console.error('WiFi connection error:', error);
    showToast('Connection failed', 'error');
    return false;
  } finally {
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = '<i class="fas fa-wifi mr-2"></i>Connect';
    }
  }
}

export async function wifiStatus() {
  try {
    const data = await fetchJSON('/api/wifi/status');
    currentStatus = data;
    updateWifiStatusDisplay(data);
    return data;
  } catch (error) {
    console.error('Error getting WiFi status:', error);
    updateWifiStatusDisplay({ connected: false, error: 'Status check failed' });
    return { connected: false, error: 'Status check failed' };
  }
}

export async function stopHotspot() {
  const stopBtn = $('hotspotStopBtn');
  
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Stopping...';
  }
  
  try {
    const data = await fetchJSON('/api/wifi/stop-hotspot', { method: 'POST' });
    
    if (data.ok) {
      showToast('Hotspot stopped', 'success');
      await wifiStatus(); // Update status
      return true;
    } else {
      throw new Error(data.error || 'Failed to stop hotspot');
    }
    
  } catch (error) {
    console.error('Error stopping hotspot:', error);
    showToast('Failed to stop hotspot', 'error');
    return false;
  } finally {
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<i class="fas fa-stop mr-2"></i>Stop Hotspot';
    }
  }
}

function populateWifiSelect(networks) {
  const select = $('wifiSelect');
  if (!select) return;
  
  if (networks.length === 0) {
    select.innerHTML = '<option value="">No networks found</option>';
    return;
  }
  
  select.innerHTML = '<option value="">Select a network...</option>';
  
  networks.forEach(network => {
    const option = document.createElement('option');
    option.value = network.ssid;
    option.textContent = `${network.ssid} (${network.signal}%)`;
    option.dataset.needsPassword = network.security !== 'Open';
    select.appendChild(option);
  });
}

function updateWifiStatusDisplay(status) {
  const statusEl = $('wifiStatus');
  const statusText = $('wifiStatusText');
  const ipEl = $('wifiIP');
  const ssidEl = $('wifiSSID');
  
  if (statusEl) {
    if (status.connected) {
      statusEl.className = 'text-green-600 font-semibold';
      statusEl.textContent = 'Connected';
    } else {
      statusEl.className = 'text-red-600 font-semibold';
      statusEl.textContent = 'Disconnected';
    }
  }
  
  if (statusText) {
    statusText.textContent = status.connected ? 'Connected' : 'Disconnected';
    statusText.className = status.connected ? 'text-green-600' : 'text-red-600';
  }
  
  if (ipEl) {
    ipEl.textContent = status.ip || 'N/A';
  }
  
  if (ssidEl) {
    ssidEl.textContent = status.ssid || 'N/A';
  }
}

export function bindWifiSelect() {
  const select = $('wifiSelect');
  const passwordInput = $('wifiPassword');
  
  if (!select || !passwordInput) return;
  
  select.addEventListener('change', () => {
    const selected = select.options[select.selectedIndex];
    const needsPassword = selected.dataset.needsPassword === 'true';
    
    passwordInput.disabled = !needsPassword;
    passwordInput.value = '';
    passwordInput.placeholder = needsPassword ? 'Enter password...' : 'No password required';
    
    if (needsPassword) {
      passwordInput.focus();
    }
  });
}

export function setupWifiHandlers() {
  const scanBtn = $('wifiScanBtn');
  const connectBtn = $('wifiConnectBtn');
  const stopHotspotBtn = $('hotspotStopBtn');
  
  if (scanBtn) {
    scanBtn.addEventListener('click', scanWifi);
  }
  
  if (connectBtn) {
    connectBtn.addEventListener('click', () => connectWifi());
  }
  
  if (stopHotspotBtn) {
    stopHotspotBtn.addEventListener('click', stopHotspot);
  }
  
  bindWifiSelect();
}

export function initWifi() {
  setupWifiHandlers();
  wifiStatus(); // Initial status check
}

// Global functions for HTML handlers
window.scanWifi = scanWifi;
window.connectWifi = connectWifi;
window.stopHotspot = stopHotspot;