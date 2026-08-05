const socket = io();

// ===== DOM Elements =====
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const userCountEl = document.getElementById('userCount');
const connectionCard = document.getElementById('connectionCard');

// ===== DOM Elements =====
const locationInfo = document.getElementById('locationInfo');
const coordLat = document.getElementById('coordLat');
const coordLng = document.getElementById('coordLng');
const coordAcc = document.getElementById('coordAcc');
const coordSource = document.getElementById('coordSource');
const coordAddr = document.getElementById('coordAddr');
const coordSpeed = document.getElementById('coordSpeed');
const coordAlt = document.getElementById('coordAlt');
const altCanvas = document.getElementById('altCanvas');
const altCtx = altCanvas?.getContext('2d');
const altReadings = [];
const MAX_ALT_READINGS = 40;

// ===== Custom Marker Icon =====
const createUserIcon = (isCurrentUser = false) => L.divIcon({
    className: 'custom-marker',
    html: `<div class="marker-pulse ${isCurrentUser ? 'current' : ''}">
             <div class="marker-dot ${isCurrentUser ? 'current' : ''}"></div>
           </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

// ===== Initialize Map =====
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

// Dark theme tile layer - more modern look
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// Add zoom controls to bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// ===== Share Live Link =====
const shareBtn = document.getElementById('shareBtn');

function shareLiveLink() {
    if (!myMarker) {
        showToast('📍 Wait for location first', 'leave');
        return;
    }
    const url = `${window.location.origin}${window.location.pathname}?lat=${myLat.toFixed(6)}&lng=${myLng.toFixed(6)}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('🔗 Link copied!', 'join');
    }).catch(() => {
        // Fallback: select and copy via input
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('🔗 Link copied!', 'join');
    });
}

shareBtn.addEventListener('click', shareLiveLink);

// ===== Fit All Users =====
function fitAllUsers() {
    const points = [];
    if (myMarker) points.push(myMarker.getLatLng());
    Object.values(markers).forEach(m => points.push(m.getLatLng()));

    if (points.length === 0) {
        // No markers at all — zoom out to world
        map.setView([20, 0], 2);
        return;
    }
    if (points.length === 1) {
        map.flyTo(points[0], 13, { duration: 0.8 });
        return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
}

// Fit-all button as a custom Leaflet control (sits above zoom)
L.Control.FitAll = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar fitall-btn');
        container.innerHTML = '<a id="fitAllBtn" href="#" role="button" title="Fit all users" aria-label="Fit all users" tabindex="0">⊞</a>';
        L.DomEvent.on(container, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            fitAllUsers();
        });
        // Prevent map drag when interacting with the button
        L.DomEvent.disableClickPropagation(container);
        return container;
    }
});
new L.Control.FitAll().addTo(map);

// ===== Connection Status =====
socket.on('connect', () => {
    statusDot.className = 'status-dot connected';
    if (!isGPSMode) statusText.textContent = 'Connected';
    connectionCard.classList.remove('disconnected');
    connectionCard.classList.add('connected');
});

socket.on('disconnect', () => {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected';
    connectionCard.classList.remove('connected');
    connectionCard.classList.add('disconnected');
});

socket.on('connect_error', () => {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Connection Error';
    connectionCard.classList.remove('connected');
    connectionCard.classList.add('disconnected');
});

// ===== User Count =====
socket.on('usersCount', (count) => {
    userCountEl.textContent = count;
});

// ===== Geolocation =====
let myLat = 0;
let myLng = 0;
let myMarker = null;
let myAccuracyCircle = null;
let isGPSMode = false;
let lastAddress = '';
let addressTimer = null;
const shortAddr = (a) => a ? a.split(',').slice(0, 4).join(',') : '';

function updateLocationInfo(latitude, longitude, accuracy, source, speed) {
    coordLat.textContent = latitude.toFixed(6);
    coordLng.textContent = longitude.toFixed(6);
    coordAcc.textContent = accuracy ? `${accuracy.toFixed(0)}m` : 'N/A';
    coordSource.textContent = source;
    if (speed !== null && speed !== undefined && speed >= 0) {
        const kmh = speed * 3.6;
        coordSpeed.textContent = kmh < 0.1 ? '0 km/h' : kmh < 1 ? '< 1 km/h' : `${kmh.toFixed(1)} km/h`;
        // Color-code: slow (teal), medium (amber), fast (red)
        if (kmh < 5) coordSpeed.style.color = 'var(--accent-success)';
        else if (kmh < 30) coordSpeed.style.color = '#fdcb6e';
        else coordSpeed.style.color = 'var(--accent-danger)';
    } else {
        coordSpeed.textContent = '0 km/h';
        coordSpeed.style.color = 'var(--text-muted)';
    }
    locationInfo.classList.add('visible');
}

function updateAltitude(altitude) {
    if (altitude !== null && altitude !== undefined && !isNaN(altitude)) {
        coordAlt.textContent = `${altitude.toFixed(1)}m`;
        altReadings.push(altitude);
        if (altReadings.length > MAX_ALT_READINGS) altReadings.shift();
        drawAltGraph();
    } else {
        coordAlt.textContent = '—';
    }
}

function drawAltGraph() {
    if (!altCtx || altReadings.length < 2) return;
    const w = altCanvas.width, h = altCanvas.height;
    const pad = 4;
    const graphW = w - pad * 2;
    const graphH = h - pad * 2;

    // Find min/max with some padding
    let min = Infinity, max = -Infinity;
    altReadings.forEach(v => { if (v < min) min = v; if (v > max) max = v; });
    const range = max - min || 1; // avoid division by zero
    const padding = range * 0.15;
    min -= padding;
    max += padding;
    const adjRange = max - min || 1;

    // Clear
    altCtx.clearRect(0, 0, w, h);

    // Background grid dots
    altCtx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < w; x += 18) {
        for (let y = 0; y < h; y += 12) {
            altCtx.beginPath();
            altCtx.arc(x, y, 1, 0, Math.PI * 2);
            altCtx.fill();
        }
    }

    // Draw fill (gradient)
    const grad = altCtx.createLinearGradient(0, pad, 0, h - pad);
    grad.addColorStop(0, 'rgba(108, 92, 231, 0.25)');
    grad.addColorStop(1, 'rgba(108, 92, 231, 0.02)');
    altCtx.beginPath();
    altReadings.forEach((v, i) => {
        const x = pad + (i / (altReadings.length - 1)) * graphW;
        const y = pad + graphH - ((v - min) / adjRange) * graphH;
        i === 0 ? altCtx.moveTo(x, y) : altCtx.lineTo(x, y);
    });
    // Close to bottom for fill
    const lastX = pad + graphW;
    const bottomY = pad + graphH;
    altCtx.lineTo(lastX, bottomY);
    altCtx.lineTo(pad, bottomY);
    altCtx.closePath();
    altCtx.fillStyle = grad;
    altCtx.fill();

    // Draw line
    altCtx.beginPath();
    altReadings.forEach((v, i) => {
        const x = pad + (i / (altReadings.length - 1)) * graphW;
        const y = pad + graphH - ((v - min) / adjRange) * graphH;
        i === 0 ? altCtx.moveTo(x, y) : altCtx.lineTo(x, y);
    });
    altCtx.strokeStyle = '#6c5ce7';
    altCtx.lineWidth = 1.5;
    altCtx.shadowColor = 'rgba(108, 92, 231, 0.4)';
    altCtx.shadowBlur = 4;
    altCtx.stroke();
    altCtx.shadowBlur = 0;

    // Draw latest point dot
    const last = altReadings[altReadings.length - 1];
    const lx = pad + graphW;
    const ly = pad + graphH - ((last - min) / adjRange) * graphH;
    altCtx.beginPath();
    altCtx.arc(lx, ly, 3, 0, Math.PI * 2);
    altCtx.fillStyle = '#6c5ce7';
    altCtx.shadowColor = 'rgba(108, 92, 231, 0.6)';
    altCtx.shadowBlur = 8;
    altCtx.fill();
    altCtx.shadowBlur = 0;
}

function reverseGeocode(lat, lng) {
    // Throttle: only geocode every 10s
    if (addressTimer) return;
    addressTimer = setTimeout(() => { addressTimer = null; }, 10000);

    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
        headers: { 'User-Agent': 'LiveTracker/1.0' }
    })
        .then(r => r.json())
        .then(data => {
            const addr = data.display_name;
            if (addr && addr !== lastAddress) {
                lastAddress = addr;
                // Show a shortened, readable version
                const short = shortAddr(addr);
                coordAddr.textContent = short;
                coordAddr.title = addr;
                // Update own popup
                if (myMarker) {
                    const accStr = myAccuracyCircle ? `±${myAccuracyCircle.getRadius().toFixed(0)}m` : '';
                    myMarker.setPopupContent(
                        `<b>📍 ${myUsername || 'You'}</b>` +
                        `<br><span style="font-size:11px;color:rgba(255,255,255,0.5)">${short}</span>`
                    );
                }
            }
        })
        .catch(() => {});
}

function showMyMarker(latitude, longitude, accuracy, shouldEmit = true, speed = null) {
    myLat = latitude;
    myLng = longitude;

    if (shouldEmit && !isGPSMode) {
        // First GPS fix — emit location
        isGPSMode = true;
        socket.emit('sendLocation', { latitude, longitude });
    } else if (shouldEmit) {
        socket.emit('sendLocation', { latitude, longitude });
    }

    const source = isGPSMode ? 'GPS' : 'IP';
    updateLocationInfo(latitude, longitude, accuracy, source, speed);

    // Reverse geocode on GPS fixes
    if (isGPSMode) reverseGeocode(latitude, longitude);

    // Add/update personal marker
    if (!myMarker) {
        myMarker = L.marker([latitude, longitude], {
            icon: createUserIcon(true),
            zIndexOffset: 1000
        }).addTo(map);
        myMarker.bindPopup(`<b>📍 ${myUsername || 'You'}</b>`);
        map.setView([latitude, longitude], 15);
    } else {
        myMarker.setLatLng([latitude, longitude]);
        // Update popup with current address if available
        if (lastAddress) {
            const accStr = accuracy ? `±${accuracy.toFixed(0)}m` : '';
            const short = shortAddr(lastAddress);
            myMarker.setPopupContent(
                `<b>📍 ${myUsername || 'You'}</b>` +
                `<br><span style="font-size:11px;color:rgba(255,255,255,0.5)">${short}</span>`
            );
        }
    }

    // Show/hide accuracy circle (recreate on mode switch)
    if (accuracy && accuracy > 0) {
        const isIP = !isGPSMode;
        const needsRecreate = myAccuracyCircle &&
            myAccuracyCircle.options.dashArray !== (isIP ? '4 4' : null);
        if (myAccuracyCircle && !needsRecreate) {
            myAccuracyCircle.setLatLng([latitude, longitude]);
            myAccuracyCircle.setRadius(accuracy);
        } else {
            if (myAccuracyCircle) map.removeLayer(myAccuracyCircle);
            myAccuracyCircle = L.circle([latitude, longitude], {
                radius: accuracy,
                color: isIP ? '#00cec9' : '#6c5ce7',
                fillColor: isIP ? '#00cec9' : '#6c5ce7',
                fillOpacity: isIP ? 0.08 : 0.04,
                weight: isIP ? 1 : 1.5,
                opacity: isIP ? 0.3 : 0.2,
                dashArray: isIP ? '4 4' : null
            }).addTo(map);
        }
    } else if (myAccuracyCircle) {
        map.removeLayer(myAccuracyCircle);
        myAccuracyCircle = null;
    }
}

// ===== Multi-source IP geolocation fallback =====
const IP_SOURCES = [
    {
        url: 'https://free.freeipapi.com/api/json/',
        parse: (d) => ({ lat: d.latitude, lng: d.longitude, city: d.cityName, accuracy: 10000 })
    },
    {
        url: 'https://ipapi.co/json/',
        parse: (d) => ({ lat: d.latitude, lng: d.longitude, city: d.city, accuracy: 25000 })
    }
];

function fallbackToIPLocation() {
    if (myMarker || isGPSMode) return;
    statusText.textContent = 'Locating by IP...';

    let attempt = (index) => {
        if (index >= IP_SOURCES.length) {
            if (!myMarker) statusText.textContent = 'Location unavailable';
            return;
        }
        const source = IP_SOURCES[index];
        fetch(source.url)
            .then(res => res.json())
            .then(data => {
                const loc = source.parse(data);
                if (loc.lat && loc.lng && !myMarker && !isGPSMode) {
                    showMyMarker(loc.lat, loc.lng, loc.accuracy, false);
                    statusText.textContent = `~${loc.city || 'Unknown'} (IP)`;
                }
            })
            .catch(() => attempt(index + 1));
    };
    attempt(0);
}

// ===== GPS Location with auto-retry =====
let gpsWatchId = null;
let gpsRetryCount = 0;
const MAX_GPS_RETRIES = 2;

function startGPS() {
    if (isGPSMode) return;
    statusText.textContent = 'Locating via GPS...';

    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, altitude, speed } = position.coords;
            gpsRetryCount = 0;
            showMyMarker(latitude, longitude, accuracy, true, speed);
            updateAltitude(altitude);
            statusDot.className = 'status-dot connected';
            const accStr = accuracy ? `±${accuracy.toFixed(0)}m` : '';
            statusText.textContent = accStr ? `Connected ${accStr}` : 'Connected';
        },
        (error) => {
            console.error('Geolocation error:', error.message);
            if (gpsRetryCount < MAX_GPS_RETRIES) {
                gpsRetryCount++;
                statusText.textContent = `GPS retry ${gpsRetryCount}/${MAX_GPS_RETRIES}...`;
                navigator.geolocation.clearWatch(gpsWatchId);
                setTimeout(startGPS, 5000);
            } else {
                statusText.textContent = 'GPS unavailable — trying IP...';
                fallbackToIPLocation();
                // Background GPS watch (clear previous first)
                navigator.geolocation.clearWatch(gpsWatchId);
                navigator.geolocation.watchPosition(
                    (position) => {
                        const { latitude, longitude, accuracy, altitude, speed } = position.coords;
                        showMyMarker(latitude, longitude, accuracy, true, speed);
                        updateAltitude(altitude);
                        statusDot.className = 'status-dot connected';
                        const accStr = accuracy ? `±${accuracy.toFixed(0)}m` : '';
                        statusText.textContent = accStr ? `Connected ${accStr}` : 'Connected';
                    },
                    () => {},
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
                );
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000
        }
    );
}

if (navigator.geolocation) {
    startGPS();
} else {
    statusText.textContent = 'Geolocation not supported';
    fallbackToIPLocation();
}

// ===== Username =====
let myUsername = localStorage.getItem('tracker_username') || '';

function showUsernameModal() {
    const modal = document.getElementById('nameModal');
    const input = document.getElementById('nameInput');
    const btn = document.getElementById('nameSubmit');
    const skip = document.getElementById('nameSkip');
    const saved = localStorage.getItem('tracker_username');
    if (saved) {
        myUsername = saved;
        socket.emit('setUsername', saved);
        updateOwnPopup();
        return;
    }
    modal.classList.remove('hidden');
    input.focus();
    function setName(val) {
        myUsername = val;
        localStorage.setItem('tracker_username', val);
        socket.emit('setUsername', val);
        modal.classList.add('hidden');
        updateOwnPopup();
    }
    btn.onclick = () => {
        const val = input.value.trim();
        if (val) setName(val);
    };
    skip.onclick = () => setName('Anonymous');
    input.onkeydown = (e) => {
        if (e.key === 'Enter') btn.click();
    };
}

function updateOwnPopup() {
    if (myMarker) {
        const addrHtml = lastAddress
            ? `<br><span style="font-size:11px;color:rgba(255,255,255,0.5)">${shortAddr(lastAddress)}</span>`
            : '';
        myMarker.setPopupContent(`<b>📍 ${myUsername || 'You'}</b>${addrHtml}`);
    }
}

// Show modal after socket connects
socket.on('connect', () => {
    setTimeout(showUsernameModal, 500);
});
// Fallback if socket already connected
if (socket.connected) setTimeout(showUsernameModal, 500);

// ===== Toast Notifications =====
const toastContainer = document.getElementById('toastContainer');

function showToast(message, type = 'join') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    // Auto-remove after 3.5s
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// Listen for join/leave events
socket.on('userJoined', (data) => {
    if (data.id !== socket.id) {
        showToast(`✨ ${data.username || 'Anonymous'} joined`, 'join');
    }
});

socket.on('userLeft', (data) => {
    const name = data.username || 'Anonymous';
    showToast(`👋 ${name} left`, 'leave');
});

// Parse shared location from URL params (runs after toast system is initialized)
(function checkSharedLocation() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lng = parseFloat(params.get('lng'));
    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        map.setView([lat, lng], 15);
        const sharedIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-pulse" style="animation-duration:1s;background:rgba(255,107,107,0.5)">
                     <div class="marker-dot" style="background:#ff6b6b;box-shadow:0 2px 8px rgba(255,107,107,0.6)"></div>
                   </div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        const sharedMarker = L.marker([lat, lng], { icon: sharedIcon }).addTo(map)
            .bindPopup('<b>📍 Shared location</b>')
            .openPopup();
        // Auto-remove shared marker after 8s or when own location is acquired
        const removeShared = () => { if (sharedMarker) map.removeLayer(sharedMarker); };
        setTimeout(removeShared, 8000);
        showToast('📍 Shared location loaded', 'join');
        window.history.replaceState({}, '', window.location.pathname);
    }
})();

// ===== Other Users' Markers =====
const markers = {};

function addUserMarker(id, latitude, longitude, username) {
    const displayName = username || 'Anonymous';
    if (markers[id]) {
        markers[id].setLatLng([latitude, longitude]);
    } else {
        markers[id] = L.marker([latitude, longitude], {
            icon: createUserIcon(false)
        }).addTo(map);
        markers[id].bindPopup(`<b>${displayName}</b>`);
    }
}

// Receive all existing users' locations when joining
socket.on('initialLocations', (users) => {
    if (users.length === 0) {
        if (!isGPSMode) statusText.textContent = 'No other users online';
    } else {
        users.forEach(u => addUserMarker(u.id, u.latitude, u.longitude, u.username));
        if (!isGPSMode) statusText.textContent = `${users.length} user${users.length > 1 ? 's' : ''} online`;
    }
});

// Receive a new user's location update
socket.on('receiveLocation', (data) => {
    addUserMarker(data.id, data.latitude, data.longitude, data.username);
});

socket.on('userDisconnected', (id) => {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
        const remaining = Object.keys(markers).length;
        if (remaining === 0 && !isGPSMode) {
            statusText.textContent = 'No other users online';
        }
    }
});





