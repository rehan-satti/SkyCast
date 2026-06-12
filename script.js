// --- Global State ---
let currentLat = null;
let currentLon = null;
let currentCityObj = null;
let tempUnit = 'celsius';
let searchHistory = JSON.parse(localStorage.getItem('skycast_history')) || [];
let compareList = [];

// Chart Instances
let tempChartInstance = null;
let precipChartInstance = null;
let leafletMap = null;
let mapMarker = null;

// --- Elements ---
const searchInput = document.getElementById('city-input');
const searchBtn = document.getElementById('search-btn');
const searchSuggestions = document.getElementById('search-suggestions');
const errorMessage = document.getElementById('error-message');
const weatherDashboard = document.getElementById('weather-dashboard');
const emptyState = document.getElementById('empty-state');
const loader = document.getElementById('loader');
const chartsSection = document.getElementById('charts-section');
const hourlyRainSection = document.getElementById('hourly-rain-section');
const hourlyRainContainer = document.getElementById('hourly-rain-container');

// History Elements
const searchHistoryContainer = document.getElementById('search-history');
const historyListEl = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Alert Elements
const weatherAlertsEl = document.getElementById('weather-alerts');

// Weather DOM Elements
const cityNameEl = document.getElementById('city-name');
const dateTimeEl = document.getElementById('date-time');
const tempEl = document.getElementById('temp');
const mainUnitEl = document.getElementById('main-unit');
const conditionDescEl = document.getElementById('condition-desc');
const humidityEl = document.getElementById('humidity');
const windSpeedEl = document.getElementById('wind-speed');
const rainChanceEl = document.getElementById('rain-chance');
const aqiValueEl = document.getElementById('aqi-value');
const uvIndexEl = document.getElementById('uv-index');
const mainIconEl = document.getElementById('main-icon');
const forecastListEl = document.getElementById('forecast-list');

// Settings Elements
const settingsForm = document.getElementById('settings-form');
const settingsSuccess = document.getElementById('settings-success');
const tempUnitSelect = document.getElementById('temp-unit');

// Navigation Elements
const navLinks = document.querySelectorAll('.nav-link');
const viewSections = document.querySelectorAll('.view-section');

// Compare Elements
const compareInput = document.getElementById('compare-input');
const compareBtn = document.getElementById('compare-btn');
const compareTbody = document.getElementById('compare-tbody');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    updateHistoryUI();
    initMap();
    renderCompareTable();
});

// --- Navigation Logic ---
navLinks.forEach(link => {
    link.addEventListener('click', function(event) {
        event.preventDefault();
        navLinks.forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');

        viewSections.forEach(section => section.classList.add('hidden'));

        const targetId = this.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden');

        // Fix map sizing issue if map view is opened
        if (targetId === 'view-maps' && leafletMap) {
            setTimeout(() => leafletMap.invalidateSize(), 100);
        }
    });
});

// --- Settings Form Logic ---
settingsForm.addEventListener('submit', function(event) {
    event.preventDefault(); 
    const newUnit = tempUnitSelect.value;
    
    if (newUnit !== tempUnit) {
        tempUnit = newUnit;
        if (currentLat !== null && currentLon !== null && currentCityObj !== null) {
            fetchWeatherData(currentCityObj, currentLat, currentLon);
        }
        if(compareList.length > 0) {
            renderCompareTable();
        }
    }

    settingsSuccess.classList.remove('hidden');
    setTimeout(() => {
        settingsSuccess.classList.add('hidden');
    }, 3000);
});

// --- History Logic ---
function updateHistoryUI() {
    if (searchHistory.length === 0) {
        searchHistoryContainer.classList.add('hidden');
        return;
    }
    searchHistoryContainer.classList.remove('hidden');
    historyListEl.innerHTML = '';
    searchHistory.forEach(city => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.textContent = city.name;
        li.addEventListener('click', () => {
            searchInput.value = city.name;
            searchHistoryContainer.classList.add('hidden');
            processCitySelection(city);
        });
        historyListEl.appendChild(li);
    });
}

function addToHistory(city) {
    // Remove if exists to put it at the start
    searchHistory = searchHistory.filter(c => c.name !== city.name);
    searchHistory.unshift(city);
    if (searchHistory.length > 5) searchHistory.pop();
    localStorage.setItem('skycast_history', JSON.stringify(searchHistory));
    updateHistoryUI();
}

clearHistoryBtn.addEventListener('click', () => {
    searchHistory = [];
    localStorage.removeItem('skycast_history');
    updateHistoryUI();
});

// --- Live Search Suggestions (Autocomplete) ---
let searchTimeout;

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimeout);
    
    if (query.length < 2) {
        searchSuggestions.classList.add('hidden');
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                showSuggestions(data.results);
            } else {
                searchSuggestions.classList.add('hidden');
            }
        } catch (err) {
            console.error(err);
        }
    }, 300);
});

searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2 && searchSuggestions.children.length > 0) {
        searchSuggestions.classList.remove('hidden');
    } else {
        updateHistoryUI();
    }
});

function showSuggestions(results) {
    searchHistoryContainer.classList.add('hidden');
    searchSuggestions.innerHTML = '';
    results.forEach(city => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        const countryText = city.admin1 ? `${city.admin1}, ${city.country}` : city.country;
        li.innerHTML = `
            <span class="suggestion-name">${city.name}</span>
            <span class="suggestion-country">${countryText || ''}</span>
        `;
        li.addEventListener('click', () => {
            searchInput.value = city.name;
            searchSuggestions.classList.add('hidden');
            processCitySelection(city);
        });
        searchSuggestions.appendChild(li);
    });
    searchSuggestions.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.classList.add('hidden');
    }
});

// --- Weather Data Logic ---
const weatherCodes = {
    0: { desc: 'Clear sky', icon: 'fa-solid fa-sun' },
    1: { desc: 'Mainly clear', icon: 'fa-solid fa-cloud-sun' },
    2: { desc: 'Partly cloudy', icon: 'fa-solid fa-cloud-sun' },
    3: { desc: 'Overcast', icon: 'fa-solid fa-cloud' },
    45: { desc: 'Fog', icon: 'fa-solid fa-smog' },
    48: { desc: 'Depositing rime fog', icon: 'fa-solid fa-smog' },
    51: { desc: 'Light drizzle', icon: 'fa-solid fa-cloud-rain' },
    53: { desc: 'Moderate drizzle', icon: 'fa-solid fa-cloud-rain' },
    55: { desc: 'Dense drizzle', icon: 'fa-solid fa-cloud-rain' },
    56: { desc: 'Light freezing drizzle', icon: 'fa-solid fa-snowflake' },
    57: { desc: 'Dense freezing drizzle', icon: 'fa-solid fa-snowflake' },
    61: { desc: 'Slight rain', icon: 'fa-solid fa-cloud-rain' },
    63: { desc: 'Moderate rain', icon: 'fa-solid fa-cloud-showers-heavy' },
    65: { desc: 'Heavy rain', icon: 'fa-solid fa-cloud-showers-heavy' },
    66: { desc: 'Light freezing rain', icon: 'fa-solid fa-snowflake' },
    67: { desc: 'Heavy freezing rain', icon: 'fa-solid fa-snowflake' },
    71: { desc: 'Slight snow fall', icon: 'fa-solid fa-snowflake' },
    73: { desc: 'Moderate snow fall', icon: 'fa-solid fa-snowflake' },
    75: { desc: 'Heavy snow fall', icon: 'fa-solid fa-snowflake' },
    77: { desc: 'Snow grains', icon: 'fa-solid fa-snowflake' },
    80: { desc: 'Slight rain showers', icon: 'fa-solid fa-cloud-rain' },
    81: { desc: 'Moderate rain showers', icon: 'fa-solid fa-cloud-showers-heavy' },
    82: { desc: 'Violent rain showers', icon: 'fa-solid fa-cloud-bolt' },
    85: { desc: 'Slight snow showers', icon: 'fa-solid fa-snowflake' },
    86: { desc: 'Heavy snow showers', icon: 'fa-solid fa-snowflake' },
    95: { desc: 'Thunderstorm', icon: 'fa-solid fa-cloud-bolt' },
    96: { desc: 'Thunderstorm (slight)', icon: 'fa-solid fa-cloud-bolt' },
    99: { desc: 'Thunderstorm (heavy)', icon: 'fa-solid fa-cloud-bolt' }
};

searchBtn.addEventListener('click', () => {
    searchSuggestions.classList.add('hidden');
    handleSearch();
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchSuggestions.classList.add('hidden');
        handleSearch();
    }
});

async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    errorMessage.classList.add('hidden');
    emptyState.classList.add('hidden');
    weatherDashboard.classList.add('hidden');
    chartsSection.classList.add('hidden');
    if(hourlyRainSection) hourlyRainSection.classList.add('hidden');
    weatherAlertsEl.classList.add('hidden');
    searchHistoryContainer.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
        const geoData = await geoResponse.json();

        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('City not found');
        }

        processCitySelection(geoData.results[0]);
    } catch (error) {
        console.error("Error fetching location:", error);
        loader.classList.add('hidden');
        errorMessage.classList.remove('hidden');
        emptyState.classList.remove('hidden');
    }
}

function processCitySelection(location) {
    currentLat = location.latitude;
    currentLon = location.longitude;
    currentCityObj = location;
    
    addToHistory(location);
    updateMap(currentLat, currentLon);
    fetchWeatherData(location, currentLat, currentLon);
}

async function fetchWeatherData(location, lat, lon) {
    loader.classList.remove('hidden');
    weatherDashboard.classList.add('hidden');
    chartsSection.classList.add('hidden');
    if(hourlyRainSection) hourlyRainSection.classList.add('hidden');
    weatherAlertsEl.classList.add('hidden');
    errorMessage.classList.add('hidden');
    emptyState.classList.add('hidden');

    try {
        let weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation_probability&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto`;
        let aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`;
        
        if (tempUnit === 'fahrenheit') {
            weatherUrl += '&temperature_unit=fahrenheit';
        }

        const [weatherResponse, aqiResponse] = await Promise.all([
            fetch(weatherUrl),
            fetch(aqiUrl)
        ]);

        const weatherData = await weatherResponse.json();
        const aqiData = await aqiResponse.json();

        updateWeatherUI(location, weatherData, aqiData);
        renderHourlyRain(weatherData.hourly);
        updateCharts(weatherData.hourly);
    } catch (error) {
        console.error("Error fetching weather:", error);
    }
}

function updateWeatherUI(location, data, aqiData) {
    const current = data.current;
    const daily = data.daily;

    loader.classList.add('hidden');
    weatherDashboard.classList.remove('hidden');
    chartsSection.classList.remove('hidden');
    if(hourlyRainSection) hourlyRainSection.classList.remove('hidden');

    // Current Weather
    cityNameEl.textContent = `${location.name}${location.country ? ', ' + location.country : ''}`;
    const now = new Date();
    dateTimeEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

    tempEl.textContent = Math.round(current.temperature_2m);
    mainUnitEl.textContent = tempUnit === 'fahrenheit' ? '°F' : '°C';
    humidityEl.textContent = `${current.relative_humidity_2m}%`;
    windSpeedEl.textContent = `${current.wind_speed_10m} km/h`;
    
    // New Metrics
    rainChanceEl.textContent = `${current.precipitation_probability || 0}%`;
    rainChanceEl.style.color = (current.precipitation_probability > 50) ? '#3b82f6' : 'inherit';
    
    let uvMax = daily.uv_index_max ? daily.uv_index_max[0] : 0;
    uvIndexEl.textContent = `${uvMax} ${getUVLevel(uvMax)}`;

    let aqi = aqiData && aqiData.current ? aqiData.current.us_aqi : null;
    if(aqi !== null) {
        aqiValueEl.textContent = `${aqi} - ${getAQILevel(aqi)}`;
    } else {
        aqiValueEl.textContent = 'N/A';
    }

    const condition = weatherCodes[current.weather_code] || { desc: 'Unknown', icon: 'fa-solid fa-cloud' };
    conditionDescEl.textContent = condition.desc;
    mainIconEl.className = condition.icon;
    
    // Mock Alerts
    checkForAlerts(current.weather_code);
    
    let tempCelsius = current.temperature_2m;
    if (tempUnit === 'fahrenheit') {
        tempCelsius = (current.temperature_2m - 32) * 5/9;
    }
    updateBackground(tempCelsius);

    // 7-Day List
    renderForecast(daily);
}

function getUVLevel(uv) {
    if(uv <= 2) return '(Low)';
    if(uv <= 5) return '(Mod)';
    if(uv <= 7) return '(High)';
    return '(Very High)';
}

function getAQILevel(aqi) {
    if(aqi <= 50) return 'Good';
    if(aqi <= 100) return 'Moderate';
    if(aqi <= 150) return 'Unhealthy';
    if(aqi <= 200) return 'Unhealthy';
    return 'Hazardous';
}

function checkForAlerts(code) {
    weatherAlertsEl.classList.add('hidden');
    let alertMsg = null;
    
    if(code === 95 || code === 96 || code === 99) alertMsg = "Thunderstorm Warning: Severe thunderstorms detected in the area.";
    else if(code === 65 || code === 67 || code === 82) alertMsg = "Heavy Rain Warning: Risk of localized flooding.";
    else if(code === 75 || code === 86) alertMsg = "Heavy Snow Warning: Blizzard conditions possible.";
    
    if(alertMsg) {
        weatherAlertsEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${alertMsg}</span>`;
        weatherAlertsEl.classList.remove('hidden');
    }
}

function renderForecast(daily) {
    forecastListEl.innerHTML = ''; 
    for (let i = 0; i < 7; i++) {
        const dateObj = new Date(daily.time[i]);
        const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        const code = daily.weather_code[i];
        const icon = weatherCodes[code] ? weatherCodes[code].icon : 'fa-solid fa-cloud';
        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const maxTemp = Math.round(daily.temperature_2m_max[i]);

        const forecastHTML = `
            <div class="forecast-item">
                <span class="forecast-day">${dayName}</span>
                <div class="forecast-condition">
                    <i class="${icon}"></i>
                </div>
                <div class="forecast-temps">
                    <span class="temp-max">${maxTemp}°</span>
                    <span class="temp-min">${minTemp}°</span>
                </div>
            </div>
        `;
        forecastListEl.insertAdjacentHTML('beforeend', forecastHTML);
    }
}

// --- Hourly Rain Logic ---
function renderHourlyRain(hourly) {
    if(!hourlyRainContainer) return;
    const now = new Date();
    let startIndex = hourly.time.findIndex(t => new Date(t) > now);
    if(startIndex < 0) startIndex = 0;

    hourlyRainContainer.innerHTML = '';
    
    for(let i = 0; i < 24; i++) {
        let idx = startIndex + i;
        if(idx >= hourly.time.length) break;

        const dateObj = new Date(hourly.time[idx]);
        const timeLabel = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
        const prob = hourly.precipitation_probability[idx] || 0;
        
        let iconClass = 'fas fa-cloud';
        if (prob > 0 && prob <= 50) iconClass = 'fas fa-cloud-rain';
        else if (prob > 50) iconClass = 'fas fa-cloud-showers-heavy';
        
        let isHigh = prob > 70 ? 'high-rain' : '';
        
        const cardHTML = `
            <div class="hourly-rain-card ${isHigh}">
                <i class="${iconClass}"></i>
                <span class="hourly-time">${timeLabel}</span>
                <span class="hourly-prob">${prob}%</span>
            </div>
        `;
        hourlyRainContainer.insertAdjacentHTML('beforeend', cardHTML);
    }
}

// --- Charts Logic ---
function updateCharts(hourly) {
    const now = new Date();
    let startIndex = hourly.time.findIndex(t => new Date(t) > now);
    if(startIndex < 0) startIndex = 0;
    
    const times = hourly.time.slice(startIndex, startIndex + 24).map(t => {
        const d = new Date(t);
        return d.getHours() + ':00';
    });
    const temps = hourly.temperature_2m.slice(startIndex, startIndex + 24);
    const precip = hourly.precipitation_probability.slice(startIndex, startIndex + 24);

    const tempCtx = document.getElementById('temp-chart').getContext('2d');
    const precipCtx = document.getElementById('precip-chart').getContext('2d');

    if(tempChartInstance) tempChartInstance.destroy();
    if(precipChartInstance) precipChartInstance.destroy();

    tempChartInstance = new Chart(tempCtx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [{
                label: `Temp (${tempUnit === 'fahrenheit' ? '°F' : '°C'})`,
                data: temps,
                borderColor: '#818cf8',
                backgroundColor: 'rgba(129, 140, 248, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });

    precipChartInstance = new Chart(precipCtx, {
        type: 'bar',
        data: {
            labels: times,
            datasets: [{
                label: 'Rain %',
                data: precip,
                backgroundColor: '#38bdf8'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100 } },
            plugins: { legend: { display: false } }
        }
    });
}

// --- Map Logic ---
function initMap() {
    leafletMap = L.map('map').setView([51.505, -0.09], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);
}

function updateMap(lat, lon) {
    if(leafletMap) {
        leafletMap.setView([lat, lon], 10);
        if(mapMarker) leafletMap.removeLayer(mapMarker);
        mapMarker = L.marker([lat, lon]).addTo(leafletMap);
    }
}

// --- Compare Logic ---
compareBtn.addEventListener('click', async () => {
    const query = compareInput.value.trim();
    if(!query) return;
    compareInput.value = '';

    try {
        const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
        const geoData = await geoResponse.json();
        if (!geoData.results || geoData.results.length === 0) throw new Error('City not found');
        
        const loc = geoData.results[0];
        if(!compareList.find(c => c.id === loc.id)) {
            compareList.push(loc);
            renderCompareTable();
        }
    } catch(err) {
        alert("City not found");
    }
});

async function renderCompareTable() {
    compareTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading data...</td></tr>';
    
    let html = '';
    for(let i=0; i<compareList.length; i++) {
        const loc = compareList[i];
        let weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`;
        if (tempUnit === 'fahrenheit') weatherUrl += '&temperature_unit=fahrenheit';
        
        try {
            const res = await fetch(weatherUrl);
            const data = await res.json();
            const curr = data.current;
            const cond = weatherCodes[curr.weather_code] || {desc:'Unknown', icon:'fa-solid fa-cloud'};
            
            html += `
                <tr>
                    <td style="font-weight:600;">${loc.name}, ${loc.country || ''}</td>
                    <td>${Math.round(curr.temperature_2m)}°${tempUnit === 'fahrenheit' ? 'F' : 'C'}</td>
                    <td><i class="${cond.icon}" style="color:var(--gradient-2)"></i> ${cond.desc}</td>
                    <td>${curr.relative_humidity_2m}%</td>
                    <td>${curr.wind_speed_10m} km/h</td>
                    <td><button class="compare-remove-btn" onclick="removeCompare(${loc.id})">Remove</button></td>
                </tr>
            `;
        } catch(e) {
            html += `<tr><td colspan="6">Error loading ${loc.name}</td></tr>`;
        }
    }
    
    if(compareList.length === 0) {
        html = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-muted);">No cities added to compare.</td></tr>';
    }
    
    compareTbody.innerHTML = html;
}

window.removeCompare = function(id) {
    compareList = compareList.filter(c => c.id !== id);
    renderCompareTable();
}

function updateBackground(tempCelsius) {
    const root = document.documentElement;
    if (tempCelsius > 25) {
        root.style.setProperty('--gradient-1', '#f87171');
        root.style.setProperty('--gradient-2', '#fbbf24');
        root.style.setProperty('--gradient-3', '#f43f5e');
    } else if (tempCelsius < 10) {
        root.style.setProperty('--gradient-1', '#60a5fa');
        root.style.setProperty('--gradient-2', '#818cf8');
        root.style.setProperty('--gradient-3', '#a78bfa');
    } else {
        root.style.setProperty('--gradient-1', '#38bdf8');
        root.style.setProperty('--gradient-2', '#818cf8');
        root.style.setProperty('--gradient-3', '#c084fc');
    }
}
