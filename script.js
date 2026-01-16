// --- PRIORITY DEFINITIONS ---
const DATA_VERSIONS = {
    '2.8.0': '2.8 Base',
    '3.0.0': '3.0 Base'
};
const PRIORITY_MAP = {
    'MAIN': 3,
    'SIDE': 2,
    'BENCH': 1,
    'GRADUATED': 0
};
const STRATEGY_MAP = {
    'LOCK': 2,
    'KEEP': 1,
    'TRASH': 0
};
const PRIORITY_CLASSES = {
    'MAIN': 'priority-MAIN',
    'SIDE': 'priority-SIDE',
    'BENCH': 'priority-BENCH',
    'GRADUATED': 'priority-GRADUATED'
};

// --- DATA CACHE AND LOOKUP MAPS ---
let allEchoStatIDs = []; // Array of all known Echo Stat IDs
let echoStatNames = {}; // Map of Echo Stat ID to Name
let echoStatCosts = {}; // Map of Echo Stat ID to Cost
let allSonataIDs = []; // Array of all known Sonata IDs
let sonataNames = {}; // Map of Sonata ID to Name
let resonatorNames = {}; // Map of Resonator ID to Name
let resonatorPriorities = {}; // Map of Resonator ID to Priority

// --- DOM CONTROL ---
const versionSelect = document.getElementById('version-select');
const versionDisplay = document.getElementById('current-version-name');

// --- VERSION CONTROL ---
function dataFilepath(baseUrl, version, filename) {
    return baseUrl + 'data/' + version + '/' + filename;
}

function isNewerVersionThan(l, r) {
    if (l === undefined) {
        return false;
    }
    if (r === undefined) {
        return true;
    }

    const lParts = l.split('.').map(Number);
    const rParts = r.split('.').map(Number);
    const maxLength = Math.max(lParts.length, rParts.length);
    for (let i = 0; i < maxLength; ++i) {
        const lPart = lParts[i] === undefined ? 0 : lParts[i];
        const rPart = rParts[i] === undefined ? 0 : rParts[i];
        if (lPart != rPart) {
            return lPart > rPart;
        }
    }
    return false;
}

let newestVersionCache;
function newestVersion() {
    if (newestVersionCache !== undefined) {
        return newestVersionCache;
    }
    if (DATA_VERSIONS.length === 0) {
        throw new Error('No registered version!');
    }

    let newest;
    for (const dataVersion in DATA_VERSIONS) {
        if (isNewerVersionThan(dataVersion, newest)) {
            newest = dataVersion;
        }
    }
    newestVersionCache = newest;
    return newestVersionCache;
}

// --- DATA FETCHING & INITIALIZATION ---
async function loadDataAndRender(version) {
    // const baseUrl = '';
    const baseUrl = 'https://pylonight.github.io/WuWa-Echo/';

    try {
        // 0. Render the version control
        renderDataVersionDropdown(version);

        // 1. Fetch all data files
        const [echoData, resonatorData, sonataData] = await Promise.all([
            fetch(dataFilepath(baseUrl, version, 'echoes.json')).then(res => res.json()),
            fetch(dataFilepath(baseUrl, version, 'resonators.json')).then(res => res.json()),
            fetch(dataFilepath(baseUrl, version, 'sonatas.json')).then(res => res.json()),
        ]);

        // 2. Preprocess to create lookup maps
        allEchoStatIDs = echoData.map(s => s.id);
        echoStatNames = arrayToMap(echoData, 'id', 'name');
        echoStatCosts = arrayToMap(echoData, 'id', 'cost');
        allSonataIDs = sonataData.map(s => s.id);
        sonataNames = arrayToMap(sonataData, 'id', 'name');
        resonatorNames = arrayToMap(resonatorData, 'id', 'name');
        resonatorPriorities = arrayToMap(resonatorData, 'id', 'priority');

        // 3. Perform the main data transformations
        const { statStrategies, sonataRequirements } = generateStrategies(resonatorData, echoData);

        // 4. Render the results
        renderPriorityList(resonatorData);
        renderStatCentricTable(statStrategies);
        renderSonataCentricTable(sonataRequirements, resonatorData);

    } catch (error) {
        console.error('Error loading or processing data:', error);
        document.getElementById('main-display-container').innerHTML = '<h1>Error Loading Data</h1><p>Please ensure all JSON files (resonators.json, echoes.json, sonatas.json) are correctly formatted and accessible.</p>';
    }
}

/**
 * Helper to convert an array of objects into a key-value map for quick lookup.
 */
function arrayToMap(arr, keyField, valueField) {
    return arr.reduce((map, item) => {
        map[item[keyField]] = item[valueField];
        return map;
    }, {});
}

// --- CORE TRANSFORMATION FUNCTION ---
function generateStrategies(resonatorData, echoData) {
    // Reverse Map: Key = ECHOSTAT_ID__SONATA_ID, Value = { highestStrategy: number }
    const reverseMap = {};
    const sonataRequirements = {}; // For the Sonata-Centric view

    // 1. Build the Reverse Map and Sonata Requirements
    for (const resonator of resonatorData) {
        const resonatorID = resonator.id;
        const resonatorPriority = PRIORITY_MAP[resonator.priority];
        const resonatorPriorityName = resonator.priority;

        for (const sonataRequirement of resonator.sonatas) {
            const sonataID = sonataRequirement.sonata;
            
            // Initialize sonataRequirements entry
            if (!sonataRequirements[sonataID]) {
                sonataRequirements[sonataID] = {}; // { ECHO_ID: { highestStrategy: number, requiredBy: [] } }
            }

            for (const echoRequirement of sonataRequirement.echoes) {
                const echoStatID = echoRequirement.echo;
                const statInitStrategy = STRATEGY_MAP[echoRequirement.strategy || 'LOCK']; // "KEEP" or "LOCK" if undefined
                const key = `${echoStatID}__${sonataID}`;

                // --- 1a: Calculate final stat strategy ---
                let statFinalStrategy = STRATEGY_MAP.KEEP;
                if (resonatorPriority === PRIORITY_MAP.MAIN) {
                    // RULE 1: If any MAIN resonator needs it, AUTO-LOCK.
                    statFinalStrategy = statInitStrategy;
                } else if (resonatorPriority === PRIORITY_MAP.SIDE) {
                    // RULE 2: If a SIDE resonator needs it OR MAIN needs it as a replacement, use the KEEP category.
                    statFinalStrategy = STRATEGY_MAP.KEEP;
                } else {
                    // RULE 3: Otherwise (only BENCH/GRADUATED need it, or no one), AUTO-TRASH.
                    statFinalStrategy = STRATEGY_MAP.TRASH;
                }

                // --- 1b: Update Reverse Map (Stat-Centric Logic) ---
                if (!reverseMap[key]) {
                    reverseMap[key] = { highestStrategy: statFinalStrategy };
                } else {
                    // Update highest priority if current resonator's is higher
                    if (statFinalStrategy > reverseMap[key].highestStrategy) {
                        reverseMap[key].highestStrategy = statFinalStrategy;
                    }
                }

                // --- 1c: Update Sonata Requirements (Sonata-Centric Logic) ---
                if (!sonataRequirements[sonataID][echoStatID]) {
                    sonataRequirements[sonataID][echoStatID] = { 
                        highestStrategy: statFinalStrategy, 
                        highestPriority: resonatorPriority,
                        priorityName: resonatorPriorityName,
                        requiredBy: new Set()
                    };
                } else {
                    // Update if a higher priority resonator is found
                    if (resonatorPriority > sonataRequirements[sonataID][echoStatID].highestPriority) {
                        sonataRequirements[sonataID][echoStatID].highestPriority = resonatorPriority;
                        sonataRequirements[sonataID][echoStatID].priorityName = resonatorPriorityName;
                    }
                    // Update if a higher strategy for the echo stat is found
                    if (statFinalStrategy > sonataRequirements[sonataID][echoStatID].highestStrategy) {
                        sonataRequirements[sonataID][echoStatID].highestStrategy = statFinalStrategy;
                    }
                }
                // Add the resonator to the set of requirements
                sonataRequirements[sonataID][echoStatID].requiredBy.add(resonatorID);
            }
        }
    }

    // 2. Generate the final Stat-Centric Strategy (LOCK/KEEP/TRASH)
    const statStrategies = {};

    for (const echoStatID of allEchoStatIDs) {
        statStrategies[echoStatID] = { lock: [], keep: [], trash: [] };
        const categories = statStrategies[echoStatID];

        for (const sonataID of allSonataIDs) {
            const key = `${echoStatID}__${sonataID}`;
            
            // Get the requirement data, default to TRASH if no resonator uses it
            const req = reverseMap[key] || { highestStrategy: STRATEGY_MAP.TRASH };
            
            if (req.highestStrategy === STRATEGY_MAP.LOCK) {
                categories.lock.push(sonataID);
            } else if (req.highestStrategy === STRATEGY_MAP.KEEP) {
                categories.keep.push(sonataID);
            } else {
                categories.trash.push(sonataID);
            }
        }
    }
    
    return { statStrategies, sonataRequirements };
}

// --- RENDERING FUNCTIONS ---

function formatSets(setIDs) {
    return setIDs.map(id => sonataNames[id]?.zh || id).join(', ');
}

function renderDataVersionDropdown(version) {
    // 1. Sort versions using semantic versioning logic (descending)
    const sortedVersions = Object.keys(DATA_VERSIONS).sort((l, r) => isNewerVersionThan(l, r) ? -1 : 1);

    // 2. Populate dropdown and set default (newest)
    versionSelect.length = 0;
    for (const version of sortedVersions) {
        const option = document.createElement('option');
        option.value = version;
        option.textContent = version;
        versionSelect.appendChild(option);
    }
    versionSelect.value = version;

    // 3. Update the page content
    versionDisplay.textContent = DATA_VERSIONS[version];
}

function renderPriorityList(resonatorData) {
    const container = document.getElementById('priority-list');
    if (!container) return;

    const listHtml = resonatorData.map(c => 
        `<li class="${PRIORITY_CLASSES[c.priority]}">${c.name.zh} (${c.id}) is set to <strong>${c.priority}</strong></li>`
    ).join('');

    container.innerHTML = listHtml;
}

function renderStatCentricTable(statStrategies) {
    const tbody = document.querySelector('#stat-centric-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    allEchoStatIDs.forEach(echoStatID => {
        const strategy = statStrategies[echoStatID];
        const row = tbody.insertRow();
        
        row.insertCell().innerHTML = ('Cost' + echoStatCosts[echoStatID] + '<br>' + echoStatNames[echoStatID]?.zh) || echoStatID;

        // Auto-Lock Cell
        const lockCell = row.insertCell();
        lockCell.className = 'lock';
        lockCell.textContent = formatSets(strategy.lock);

        // Keep Cell
        const keepCell = row.insertCell();
        keepCell.className = 'keep';
        keepCell.textContent = formatSets(strategy.keep);

        // Trash Cell
        const trashCell = row.insertCell();
        trashCell.className = 'trash';
        trashCell.textContent = formatSets(strategy.trash);
    });
}

function renderSonataCentricTable(sonataRequirements, resonatorData) {
    const tbody = document.querySelector('#sonata-centric-table tbody');
    if (!tbody) return;

    // Create a map to look up a resonator's priority string from their ID
    const resonatorPriorityMap = resonatorData.reduce((map, resonator) => {
        map[resonator.id] = resonator.priority;
        return map;
    }, {});

    // Sort the sonatas by ID
    // const sortedSonataIDs = Object.keys(sonataRequirements).sort();

    tbody.innerHTML = '';
    allSonataIDs.forEach(sonataID => {
        const requirements = sonataRequirements[sonataID];
        const row = tbody.insertRow();
        
        // 1. Sonata Name
        row.insertCell().textContent = sonataNames[sonataID]?.zh || sonataID;

        // 2. Required Echo Stats
        // const echoStats = Object.keys(requirements).map(echoStatID => {
        const echoStats = allEchoStatIDs.filter(echoStatID => echoStatID in requirements).map(echoStatID => {
            const resonatorList = Array.from(requirements[echoStatID]?.requiredBy || []).map(resonatorID => `<span class="${PRIORITY_CLASSES[resonatorPriorities[resonatorID]]}">${resonatorNames[resonatorID].zh}</span>`).join(', ');
            const statName = ('Cost' + echoStatCosts[echoStatID] + ' ' + echoStatNames[echoStatID]?.zh) || echoStatID;;
            return `<strong>${statName}</strong> (Used by: ${resonatorList})`;
        }).join('<br>');
        row.insertCell().innerHTML = echoStats;

        // 3. Highest Priority Requiring resonator(s)
        const highestStrategyObj = Object.values(requirements).sort((a, b) => b.highestPriority - a.highestPriority)[0];
        
        let highestStrategyCell = row.insertCell();
        if (highestStrategyObj) {
            highestStrategyCell.innerHTML = `<span class="${PRIORITY_CLASSES[highestStrategyObj.priorityName]}">${highestStrategyObj.priorityName}</span>`;
        } else {
            highestStrategyCell.textContent = 'None';
        }
    });
}


// Execute the process on load
loadDataAndRender(newestVersion());

// Listen for selection changes
versionSelect.addEventListener('change', (e) => {
    loadDataAndRender(e.target.value);
});
