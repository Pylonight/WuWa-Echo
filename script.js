// --- PRIORITY DEFINITIONS ---
const DATA_VERSIONS = {
    '2.8.0': '2.8 Base',
    '3.0.0': '3.0 Base',
    '3.0.1': '3.0 Augusta/Chisa'
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
const STRATEGY_CLASSES = {
    'LOCK': 'strategy-lock',
    'KEEP': 'strategy-keep',
    'TRASH': 'strategy-trash'
};

// --- DOM CONTROL ---
const versionSelect = document.getElementById('version-select');
const versionDisplay = document.getElementById('current-version-name');
const versionBaseSelect = document.getElementById('version-base-select');

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
async function loadDataAndRender(version, versionBase) {
    // const baseUrl = '';
    const baseUrl = 'https://pylonight.github.io/WuWa-Echo/';

    try {
        // 0. Render the version control
        renderDataVersionDropdown(version, versionBase);

        // 1. Fetch all data files
        const [echoData, resonatorData, sonataData, echoDataBase, resonatorDataBase, sonataDataBase] = await Promise.all([
            fetch(dataFilepath(baseUrl, version, 'echoes.json')).then(res => res.json()),
            fetch(dataFilepath(baseUrl, version, 'resonators.json')).then(res => res.json()),
            fetch(dataFilepath(baseUrl, version, 'sonatas.json')).then(res => res.json()),
            versionBase !== undefined ? fetch(dataFilepath(baseUrl, versionBase, 'echoes.json')).then(res => res.json()) : Promise.resolve(undefined),
            versionBase !== undefined ? fetch(dataFilepath(baseUrl, versionBase, 'resonators.json')).then(res => res.json()) : Promise.resolve(undefined),
            versionBase !== undefined ? fetch(dataFilepath(baseUrl, versionBase, 'sonatas.json')).then(res => res.json()) : Promise.resolve(undefined),
        ]);

        // 2. Preprocess to create lookup maps
        const data = processData(echoData, resonatorData, sonataData);
        let dataBase;
        if (versionBase !== undefined) {
            dataBase = processData(echoDataBase, resonatorDataBase, sonataDataBase);
        }

        // 3. Perform the main data transformations
        const current = generateStrategies(data, resonatorData, echoData);
        if (versionBase !== undefined) {
            const base = generateStrategies(dataBase, resonatorDataBase, echoDataBase);
            tagStatStrategiesWithBase(current.statStrategies, base.statStrategies);
        }

        // 4. Render the results
        renderPriorityListWithBase(resonatorData, dataBase);
        renderStatCentricTable(data, current.statStrategies);
        renderSonataCentricTable(data, current.sonataRequirements, resonatorData);

    } catch (error) {
        console.error('Error loading or processing data:', error);
        document.getElementById('main-display-container').innerHTML = '<h1>Error Loading Data</h1><p>Please ensure all JSON files (resonators.json, echoes.json, sonatas.json) are correctly formatted and accessible.</p>';
    }
}

function processData(echoData, resonatorData, sonataData) {
    allEchoStatIDs = echoData.map(s => s.id);
    echoStatNames = arrayToMap(echoData, 'id', 'name');
    echoStatCosts = arrayToMap(echoData, 'id', 'cost');
    allSonataIDs = sonataData.map(s => s.id);
    sonataNames = arrayToMap(sonataData, 'id', 'name');
    sonataLowestStrategies = arrayToMap(sonataData, 'id', 'lowestStrategy');
    resonatorNames = arrayToMap(resonatorData, 'id', 'name');
    resonatorPriorities = arrayToMap(resonatorData, 'id', 'priority');
    return { allEchoStatIDs, echoStatNames, echoStatCosts, allSonataIDs, sonataNames, sonataLowestStrategies, resonatorNames, resonatorPriorities };
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
function generateStrategies(data, resonatorData, echoData) {
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
                const statInitStrategy = STRATEGY_MAP[echoRequirement.strategy || 'LOCK']; // "LOCK" if undefined
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

    for (const echoStatID of data.allEchoStatIDs) {
        statStrategies[echoStatID] = { lock: [], keep: [], trash: [] };
        const categories = statStrategies[echoStatID]; // { keep: [], lock: [], trash: [] }

        for (const sonataID of data.allSonataIDs) {
            const key = `${echoStatID}__${sonataID}`;
            
            // Get the requirement data, default to sonata's lowest strategy (TRASH if not specified) if no resonator uses it
            const req = reverseMap[key] || { highestStrategy: STRATEGY_MAP[data.sonataLowestStrategies[sonataID]] || STRATEGY_MAP.TRASH };
            
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

function generateChangesFromBase(current, base) {
    const added = [];
    const removed = [];
    for (const item of current) {
        if (!base.includes(item)) {
            added.push(item);
        }
    }
    for (const item of base) {
        if (!current.includes(item)) {
            removed.push(item);
        }
    }
    return { added, removed };
}

function tagStatStrategiesWithBase(statStrategies, statStrategiesBase) {
    let changes;
    for (const echoStatID in statStrategies) {
        changes = generateChangesFromBase(statStrategies[echoStatID].lock, statStrategiesBase[echoStatID].lock);
        if (changes.added.length > 0) {
            statStrategies[echoStatID].lockAdded = changes.added;
        }
        if (changes.removed.length > 0) {
            statStrategies[echoStatID].lockRemoved = changes.removed;
        }

        changes = generateChangesFromBase(statStrategies[echoStatID].keep, statStrategiesBase[echoStatID].keep);
        if (changes.added.length > 0) {
            statStrategies[echoStatID].keepAdded = changes.added;
        }
        if (changes.removed.length > 0) {
            statStrategies[echoStatID].keepRemoved = changes.removed;
        }

        changes = generateChangesFromBase(statStrategies[echoStatID].trash, statStrategiesBase[echoStatID].trash);
        if (changes.added.length > 0) {
            statStrategies[echoStatID].trashAdded = changes.added;
        }
        if (changes.removed.length > 0) {
            statStrategies[echoStatID].trashRemoved = changes.removed;
        }
    }
}

// --- RENDERING FUNCTIONS ---

function formatSets(data, setIDs, addedSetIDs, removedSetIDs) {
    let html = '';
    for (const id of data.allSonataIDs) {
        if (addedSetIDs !== undefined && addedSetIDs.includes(id)) {
            html += `<div class="sonata-card"><div class="rainbow-text">${data.sonataNames[id]?.zh || id}</div></div>`;
            continue;
        }
        if (setIDs !== undefined && setIDs.includes(id)) {
            html += `<div class="sonata-card"><div>${data.sonataNames[id]?.zh || id}</div></div>`;
            continue;
        }
        if (removedSetIDs !== undefined && removedSetIDs.includes(id)) {
            html += `<div class="dashed-sonata-card"><div class="crossed-text">${data.sonataNames[id]?.zh || id}</div></div>`;
            continue;
        }
    }
    return html;
}

function renderDataVersionDropdown(version, versionBase) {
    // 1. Sort versions using semantic versioning logic (descending)
    const sortedVersions = Object.keys(DATA_VERSIONS).sort((l, r) => isNewerVersionThan(l, r) ? -1 : 1);

    // 2. Populate dropdown and set selected
    versionSelect.length = 0;
    for (const sortedVersion of sortedVersions) {
        const option = document.createElement('option');
        option.value = sortedVersion;
        option.textContent = sortedVersion;
        versionSelect.appendChild(option);
    }
    versionSelect.value = version;

    versionBaseSelect.length = 0;
    for (const sortedVersion of sortedVersions) {
        const option = document.createElement('option');
        option.value = sortedVersion;
        option.textContent = sortedVersion;
        option.disabled = !isNewerVersionThan(version, sortedVersion);
        versionBaseSelect.appendChild(option);
    }
    if (isNewerVersionThan(version, versionBase)) {
        versionBaseSelect.value = versionBase;
    }

    // 3. Update the page content
    versionDisplay.textContent = DATA_VERSIONS[version];
}

function renderPriorityListWithBase(resonatorData, dataBase) {
    const container = document.getElementById('priority-list');
    if (!container) return;

    const listHtml = resonatorData.map(c => {
        if (dataBase === undefined) {
            return `<li class="${PRIORITY_CLASSES[c.priority]}">${c.name.zh} (${c.id}) is set to <strong>${c.priority}</strong></li>`;
        }
        if (!(c.id in dataBase.resonatorNames)) {
            return `<li class="${PRIORITY_CLASSES[c.priority]}">${c.name.zh} (${c.id}) is set to <strong>${c.priority}</strong>` +
                `<strong class="rainbow-text priority-change">NEW</strong></li>`;
        }
        if (c.priority !== dataBase.resonatorPriorities[c.id]) {
            return `<li class="${PRIORITY_CLASSES[c.priority]}">${c.name.zh} (${c.id}) is set to <strong>${c.priority}</strong>` +
                `<strong class="crossed-text priority-change ${PRIORITY_CLASSES[dataBase.resonatorPriorities[c.id]]}">${dataBase.resonatorPriorities[c.id]}</strong></li>`;
        }
        return `<li class="${PRIORITY_CLASSES[c.priority]}">${c.name.zh} (${c.id}) is set to <strong>${c.priority}</strong></li>`;
    }).join('');

    container.innerHTML = listHtml;
}

function renderStatCentricTable(data, statStrategies) {
    const tbody = document.querySelector('#stat-centric-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    data.allEchoStatIDs.forEach(echoStatID => {
        const strategy = statStrategies[echoStatID];
        const row = tbody.insertRow();
        
        row.insertCell().innerHTML = ('Cost' + data.echoStatCosts[echoStatID] + '<br>' + data.echoStatNames[echoStatID]?.zh) || echoStatID;

        // Auto-Lock Cell
        const lockCell = row.insertCell();
        lockCell.className = STRATEGY_CLASSES['LOCK'];
        lockCell.innerHTML = formatSets(data, strategy.lock, strategy.lockAdded, strategy.lockRemoved);

        // Keep Cell
        const keepCell = row.insertCell();
        keepCell.className = STRATEGY_CLASSES['KEEP'];
        keepCell.innerHTML = formatSets(data, strategy.keep, strategy.keepAdded, strategy.keepRemoved);

        // Trash Cell
        const trashCell = row.insertCell();
        trashCell.className = STRATEGY_CLASSES['TRASH'];
        trashCell.innerHTML = formatSets(data, strategy.trash, strategy.trashAdded, strategy.trashRemoved);
    });
}

function renderSonataCentricTable(data, sonataRequirements, resonatorData) {
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
    data.allSonataIDs.forEach(sonataID => {
        const requirements = sonataRequirements[sonataID];
        const row = tbody.insertRow();
        
        // 1. Sonata Name
        if (data.sonataLowestStrategies[sonataID] === undefined) {
            row.insertCell().innerHTML = `<span>${data.sonataNames[sonataID]?.zh || sonataID}</span>`;
        } else {
            row.insertCell().innerHTML = `<span class="${STRATEGY_CLASSES[data.sonataLowestStrategies[sonataID]]}">${data.sonataNames[sonataID]?.zh || sonataID}</span>`;
        }

        // 2. Required Echo Stats
        // const echoStats = Object.keys(requirements).map(echoStatID => {
        const echoStats = data.allEchoStatIDs.filter(echoStatID => echoStatID in requirements).map(echoStatID => {
            const resonatorList = Array.from(requirements[echoStatID]?.requiredBy || []).map(resonatorID =>
                `<span class="${PRIORITY_CLASSES[data.resonatorPriorities[resonatorID]]}">${data.resonatorNames[resonatorID].zh}</span>`).join(', ');
            const statName = ('Cost' + data.echoStatCosts[echoStatID] + ' ' + data.echoStatNames[echoStatID]?.zh) || echoStatID;;
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
loadDataAndRender(newestVersion(), undefined);

// Listen for selection changes
versionSelect.addEventListener('change', (e) => {
    loadDataAndRender(e.target.value, versionBaseSelect.selectedIndex > 0 ? versionBaseSelect.value : undefined);
});

versionBaseSelect.addEventListener('change', (e) => {
    loadDataAndRender(versionSelect.selectedIndex > 0 ? versionSelect.value : newestVersion(), e.target.value);
});

function clearVersionBaseSelect() {
    loadDataAndRender(versionSelect.selectedIndex > 0 ? versionSelect.value : newestVersion(), undefined);
}
