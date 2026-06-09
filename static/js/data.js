// Layer type color mappings
const LAYER_TYPES = {
    'Core': '#3b82f6',
    'Frontend': '#10b981',
    'Backend': '#f59e0b',
    'Database': '#8b5cf6',
    'DevOps': '#ef4444',
    'API': '#06b6d4',
    'Actor': '#ec4899',
    'External': '#a3a3a3',
    'Other': '#6b7280'
};

// Lifecycle statuses. Active/Inactive/Deprecated are the originals; Planned
// and Proposed let a single diagram show current + roadmap state.
const LAYER_STATUSES = ['Active', 'Inactive', 'Deprecated', 'Planned', 'Proposed'];

// Statuses that represent infrastructure that isn't live yet. Used to exclude
// them from "current" cost rollups and to give them a distinct visual.
const FUTURE_STATUSES = ['Planned', 'Proposed'];

// Node types that are external actors/systems, not infrastructure we own or
// pay for. Excluded from cost rollups by default.
const ACTOR_TYPES = ['Actor', 'External'];

function isFutureStatus(status) {
    return FUTURE_STATUSES.includes(status);
}

function isActorType(type) {
    return ACTOR_TYPES.includes(type);
}

// Normalize connections to the canonical object format: { targetId, type }.
// This is the format used by real exports (e.g. sample-saas.json) and read by
// the details panel and diagram renderer. Older forms handled here:
//   - bare ids:            [2, 3]
//   - parallel-array form: connections:[2,3] + connectionTypes:{2:'HTTP'}
function migrateConnectionFormat(layer) {
    if (!layer.connections || !Array.isArray(layer.connections)) return;

    const legacyTypes = layer.connectionTypes || {};

    layer.connections = layer.connections.map(conn => {
        if (conn && typeof conn === 'object') {
            const out = { targetId: conn.targetId, type: conn.type || 'HTTP' };
            // Preserve the optional free-text payload label (Gap 6).
            if (conn.label) out.label = conn.label;
            return out;
        }
        // bare id, possibly with a legacy connectionTypes lookup
        return { targetId: conn, type: legacyTypes[conn] || 'HTTP' };
    });

    // The parallel-array side table is no longer used.
    delete layer.connectionTypes;
}

// Apply connection migration to all nodes in a project (recursive — handles
// substacks nested to any depth).
function migrateProjectConnections(project) {
    if (!project || !project.layers) return;
    const walk = (nodes) => {
        if (!Array.isArray(nodes)) return;
        nodes.forEach(node => {
            migrateConnectionFormat(node);
            if (node.substacks && node.substacks.length > 0) walk(node.substacks);
        });
    };
    walk(project.layers);
}

// Migration function: Convert old use path format to new step-based format
// Old format: { layersInvolved: [1, 2, 5], avgCallsPerLayer: {'1': 1, '2': 1, '5': 1} }
// New format: { steps: [{layerId, componentId, connectionType, costPerStep, ...}], totalCost, ... }
function migrateUsePathFormat(usePath, project) {
    if (!usePath) return usePath;
    
    // Check if already in new format (has steps array)
    if (usePath.steps && Array.isArray(usePath.steps)) {
        return usePath; // Already migrated
    }
    
    // Convert from old format to new format
    const steps = [];
    
    if (usePath.layersInvolved && Array.isArray(usePath.layersInvolved)) {
        usePath.layersInvolved.forEach((layerId, index) => {
            // Find the layer to get its name
            const layer = getAllLayersFromProject(project).find(l => l.id === layerId);
            const layerName = layer ? layer.name : `Layer ${layerId}`;
            
            // Determine connection type from existing connections if available
            let connectionType = 'HTTP'; // Default
            if (index > 0) {
                const prevLayerId = usePath.layersInvolved[index - 1];
                const prevLayer = getAllLayersFromProject(project).find(l => l.id === prevLayerId);
                if (prevLayer && prevLayer.connectionTypes && prevLayer.connectionTypes[layerId]) {
                    connectionType = prevLayer.connectionTypes[layerId];
                }
            }
            
            steps.push({
                layerId: layerId,
                layerName: layerName,
                componentId: null,  // No component info in old format
                componentName: null,
                connectionType: connectionType,
                costPerStep: 0,  // No cost info in old format
                currency: 'USD',
                period: 'month',
                notes: ''
            });
        });
    }
    
    // Calculate total cost (0 for now, will be set by user)
    const totalCost = steps.reduce((sum, step) => sum + (step.costPerStep || 0), 0);
    
    // Update the use path with new format
    usePath.steps = steps;
    usePath.totalCost = totalCost;
    usePath.currency = usePath.currency || 'USD';
    usePath.period = usePath.period || 'month';

    // Ensure the editing UI's fields always exist, even for authored/curated
    // actions that only specified layersInvolved. avgCallsPerLayer defaults to
    // 1 call per involved layer.
    if (!Array.isArray(usePath.layersInvolved)) usePath.layersInvolved = [];
    if (!usePath.avgCallsPerLayer || typeof usePath.avgCallsPerLayer !== 'object') {
        usePath.avgCallsPerLayer = {};
    }
    usePath.layersInvolved.forEach(id => {
        if (typeof usePath.avgCallsPerLayer[id] !== 'number') usePath.avgCallsPerLayer[id] = 1;
    });
    
    return usePath;
}

// Helper function to get all layers from a project (used during migration).
// Recursive — substacks may themselves contain substacks (n-level).
function getAllLayersFromProject(project) {
    const allLayers = [];
    const walk = (nodes) => {
        if (!Array.isArray(nodes)) return;
        nodes.forEach(node => {
            allLayers.push(node);
            if (node.substacks && node.substacks.length > 0) walk(node.substacks);
        });
    };
    if (project && project.layers) walk(project.layers);
    return allLayers;
}

// Apply migration to all use paths in a project
function migrateProjectUsePaths(project) {
    if (!project || !project.usePaths) return;
    
    project.usePaths.forEach(usePath => {
        migrateUsePathFormat(usePath, project);
    });
}

// Migration function: Standardize cost model to use canonical variable cost units
// Maps old variable units to new standardized units
function migrateCostModel(costModel) {
    if (!costModel) return costModel;
    
    // Map old per-1M units to new per-use units
    const unitMapping = {
        // Old per-1M units → New per-use units
        'per-1m-requests': 'per-request',
        'per 1M requests': 'per-request',
        'per-1m-calls': 'per-call',
        'per 1M calls': 'per-call',
        'per-1m-logs': 'per-log-entry',
        'per 1M logs': 'per-log-entry',
        'per-1m-indexed': 'per-indexed-item',
        'per 1M indexed': 'per-indexed-item',
        'per-1m-reads': 'per-read',
        'per 1M reads': 'per-read',
        'per-1m-writes': 'per-write',
        'per 1M writes': 'per-write',
        // Storage units (already per-use)
        'per-gb-month': 'per-gb-month',
        'per GB/month': 'per-gb-month',
        'per-gb-transferred': 'per-gb-transferred',
        'per GB transferred': 'per-gb-transferred',
        // Compute units (already per-use)
        'per-gb-second': 'per-gb-second',
        'per GB-second': 'per-gb-second',
        'per-vcpu-hour': 'per-vcpu-hour',
        'per vCPU-hour': 'per-vcpu-hour',
        // Legacy/generic
        'per request': 'per-request',
        'per-request': 'per-request',
        'per SMS': 'per-use',
        'per hour': 'per-vcpu-hour',
        'per-hour': 'per-vcpu-hour',
        'per GB': 'per-gb-month',
        'per-gb': 'per-gb-month'
    };
    
    const oldUnit = costModel.variableUnit || '';
    const newUnit = unitMapping[oldUnit] || 'per-use';
    
    // Convert variable cost from per-1M to per-use if needed
    let variableCost = costModel.variableCost || 0;
    const per1MUnits = ['per-1m-requests', 'per 1M requests', 'per-1m-calls', 'per 1M calls',
                        'per-1m-logs', 'per 1M logs', 'per-1m-indexed', 'per 1M indexed',
                        'per-1m-reads', 'per 1M reads', 'per-1m-writes', 'per 1M writes'];
    
    if (per1MUnits.includes(oldUnit)) {
        // Convert from per-1M to per-use: divide by 1,000,000
        variableCost = variableCost / 1000000;
    }
    
    return {
        currency: costModel.currency || 'USD',
        period: costModel.period || 'month',
        fixedCost: costModel.fixedCost || 0,
        fixedCostDescription: costModel.fixedCostDescription || '',
        variableCost: variableCost,
        variableUnit: newUnit,
        // Preserve percentage-of-value cost fields (Gap 4).
        percentageCost: costModel.percentageCost || 0,
        percentageFixed: costModel.percentageFixed || 0,
        notes: costModel.notes || ''
    };
}

// Apply cost model migration to all nodes (recursive — any nesting depth).
function migrateProjectCostModels(project) {
    if (!project || !project.layers) return project;
    const walk = (nodes) => {
        if (!Array.isArray(nodes)) return;
        nodes.forEach(node => {
            if (node.costModel) node.costModel = migrateCostModel(node.costModel);
            if (node.substacks && node.substacks.length > 0) walk(node.substacks);
        });
    };
    walk(project.layers);
    return project;
}

// Apply all migrations to a project
function migrateProject(project) {
    if (!project) return;
    
    migrateProjectConnections(project);
    migrateProjectUsePaths(project);
    migrateProjectCostModels(project);

    // Ensure a project-level avg transaction value exists for percentage-cost
    // evaluation (Gap 4). Defaulted, never overwritten if already set.
    if (typeof project.avgTransactionValue !== 'number') {
        project.avgTransactionValue = DEFAULT_AVG_TRANSACTION_VALUE;
    }
    
    return project;
}

/**
 * The project's average transaction value, used to evaluate percentage-of-value
 * costs. Falls back to the default when unset.
 */
function getAvgTransactionValue(project) {
    return (project && typeof project.avgTransactionValue === 'number')
        ? project.avgTransactionValue
        : DEFAULT_AVG_TRANSACTION_VALUE;
}

/**
 * Per-transaction cost contributed by a cost model's percentage component:
 * (percentageCost% × avgTransactionValue) + percentageFixed.
 * Returns 0 when no percentage cost is set.
 */
function evaluatePercentageCost(costModel, avgTransactionValue) {
    if (!costModel) return 0;
    const pct = costModel.percentageCost || 0;
    const fixed = costModel.percentageFixed || 0;
    if (pct === 0 && fixed === 0) return 0;
    const aov = (typeof avgTransactionValue === 'number') ? avgTransactionValue : DEFAULT_AVG_TRANSACTION_VALUE;
    return (pct / 100) * aov + fixed;
}

// Helper function to ensure all templates have standardized cost models
function ensureTemplatesStandardized() {
    for (const templateKey in TEMPLATES) {
        const template = TEMPLATES[templateKey];
        if (template.layers) {
            template.layers.forEach(layer => {
                if (layer.costModel) {
                    migrateCostModel(layer.costModel);
                    // Ensure fixedCostDescription exists
                    if (!layer.costModel.fixedCostDescription) {
                        layer.costModel.fixedCostDescription = layer.costModel.notes || '';
                    }
                }
                if (layer.substacks) {
                    layer.substacks.forEach(substack => {
                        if (substack.costModel) {
                            migrateCostModel(substack.costModel);
                            if (!substack.costModel.fixedCostDescription) {
                                substack.costModel.fixedCostDescription = substack.costModel.notes || '';
                            }
                        }
                    });
                }
            });
        }
    }
}

// Load templates from external JSON files with cache busting and error handling
async function loadTemplatesFromFiles() {
    const templateFiles = ['microservices', 'three-tier', 'serverless', 'enterprise'];
    const loadedTemplates = {};
    const failedTemplates = [];
    
    // Cache busting: add timestamp to prevent stale template caching
    const cacheBuster = `?v=${Date.now()}`;
    
    for (const templateName of templateFiles) {
        try {
            const response = await fetch(`templates/${templateName}.json${cacheBuster}`);
            if (response.ok) {
                const template = await response.json();
                loadedTemplates[templateName === 'three-tier' ? 'threeLayer' : templateName] = template;
                console.log(`✓ Loaded template: ${templateName}`);
            } else {
                failedTemplates.push(templateName);
                console.warn(`Failed to load template ${templateName}: HTTP ${response.status}`);
            }
        } catch (error) {
            failedTemplates.push(templateName);
            console.warn(`Failed to load template ${templateName}:`, error.message);
        }
    }
    
    // Merge loaded templates with existing TEMPLATES
    Object.assign(TEMPLATES, loadedTemplates);
    ensureTemplatesStandardized();
    
    // Report loading status
    const loadedCount = Object.keys(loadedTemplates).length;
    const totalCount = templateFiles.length;
    
    if (loadedCount === totalCount) {
        console.log(`✓ All ${totalCount} templates loaded successfully`);
    } else if (loadedCount > 0) {
        console.warn(`⚠ Loaded ${loadedCount}/${totalCount} templates. Failed: ${failedTemplates.join(', ')}`);
        // Store warning for UI display
        window.templateLoadingWarning = `Some templates failed to load: ${failedTemplates.join(', ')}. Using fallback templates if available.`;
    } else {
        console.error(`✗ Failed to load any templates. Using fallback templates only.`);
        window.templateLoadingError = 'Failed to load templates from templates/ directory. Using embedded fallback templates.';
    }
    
    return { loadedCount, totalCount, failedTemplates };
}

// Connection type definitions
const CONNECTION_TYPES = {
    'HTTP': { label: 'HTTP/REST', color: '#3b82f6', pattern: [5, 5], width: 2 },
    'gRPC': { label: 'gRPC', color: '#8b5cf6', pattern: [8, 4], width: 2 },
    'Event': { label: 'Event Bus', color: '#f59e0b', pattern: [3, 3], width: 2 },
    'Database': { label: 'Database Query', color: '#06b6d4', pattern: [2, 4], width: 2 },
    'Cache': { label: 'Cache', color: '#10b981', pattern: [6, 2], width: 1.5 },
    'Message': { label: 'Message Queue', color: '#ef4444', pattern: [4, 4], width: 2 },
    'Sync': { label: 'Synchronous', color: '#64748b', pattern: [5, 5], width: 2 },
    'Async': { label: 'Asynchronous', color: '#94a3b8', pattern: [3, 3], width: 1.5 }
};

// Standardized variable cost units (all on per-use basis)
const VARIABLE_COST_UNITS = {
    // Compute/Request-based (per single request/call)
    'per-request': {
        label: 'Per Request',
        category: 'requests',
        description: 'Cost per API request or function invocation',
        multiplier: 1
    },
    'per-call': {
        label: 'Per Call',
        category: 'requests',
        description: 'Cost per service call',
        multiplier: 1
    },
    
    // Storage-based
    'per-gb-month': {
        label: 'Per GB/Month',
        category: 'storage',
        description: 'Cost per gigabyte stored per month',
        multiplier: 1
    },
    'per-gb-transferred': {
        label: 'Per GB Transferred',
        category: 'storage',
        description: 'Cost per gigabyte of data transfer',
        multiplier: 1
    },
    
    // Data-based (per single item)
    'per-log-entry': {
        label: 'Per Log Entry',
        category: 'data',
        description: 'Cost per log entry ingested',
        multiplier: 1
    },
    'per-indexed-item': {
        label: 'Per Indexed Item',
        category: 'data',
        description: 'Cost per indexed item',
        multiplier: 1
    },
    
    // Compute-based
    'per-gb-second': {
        label: 'Per GB-Second',
        category: 'compute',
        description: 'Cost per gigabyte-second of compute (serverless)',
        multiplier: 1
    },
    'per-vcpu-hour': {
        label: 'Per vCPU-Hour',
        category: 'compute',
        description: 'Cost per virtual CPU hour',
        multiplier: 1
    },
    
    // Database-based (per single operation)
    'per-read': {
        label: 'Per Read',
        category: 'database',
        description: 'Cost per read operation',
        multiplier: 1
    },
    'per-write': {
        label: 'Per Write',
        category: 'database',
        description: 'Cost per write operation',
        multiplier: 1
    },
    
    // Generic
    'per-use': {
        label: 'Per Use',
        category: 'generic',
        description: 'Cost per use',
        multiplier: 1
    }
};

// Cost model configuration
const COST_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'];
const COST_PERIODS = ['month', 'year'];

// Default avg transaction value used to evaluate percentage-of-value costs
// (Gap 4) when a project doesn't specify one.
const DEFAULT_AVG_TRANSACTION_VALUE = 50;

// Default cost model template (updated for new structure)
const DEFAULT_COST_MODEL = {
    currency: 'USD',
    period: 'month',
    fixedCost: 0,
    fixedCostDescription: '',
    variableCost: 0,
    variableUnit: 'per-1m-requests',  // Default to standardized unit
    // Percentage-of-transaction-value cost (Gap 4). For e.g. PayPal at
    // "3.49% + $0.49": percentageCost = 3.49, percentageFixed = 0.49.
    // Evaluated against the project's avgTransactionValue.
    percentageCost: 0,        // percent (e.g. 3.49 means 3.49%)
    percentageFixed: 0,       // flat per-transaction fee added to the percentage
    notes: ''
};

// Default action cost structure (for tracking resource consumption)
const DEFAULT_ACTION_COST = {
    // Resource consumption per layer (how many units of each resource this action consumes)
    resourceConsumption: {
        // [layerId]: { unit: 'per-1m-requests', quantity: 1, description: '1 API request' }
    },
    
    // Usage assumptions (how often this action is used)
    usageAssumptions: {
        estimatedCallsPerMonth: 10000,      // How many times this action runs per month
        estimatedUsersPerMonth: 1000,       // How many unique users trigger this
        callsPerUser: 10                    // Average calls per user per month
    },
    
    // Calculated costs (derived from resource consumption + usage assumptions)
    calculatedCosts: {
        costPerUse: {
            fixed: 0,
            variable: 0,
            total: 0
        },
        monthlyCost: {
            fixed: 0,
            variable: 0,
            total: 0
        },
        costPerUser: {
            fixed: 0,
            variable: 0,
            total: 0
        }
    }
};

// Sample project data
const SAMPLE_PROJECT = {
    name: 'Sample Project',
    layers: [
        {
            id: 1,
            name: 'React UI',
            type: 'Frontend',
            status: 'Active',
            description: 'User interface layer',
            technology: 'React 18, TypeScript',
            responsibilities: 'Render UI, handle user interactions',
            connections: [{ targetId: 2, type: 'HTTP' }],
            dependencies: [],
            visible: true,
            locked: false,
            costModel: {
                currency: 'USD',
                period: 'month',
                fixedCost: 50,
                fixedCostDescription: 'CDN + hosting',
                variableCost: 0,
                variableUnit: 'per-1m-requests',
                notes: ''
            },
            substacks: [
                {
                    id: '1_1',
                    name: 'Components',
                    type: 'Frontend',
                    status: 'Active',
                    description: 'React components',
                    technology: 'React',
                    responsibilities: 'Reusable UI components',
                    connections: [],
                    dependencies: [],
                    visible: true,
                    locked: false,
                    costModel: {
                        currency: 'USD',
                        period: 'month',
                        fixedCost: 0,
                        fixedCostDescription: '',
                        variableCost: 0,
                        variableUnit: 'per-1m-requests',
                        notes: ''
                    }
                },
                {
                    id: '1_2',
                    name: 'State Management',
                    type: 'Frontend',
                    status: 'Active',
                    description: 'Redux store',
                    technology: 'Redux Toolkit',
                    responsibilities: 'Global state management',
                    connections: [],
                    dependencies: [],
                    visible: true,
                    locked: false,
                    costModel: {
                        currency: 'USD',
                        period: 'month',
                        fixedCost: 0,
                        fixedCostDescription: '',
                        variableCost: 0,
                        variableUnit: 'per-1m-requests',
                        notes: ''
                    }
                }
            ]
        },
        {
            id: 2,
            name: 'REST API',
            type: 'API',
            status: 'Active',
            description: 'API gateway',
            technology: 'Express.js',
            responsibilities: 'Route requests, authentication',
            connections: [{ targetId: 3, type: 'HTTP' }],
            dependencies: [1],
            visible: true,
            locked: false,
            costModel: {
                currency: 'USD',
                period: 'month',
                fixedCost: 400,
                fixedCostDescription: 'Compute + bandwidth',
                variableCost: 0.00002,
                variableUnit: 'per-1m-requests',
                notes: ''
            },
            substacks: []
        },
        {
            id: 3,
            name: 'Business Logic',
            type: 'Backend',
            status: 'Active',
            description: 'Core business logic',
            technology: 'Node.js',
            responsibilities: 'Process business rules',
            connections: [{ targetId: 4, type: 'Database' }],
            dependencies: [2],
            visible: true,
            locked: false,
            costModel: {
                currency: 'USD',
                period: 'month',
                fixedCost: 300,
                fixedCostDescription: 'Compute resources',
                variableCost: 0,
                variableUnit: 'per-1m-requests',
                notes: ''
            },
            substacks: []
        },
        {
            id: 4,
            name: 'PostgreSQL',
            type: 'Database',
            status: 'Active',
            description: 'Primary database',
            technology: 'PostgreSQL 15',
            responsibilities: 'Data persistence',
            connections: [],
            dependencies: [3],
            visible: true,
            locked: false,
            costModel: {
                currency: 'USD',
                period: 'month',
                fixedCost: 250,
                fixedCostDescription: 'Instance + storage + I/O',
                variableCost: 0.0001,
                variableUnit: 'per-gb-month',
                notes: ''
            },
            substacks: []
        }
    ]
};

// Template projects - now loaded from external JSON files in templates/ directory
// This object is populated by loadTemplatesFromFiles() at application startup
const TEMPLATES = {};


// ============================================================================
// COST CALCULATION ENGINE
// ============================================================================

/**
 * Initialize action cost structure with defaults
 * @param {Object} action - The action/usePath object
 * @returns {Object} - The action with initialized cost structure
 */
function initializeActionCost(action) {
    if (!action.actionCost) {
        action.actionCost = JSON.parse(JSON.stringify(DEFAULT_ACTION_COST));
    }
    return action;
}

/**
 * Set resource consumption for a specific layer in an action
 * @param {Object} action - The action/usePath object
 * @param {number} layerId - The layer ID
 * @param {string} unit - The variable cost unit (e.g., 'per-1m-requests')
 * @param {number} quantity - How many units this layer consumes per action
 * @param {string} description - Human-readable description
 */
function setResourceConsumption(action, layerId, unit, quantity, description) {
    initializeActionCost(action);
    
    action.actionCost.resourceConsumption[layerId] = {
        unit: unit,
        quantity: quantity,
        description: description || `${quantity} ${VARIABLE_COST_UNITS[unit]?.label || unit}`
    };
}

/**
 * Set usage assumptions for an action
 * @param {Object} action - The action/usePath object
 * @param {number} estimatedCallsPerMonth - How many times this action runs per month
 * @param {number} estimatedUsersPerMonth - How many unique users trigger this
 * @param {number} callsPerUser - Average calls per user per month
 */
function setUsageAssumptions(action, estimatedCallsPerMonth, estimatedUsersPerMonth, callsPerUser) {
    initializeActionCost(action);
    
    action.actionCost.usageAssumptions = {
        estimatedCallsPerMonth: estimatedCallsPerMonth || 10000,
        estimatedUsersPerMonth: estimatedUsersPerMonth || 1000,
        callsPerUser: callsPerUser || 10
    };
}

/**
 * Calculate the cost of an action based on resource consumption and usage assumptions
 * @param {Object} action - The action/usePath object
 * @param {Array} allLayers - All layers in the project
 * @returns {Object} - Cost analysis with per-use, monthly, and per-user costs
 */
function calculateActionCost(action, allLayers) {
    if (!action.actionCost) {
        initializeActionCost(action);
    }
    
    const actionCost = action.actionCost;
    const assumptions = actionCost.usageAssumptions;
    const consumption = actionCost.resourceConsumption;
    const monthlyCallsCount = assumptions.estimatedCallsPerMonth || 10000;
    const monthlyUsersCount = assumptions.estimatedUsersPerMonth || 1000;
    
    // Initialize cost accumulators
    let costPerUseVariable = 0;  // Only variable cost per use
    let monthlyCostFixed = 0;    // Total fixed cost per month (allocated)
    let monthlyCostVariable = 0; // Total variable cost per month
    let layerBreakdown = {};
    
    // Calculate costs by iterating through layers in the action path
    if (action.layersInvolved && action.layersInvolved.length > 0) {
        action.layersInvolved.forEach(layerId => {
            const layer = allLayers.find(l => l.id === layerId);
            if (!layer || !layer.costModel) return;
            
            const costModel = layer.costModel;
            const resourceInfo = consumption[layerId];
            
            // FIXED COST: Allocated based on usage
            // Calculate how many actions use this layer
            const layerUsageCount = project.usePaths.filter(p => 
                p.layersInvolved && p.layersInvolved.includes(layerId)
            ).length;
            
            // Allocate fixed cost proportionally
            // If 1 action uses it: pays 100%
            // If 2 actions use it: each pays 50%
            // If 3 actions use it: each pays 33%
            const allocatedFixedCost = layerUsageCount > 0 
                ? costModel.fixedCost / layerUsageCount 
                : costModel.fixedCost;
            
            // VARIABLE COST: Per-unit cost based on resource consumption
            // Variable cost per use = (cost per unit) * (quantity consumed per action)
            let variableCostPerUse = 0;
            if (resourceInfo && resourceInfo.quantity > 0) {
                variableCostPerUse = costModel.variableCost * resourceInfo.quantity;
            }
            
            // Accumulate variable cost per use
            costPerUseVariable += variableCostPerUse;
            
            // Accumulate monthly costs
            monthlyCostFixed += allocatedFixedCost;
            monthlyCostVariable += variableCostPerUse * monthlyCallsCount;
            
            // Store layer breakdown
            layerBreakdown[layerId] = {
                layerName: layer.name,
                layerType: layer.type,
                fixedCostMonthly: allocatedFixedCost,       // Allocated fixed cost per month
                variableCostPerUse: variableCostPerUse,     // Variable cost per use
                variableCostMonthly: variableCostPerUse * monthlyCallsCount,  // Total variable per month
                totalMonthly: allocatedFixedCost + (variableCostPerUse * monthlyCallsCount),
                resourceConsumption: resourceInfo,
                layerUsageCount: layerUsageCount,           // How many actions use this layer
                allocationNote: layerUsageCount > 1 ? `Shared by ${layerUsageCount} actions` : 'Dedicated to this action'
            };
        });
    }
    
    // Calculate per-use costs
    // Cost per use = only variable costs (fixed costs are monthly, not per-use)
    const costPerUseTotal = costPerUseVariable;
    
    // Calculate per-user costs
    const costPerUserFixed = monthlyUsersCount > 0 ? monthlyCostFixed / monthlyUsersCount : 0;
    const costPerUserVariable = monthlyUsersCount > 0 ? monthlyCostVariable / monthlyUsersCount : 0;
    
    // Store calculated costs
    actionCost.calculatedCosts = {
        costPerUse: {
            fixed: 0,  // Fixed costs don't apply per-use
            variable: costPerUseVariable,
            total: costPerUseTotal
        },
        monthlyCost: {
            fixed: monthlyCostFixed,
            variable: monthlyCostVariable,
            total: monthlyCostFixed + monthlyCostVariable
        },
        costPerUser: {
            fixed: costPerUserFixed,
            variable: costPerUserVariable,
            total: costPerUserFixed + costPerUserVariable
        },
        layerBreakdown: layerBreakdown
    };
    
    return actionCost.calculatedCosts;
}

/**
 * Get cost analysis for an action (with caching)
 * @param {Object} action - The action/usePath object
 * @param {Array} allLayers - All layers in the project
 * @returns {Object} - Cost analysis
 */
function getActionCostAnalysis(action, allLayers) {
    if (!action.actionCost) {
        initializeActionCost(action);
    }
    
    // Recalculate costs (in case resource consumption or usage assumptions changed)
    return calculateActionCost(action, allLayers);
}

/**
 * Format cost value for display
 * @param {number} cost - The cost value
 * @param {string} currency - Currency code (default: 'USD')
 * @returns {string} - Formatted cost string
 */
function formatCost(cost, currency = 'USD', isVariable = false) {
    // For variable costs, show more precision to avoid $0.00 display
    if (isVariable && cost < 1) {
        // Show up to 6 decimal places for small variable costs
        const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
        
        if (cost >= 0.01) {
            return symbol + cost.toFixed(4);
        } else if (cost >= 0.0001) {
            return symbol + cost.toFixed(6);
        } else if (cost > 0) {
            return symbol + cost.toExponential(2);
        } else {
            return symbol + '0.00';
        }
    }
    
    // For fixed costs and large amounts, use standard formatting
    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return formatter.format(cost);
}

/**
 * Get a summary of action costs for display
 * @param {Object} action - The action/usePath object
 * @param {Array} allLayers - All layers in the project
 * @returns {Object} - Summary with formatted costs
 */
function getActionCostSummary(action, allLayers) {
    const costs = getActionCostAnalysis(action, allLayers);
    
    return {
        costPerUse: formatCost(costs.costPerUse.total),
        monthlyCost: formatCost(costs.monthlyCost.total),
        costPerUser: formatCost(costs.costPerUser.total),
        breakdown: costs.layerBreakdown
    };
}

// Load templates from external JSON files on page load
loadTemplatesFromFiles().catch(err => {
    console.error('Error loading templates:', err);
});
