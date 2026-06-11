// --- Global State ---
let currentLat = null;
let currentLon = null;
let currentCityObj = null; // Stores location data
let tempUnit = 'celsius'; // Default

// --- Elements ---
const searchInput = document.getElementById('city-input');
const searchBtn = document.getElementById('search-btn');
const searchSuggestions = document.getElementById('search-suggestions');
const errorMessage = document.getElementById('error-message');
const weatherDashboard = document.getElementById('weather-dashboard');
const emptyState = document.getElementById('empty-state');
const loader = document.getElementById('loader');

// Weather DOM Elements
const cityNameEl = document.getElementById('city-name');
const dateTimeEl = document.getElementById('date-time');
const tempEl = document.getElementById('temp');
const mainUnitEl = document.getElementById('main-unit');
const conditionDescEl = document.getElementById('condition-desc');
const humidityEl = document.getElementById('humidity');
const windSpeedEl = document.getElementById('wind-speed');
const mainIconEl = document.getElementById('main-icon');
const forecastListEl = document.getElementById('forecast-list');

// Map Element
const mapIframe = document.getElementById('map-iframe');

// Settings Elements
const settingsForm = document.getElementById('settings-form');
const settingsSuccess = document.getElementById('settings-success');
const tempUnitSelect = document.getElementById('temp-unit');

// Navigation Elements
const navLinks = document.querySelectorAll('.nav-link');
const viewSections = document.querySelectorAll('.view-section');

// --- Navigation Logic ---
navLinks.forEach(link => {
    link.addEventListener('click', function(event) {
        event.preventDefault();
        navLinks.forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');

        viewSections.forEach(section => {
            section.classList.add('hidden');
        });

        const targetId = this.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden');
    });
});

// --- Settings Form Logic ---
settingsForm.addEventListener('submit', function(event) {
    event.preventDefault(); 
    const newUnit = tempUnitSelect.value;
    
    // Check if unit changed
    if (newUnit !== tempUnit) {
        tempUnit = newUnit;
        
        // Re-fetch weather if a city is already selected
        if (currentLat !== null && currentLon !== null && currentCityObj !== null) {
            fetchWeatherData(currentCityObj, currentLat, currentLon);
        }
    }

    settingsSuccess.classList.remove('hidden');
    setTimeout(() => {
        settingsSuccess.classList.add('hidden');
    }, 3000);
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

    // Debounce API call
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

function showSuggestions(results) {
    searchSuggestions.innerHTML = '';
    
    results.forEach(city => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        
        const countryText = city.admin1 ? `${city.admin1}, ${city.country}` : city.country;
        
        li.innerHTML = `
            <span class="suggestion-name">${city.name}</span>
            <span class="suggestion-country">${countryText || ''}</span>
        `;
        
        // Click suggestion
        li.addEventListener('click', () => {
            searchInput.value = city.name;
            searchSuggestions.classList.add('hidden');
            processCitySelection(city);
        });
        
        searchSuggestions.appendChild(li);
    });
    
    searchSuggestions.classList.remove('hidden');
}

// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.classList.add('hidden');
    }
});


// --- Weather Data Logic ---
const weatherCodes = {
    0: { desc: 'Clear sky', icon: 'ph-sun' },
    1: { desc: 'Mainly clear', icon: 'ph-sun-dim' },
    2: { desc: 'Partly cloudy', icon: 'ph-cloud-sun' },
    3: { desc: 'Overcast', icon: 'ph-cloud' },
    45: { desc: 'Fog', icon: 'ph-cloud-fog' },
    48: { desc: 'Depositing rime fog', icon: 'ph-cloud-fog' },
    51: { desc: 'Light drizzle', icon: 'ph-cloud-rain' },
    53: { desc: 'Moderate drizzle', icon: 'ph-cloud-rain' },
    55: { desc: 'Dense drizzle', icon: 'ph-cloud-rain' },
    56: { desc: 'Light freezing drizzle', icon: 'ph-cloud-snow' },
    57: { desc: 'Dense freezing drizzle', icon: 'ph-cloud-snow' },
    61: { desc: 'Slight rain', icon: 'ph-cloud-rain' },
    63: { desc: 'Moderate rain', icon: 'ph-cloud-rain' },
    65: { desc: 'Heavy rain', icon: 'ph-cloud-rain' },
    66: { desc: 'Light freezing rain', icon: 'ph-cloud-snow' },
    67: { desc: 'Heavy freezing rain', icon: 'ph-cloud-snow' },
    71: { desc: 'Slight snow fall', icon: 'ph-snowflake' },
    73: { desc: 'Moderate snow fall', icon: 'ph-snowflake' },
    75: { desc: 'Heavy snow fall', icon: 'ph-snowflake' },
    77: { desc: 'Snow grains', icon: 'ph-snowflake' },
    80: { desc: 'Slight rain showers', icon: 'ph-cloud-rain' },
    81: { desc: 'Moderate rain showers', icon: 'ph-cloud-rain' },
    82: { desc: 'Violent rain showers', icon: 'ph-cloud-lightning' },
    85: { desc: 'Slight snow showers', icon: 'ph-cloud-snow' },
    86: { desc: 'Heavy snow showers', icon: 'ph-cloud-snow' },
    95: { desc: 'Thunderstorm', icon: 'ph-cloud-lightning' },
    96: { desc: 'Thunderstorm (slight)', icon: 'ph-cloud-lightning' },
    99: { desc: 'Thunderstorm (heavy)', icon: 'ph-cloud-lightning' }
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

// When a city is clicked from dropdown or directly searched
function processCitySelection(location) {
    currentLat = location.latitude;
    currentLon = location.longitude;
    currentCityObj = location;
    
    // Update Map
    const bbox = `${currentLon - 0.1},${currentLat - 0.1},${currentLon + 0.1},${currentLat + 0.1}`;
    mapIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${currentLat},${currentLon}`;

    fetchWeatherData(location, currentLat, currentLon);
}

// Fetch the weather data with correct unit
async function fetchWeatherData(location, lat, lon) {
    loader.classList.remove('hidden');
    weatherDashboard.classList.add('hidden');
    errorMessage.classList.add('hidden');
    emptyState.classList.add('hidden');

    try {
        let weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
        
        // Add Fahrenheit parameter if needed
        if (tempUnit === 'fahrenheit') {
            weatherUrl += '&temperature_unit=fahrenheit';
        }

        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();

        updateWeatherUI(location, weatherData);
    } catch (error) {
        console.error("Error fetching weather:", error);
    }
}

function updateWeatherUI(location, data) {
    const current = data.current;
    const daily = data.daily;

    loader.classList.add('hidden');
    weatherDashboard.classList.remove('hidden');

    // Current Weather Update
    cityNameEl.textContent = `${location.name}${location.country ? ', ' + location.country : ''}`;
    
    const now = new Date();
    dateTimeEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

    tempEl.textContent = Math.round(current.temperature_2m);
    mainUnitEl.textContent = tempUnit === 'fahrenheit' ? '°F' : '°C';
    
    humidityEl.textContent = `${current.relative_humidity_2m}%`;
    windSpeedEl.textContent = `${current.wind_speed_10m} km/h`;

    const condition = weatherCodes[current.weather_code] || { desc: 'Unknown', icon: 'ph-cloud' };
    conditionDescEl.textContent = condition.desc;
    mainIconEl.className = `ph-fill ${condition.icon}`;
    
    // Assuming Celsius for background color mapping, so convert if Fahrenheit
    let tempCelsius = current.temperature_2m;
    if (tempUnit === 'fahrenheit') {
        tempCelsius = (current.temperature_2m - 32) * 5/9;
    }
    updateBackground(tempCelsius);

    // 7-Day List Update
    renderForecast(daily);
}

function renderForecast(daily) {
    forecastListEl.innerHTML = ''; 

    for (let i = 0; i < 7; i++) {
        const dateObj = new Date(daily.time[i]);
        const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        
        const code = daily.weather_code[i];
        const icon = weatherCodes[code] ? weatherCodes[code].icon : 'ph-cloud';

        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const maxTemp = Math.round(daily.temperature_2m_max[i]);

        const forecastHTML = `
            <div class="forecast-item">
                <span class="forecast-day">${dayName}</span>
                <div class="forecast-condition">
                    <i class="ph-fill ${icon}"></i>
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
