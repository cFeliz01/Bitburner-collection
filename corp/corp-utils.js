// Shared constants for corporation scripts
export const CITIES = [
    "Sector-12", "Aevum", "Chongqing", 
    "New Tokyo", "Ishima", "Volhaven"
];

export const DIV = {
    AGRICULTURE: "Agriculture",
    CHEMICAL: "Chemical"
};

export const MAT = {
    WATER: "Water",
    PLANTS: "Plants",
    CHEMICALS: "Chemicals",
    FOOD: "Food",
    HARDWARE: "Hardware",
    ROBOTS: "Robots",
    AI_CORES: "AI Cores",
    REAL_ESTATE: "Real Estate"
};

export const EMPLOYEE_ROLES = [
    "Operations", "Engineer", "Business", 
    "Research & Development", "Management"
];

// Production multiplier materials and their ideal warehouse ratios
export const PM_MATERIALS = [
    { name: MAT.HARDWARE, ratio: 1 },
    { name: MAT.ROBOTS, ratio: 1 },
    { name: MAT.AI_CORES, ratio: 1 },
    { name: MAT.REAL_ESTATE, ratio: 3 }
];

// Export formula: takes production plus a fraction of inventory
export const EXPORT_FORMULA = "(IPROD+IINV/10)*(-1)";

// Calculate how many employees to assign to each role
export function getJobAssignment(totalEmployees) {
    const assignments = {};
    const base = Math.floor(totalEmployees / EMPLOYEE_ROLES.length);
    let remainder = totalEmployees % EMPLOYEE_ROLES.length;
    
    for (const role of EMPLOYEE_ROLES) {
        assignments[role] = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
    }
    return assignments;
}