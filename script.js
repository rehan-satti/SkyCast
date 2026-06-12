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

// Day/Night auto-refresh
let dayNightTimer = null;
let lastWeatherData = null; // stores { location, data, aqiData } for icon re-render

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
const mainDayNightEl = document.getElementById('main-day-night');
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
    if (searchHistory.length > 5) searchHistory.splice(5);
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

// Weather code descriptions (used for condition text)
const weatherCodes = {
    0: { desc: 'Clear sky' },
    1: { desc: 'Mainly clear' },
    2: { desc: 'Partly cloudy' },
    3: { desc: 'Overcast' },
    45: { desc: 'Fog' },
    48: { desc: 'Depositing rime fog' },
    51: { desc: 'Light drizzle' },
    53: { desc: 'Moderate drizzle' },
    55: { desc: 'Dense drizzle' },
    56: { desc: 'Light freezing drizzle' },
    57: { desc: 'Dense freezing drizzle' },
    61: { desc: 'Slight rain' },
    63: { desc: 'Moderate rain' },
    65: { desc: 'Heavy rain' },
    66: { desc: 'Light freezing rain' },
    67: { desc: 'Heavy freezing rain' },
    71: { desc: 'Slight snow fall' },
    73: { desc: 'Moderate snow fall' },
    75: { desc: 'Heavy snow fall' },
    77: { desc: 'Snow grains' },
    80: { desc: 'Slight rain showers' },
    81: { desc: 'Moderate rain showers' },
    82: { desc: 'Violent rain showers' },
    85: { desc: 'Slight snow showers' },
    86: { desc: 'Heavy snow showers' },
    95: { desc: 'Thunderstorm' },
    96: { desc: 'Thunderstorm (slight hail)' },
    99: { desc: 'Thunderstorm (heavy hail)' }
};

/**
 * Helper to check if a WMO weather code represents precipitation (Rain, Snow, Drizzle, T-Storm).
 */
function isPrecipitationCode(code) {
    const precipCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    return precipCodes.includes(code);
}

/**
 * Returns the correct weather emoji based on WMO weather code and day/night.
 * @param {number} code - WMO weather interpretation code
 * @param {boolean} isDay - true if current time is between sunrise and sunset
 * @returns {string} emoji character(s)
 */
function getWeatherEmoji(code, isDay) {
    if (isDay) {
        if (code === 95 || code === 96 || code === 99) return '⛈';
        if ([71, 73, 75, 77, 85, 86, 56, 57, 66, 67].includes(code)) return '🌨';
        if (code === 65 || code === 82) return '🌧';
        if ([80, 81, 51, 53, 55, 61, 63].includes(code)) return '🌦️';
        if (code === 45 || code === 48) return '🌫';
        if (code === 0) return '☀️';
        if (code === 1) return '🌤';
        if (code === 2) return '⛅';
        if (code === 3) return '☁️';
        return '☀️';
    } else {
        // Nighttime icons - Enhanced set for professional transitions
        if (code === 95 || code === 96 || code === 99) return '⛈🌙';
        if ([71, 73, 75, 77, 85, 86, 56, 57, 66, 67].includes(code)) return '🌨🌙';
        if (code === 65 || code === 82) return '🌧🌙';
        if ([80, 81, 51, 53, 55, 61, 63].includes(code)) return '🌦️🌙';
        if (code === 45 || code === 48) return '🌫🌙';
        if (code === 0) return '🌙';
        if (code === 1) return '🌙'; // Mainly Clear night
        if (code === 2) return '🌙☁️';
        if (code === 3) return '☁️';
        return '🌙';
    }
}

/**
 * Centralized utility to get weather display data.
 * @param {number} code - WMO weather code
 * @param {boolean} isDay - Day/Night status
 * @returns {object} { emoji, description }
 */
function getWeatherDisplayInfo(code, isDay) {
    const condition = weatherCodes[code] || { desc: 'Unknown' };
    const emoji = getWeatherEmoji(code, isDay);
    return { emoji, description: condition.desc };
}

/**
 * Determines whether it is currently daytime at the weather location.
 *
 * Root cause of the previous bug:
 *   Open-Meteo returns sunrise/sunset as ISO strings WITHOUT a timezone suffix,
 *   e.g. "2026-06-12T05:30" (Pakistan local time). JavaScript's Date() treats
 *   such strings as the BROWSER's local timezone — so a Pakistan sunrise read on
 *   a US browser was being compared against US time, producing wrong results.
 *
 * Fix:
 *   Use `utc_offset_seconds` from the API to convert Date.now() into the
 *   location's local wall-clock time, then compare HH:MM directly against the
 *   HH:MM embedded in the sunrise/sunset strings.
 *
 * @param {string|null} sunriseISO       - e.g. "2026-06-12T05:30"
 * @param {string|null} sunsetISO        - e.g. "2026-06-12T19:47"
 * @param {number}      utcOffsetSeconds - from data.utc_offset_seconds
 * @returns {boolean}
 */
function isDaytime(sunriseISO, sunsetISO, utcOffsetSeconds) {
    if (!sunriseISO || !sunsetISO) return true; // fallback: assume day

    const offsetMs = (typeof utcOffsetSeconds === 'number' ? utcOffsetSeconds : 0) * 1000;

    // Shift current UTC epoch to the city's local wall-clock, then read
    // hours/minutes using getUTCHours() on the shifted Date object.
    const localNow     = new Date(Date.now() + offsetMs);
    const nowMinutes   = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

    // Extract HH:MM from the ISO string (everything after 'T')
    const toMinutes = (iso) => {
        const timePart = (iso || '').split('T')[1] || '00:00';
        const [h, m]   = timePart.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };

    return nowMinutes >= toMinutes(sunriseISO) && nowMinutes < toMinutes(sunsetISO);
}

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
        let weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset,precipitation_probability_max&timezone=auto&forecast_days=7`;
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

        // Cache weather data for day/night auto-refresh
        lastWeatherData = { location, data: weatherData, aqiData };

        updateWeatherUI(location, weatherData, aqiData);
        renderHourlyRain(weatherData.hourly, weatherData.daily, weatherData.utc_offset_seconds);
        updateCharts(weatherData.hourly);

        // Auto day/night icon refresh every 60 s — updates main icon + all sections
        if (dayNightTimer) clearInterval(dayNightTimer);
        dayNightTimer = setInterval(() => {
            if (!lastWeatherData) return;
            const { data } = lastWeatherData;
            const daily      = data.daily;
            const utcOffset  = data.utc_offset_seconds;
            const sunrise0   = daily.sunrise ? daily.sunrise[0] : null;
            const sunset0    = daily.sunset  ? daily.sunset[0]  : null;

            // Re-render main icon with perfect sync
            const isDay = (data.current.is_day !== undefined) ? (data.current.is_day === 1) : isDaytime(sunrise0, sunset0, utcOffset);
            mainIconEl.className = isDay ? '' : 'night-icon';
            mainIconEl.textContent = getWeatherDisplayInfo(data.current.weather_code, isDay).emoji;

            // Re-render hourly section (icons change as hours pass day→night)
            renderHourlyRain(data.hourly, daily, utcOffset);

            // Re-render forecast (Today icon may flip at sunrise/sunset)
            renderForecast(daily, utcOffset, data.current.weather_code, isDay);
        }, 60000);
    } catch (error) {
        console.error("Error fetching weather:", error);
    }
}

function updateWeatherUI(location, data, aqiData) {
    const current = data.current;
    const daily = data.daily;
    const utcOffset    = data.utc_offset_seconds;           // seconds, e.g. 18000 for PKT
    const todaySunrise = daily.sunrise ? daily.sunrise[0] : null;
    const todaySunset  = daily.sunset  ? daily.sunset[0]  : null;

    // --- Determine current conditions early to avoid ReferenceErrors ---
    // Use current.is_day from API for real-time accuracy
    const isDay = (current.is_day !== undefined) ? (current.is_day === 1) : isDaytime(todaySunrise, todaySunset, utcOffset);
    const code  = current.weather_code;

    // Get temperature in Celsius for internal logic (Alerts/Background)
    let tempCelsius = current.temperature_2m;
    if (tempUnit === 'fahrenheit') {
        tempCelsius = (current.temperature_2m - 32) * 5/9;
    }

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
    // Open-Meteo current object does not provide precipitation_probability.
    // We use Today's daily max probability to ensure data integrity.
    const todayRainProb = (daily.precipitation_probability_max && daily.precipitation_probability_max[0] != null) 
        ? daily.precipitation_probability_max[0] 
        : 0;
    
    const showRainChance = isPrecipitationCode(code) || todayRainProb >= 30;
    rainChanceEl.textContent = showRainChance ? `${todayRainProb}%` : '0%';
    rainChanceEl.style.color = (todayRainProb > 50 && showRainChance) ? '#3b82f6' : 'inherit';
    
    let uvMax = daily.uv_index_max ? daily.uv_index_max[0] : 0;
    uvIndexEl.textContent = `${uvMax} ${getUVLevel(uvMax)}`;

    let aqi = aqiData && aqiData.current ? aqiData.current.us_aqi : null;
    if(aqi !== null) {
        aqiValueEl.textContent = `${aqi} - ${getAQILevel(aqi)}`;
    } else {
        aqiValueEl.textContent = 'N/A';
    }

    // --- Dynamic day/night weather icon ---
    // Set main Day/Night status label (Google Weather style)
    if (mainDayNightEl) {
        mainDayNightEl.textContent = isDay ? 'Day' : 'Night';
        mainDayNightEl.className = `day-night-heading ${isDay ? 'is-day' : 'is-night'}`;
        mainDayNightEl.classList.remove('hidden');
    }

    const weatherInfo = getWeatherDisplayInfo(code, isDay);
    conditionDescEl.textContent = weatherInfo.description;

    // Switch main icon element to emoji mode
    mainIconEl.className = isDay ? '' : 'night-icon';
    mainIconEl.textContent = weatherInfo.emoji;
    mainIconEl.style.fontFamily = 'inherit';
    mainIconEl.style.lineHeight  = '1';
    
    // Check for Weather and Temperature Alerts
    checkForAlerts(code, tempCelsius);
    
    updateBackground(tempCelsius);

    // 7-Day List — pass utcOffset so Today can use real day/night
    renderForecast(daily, utcOffset, code, isDay);
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

function checkForAlerts(code, temp) {
    weatherAlertsEl.classList.add('hidden');
    let alertMsg = null;
    
    if(code === 95 || code === 96 || code === 99) alertMsg = "Thunderstorm Warning: Severe thunderstorms detected in the area.";
    else if(code === 65 || code === 67 || code === 82) alertMsg = "Heavy Rain Warning: Risk of localized flooding.";
    else if(code === 75 || code === 86) alertMsg = "Heavy Snow Warning: Blizzard conditions possible.";
    else if(temp > 35) alertMsg = "Heatwave Alert: Extreme heat detected. Stay hydrated and avoid direct sunlight.";
    else if(temp < 0) alertMsg = "Extreme Cold Warning: Temperatures below freezing. Protect against frostbite.";
    
    if(alertMsg) {
        weatherAlertsEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${alertMsg}</span>`;
        weatherAlertsEl.classList.remove('hidden');
    }
}

/**
 * Renders the 7-day forecast list.
 * @param {object} daily             - daily data object from Open-Meteo
 * @param {number} utcOffsetSeconds  - location UTC offset (data.utc_offset_seconds)
 * @param {number} [currentCode]     - current weather code for Today synchronization
 * @param {boolean} [currentIsDay]   - current day/night status for Today synchronization
 */
function renderForecast(daily, utcOffsetSeconds, currentCode, currentIsDay) {
    forecastListEl.innerHTML = '';

    const daysToRender = Math.min(7, daily.time ? daily.time.length : 0);
    for (let i = 0; i < daysToRender; i++) {
        const dateStr  = daily.time[i]; // e.g. "2026-06-12"

        // Today (i=0) matches current live status; Future days use daytime summary icons
        const forecastIsDay = (i === 0 && currentIsDay !== undefined) ? currentIsDay : true;

        // Use current live weather code for Today, otherwise use daily dominant code
        const weatherCode = (i === 0 && currentCode !== undefined) ? currentCode : daily.weather_code[i];

        const dayName = i === 0
            ? 'Today'
            : new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

        const { emoji } = getWeatherDisplayInfo(weatherCode, forecastIsDay);
        const nightClass = forecastIsDay ? '' : 'night-icon';
        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const maxTemp = Math.round(daily.temperature_2m_max[i]);

        // Rain probability for this day (0–100 or null)
        const rainPct   = (daily.precipitation_probability_max && daily.precipitation_probability_max[i] != null)
            ? daily.precipitation_probability_max[i]
            : null;
        
        // Show rain probability only if the code indicates rain or probability is >= 30%
        const showRainPct = isPrecipitationCode(weatherCode) || (rainPct !== null && rainPct >= 30);
        const rainDisplay = showRainPct ? `💧${rainPct}%` : '';
        const rainClass = (rainPct !== null && rainPct > 50) ? 'forecast-rain high' : 'forecast-rain';

        const forecastHTML = `
            <div class="forecast-item">
                <span class="forecast-day">${dayName}</span>
                <div class="forecast-condition">
                    <span class="forecast-emoji ${nightClass}">${emoji}</span>
                </div>
                <span class="${rainClass}" title="Rain probability">${rainDisplay}</span>
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
/**
 * Renders the 24-hour forecast rain section.
 * Uses per-hour weather_code + per-hour day/night detection so icons
 * correctly show sun/moon variants as the day progresses.
 *
 * @param {object} hourly            - hourly data from Open-Meteo
 * @param {object} daily             - daily data (provides sunrise/sunset per day)
 * @param {number} utcOffsetSeconds  - location UTC offset (data.utc_offset_seconds)
 */
function renderHourlyRain(hourly, daily, utcOffsetSeconds) {
    if (!hourlyRainContainer) return;

    // Find the first future hour index using location-local time
    const offsetMs  = (typeof utcOffsetSeconds === 'number' ? utcOffsetSeconds : 0) * 1000;
    const localNow  = new Date(Date.now() + offsetMs);
    const nowMinutesOfDay = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

    // Helper: parse "HH:MM" from an ISO string like "2026-06-12T05:30"
    const toMin = (iso) => {
        if (!iso) return 0;
        const t = (iso).split('T')[1] || '00:00';
        const [h, m] = t.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };

    // Build a lookup map: date-string → { sunriseMin, sunsetMin }
    // so we can quickly resolve day/night for any hour
    const sunMap = {};
    if (daily && daily.time) {
        daily.time.forEach((dateStr, idx) => {
            sunMap[dateStr] = {
                sunriseMin: toMin(daily.sunrise ? daily.sunrise[idx] : null),
                sunsetMin:  toMin(daily.sunset  ? daily.sunset[idx]  : null)
            };
        });
    }

    // Get current hour in location-local time format (YYYY-MM-DDTHH:00)
    const localHourStr = [
        localNow.getUTCFullYear(),
        String(localNow.getUTCMonth() + 1).padStart(2, '0'),
        String(localNow.getUTCDate()).padStart(2, '0')
    ].join('-') + 'T' + String(localNow.getUTCHours()).padStart(2, '0') + ':00';

    let startIndex = 0;
    for (let j = 0; j < hourly.time.length; j++) {
        if (hourly.time[j] >= localHourStr) {
            startIndex = j;
            break;
        }
    }

    hourlyRainContainer.innerHTML = '';
    for (let i = 0; i < 24; i++) {
        const idx = startIndex + i;
        if (idx >= hourly.time.length) break;

        const slotISO  = hourly.time[idx];           // "2026-06-12T14:00"
        const dateStr  = slotISO.split('T')[0];      // "2026-06-12"
        const slotT    = (slotISO.split('T')[1] || '00:00');
        const [sh, sm] = slotT.split(':').map(Number);
        const slotMin  = (sh || 0) * 60 + (sm || 0); // minutes since midnight (local)

        // Resolve day/night for this specific hour using that day's sunrise/sunset
        const sun = sunMap[dateStr];
        const hourIsDay = sun
            ? (slotMin >= sun.sunriseMin && slotMin < sun.sunsetMin)
            : true; // fallback to day if no data

        const code = (hourly.weather_code && hourly.weather_code[idx] != null)
            ? hourly.weather_code[idx]
            : null;
        const prob = hourly.precipitation_probability[idx] || 0;

        // Pick emoji: prefer weather_code if available, else fall back to rain-probability heuristic
        let emoji;
        if (code !== null) {
            emoji = getWeatherDisplayInfo(code, hourIsDay).emoji;
        } else {
            // Fallback when weather_code not in response
            if (prob >= 70)     emoji = hourIsDay ? '🌧️' : '🌧️🌙';
            else if (prob >= 30) emoji = hourIsDay ? '🌦️' : '🌦️🌙';
            else               emoji = hourIsDay ? '☀️' : '🌙';
        }

        // Time label: format "2026-06-12T14:00" -> "2 PM" (First item is "Now")
        let timeLabel = `${sh === 0 ? 12 : sh > 12 ? sh - 12 : sh}${sh >= 12 ? ' PM' : ' AM'}`;
        if (i === 0) timeLabel = 'Now';

        // Only show probability percentage if realistic chance exists
        const showProbInfo = isPrecipitationCode(code) || prob >= 30;
        const probDisplay = showProbInfo ? `${prob}%` : '';
        
        const isHigh   = (prob > 70 && showProbInfo) ? 'high-rain' : '';
        const nightClass = hourIsDay ? '' : 'night-icon';

        const cardHTML = `
            <div class="hourly-rain-card ${isHigh}">
                <span class="hourly-weather-emoji ${nightClass}">${emoji}</span>
                <span class="hourly-time">${timeLabel}</span>
                <span class="hourly-prob">${probDisplay}</span>
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
        let weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day&timezone=auto`;
        if (tempUnit === 'fahrenheit') weatherUrl += '&temperature_unit=fahrenheit';
        
        try {
            const res = await fetch(weatherUrl);
            const data = await res.json();
            const curr  = data.current;
            const isDay = curr.is_day === 1;
            const { emoji, description } = getWeatherDisplayInfo(curr.weather_code, isDay);
            const nightClass = isDay ? '' : 'night-icon';

            html += `
                <tr>
                    <td style="font-weight:600;">${loc.name}, ${loc.country || ''}</td>
                    <td>${Math.round(curr.temperature_2m)}°${tempUnit === 'fahrenheit' ? 'F' : 'C'}</td>
                    <td><span style="font-size:1.2rem;" class="${nightClass}">${emoji}</span> ${description}</td>
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
