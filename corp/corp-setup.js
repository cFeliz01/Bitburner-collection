import { CITIES, DIV, MAT } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    
    // Check if corp already exists
    try {
        corp.getCorporation();
        ns.tprint("Corporation already exists.");
        return;
    } catch (e) {
        // No corp, proceed with creation
    }
    
    // Create corp (free in BN3, costs 150b elsewhere) [citation:1]
    corp.createCorporation("MyCorp", false);
    ns.tprint("Corporation created.");
    
    // Create Agriculture division (recommended starting industry) [citation:1]
    corp.expandIndustry("Agriculture", DIV.AGRICULTURE);
    ns.tprint("Agriculture division created.");
    
    // Expand to all cities and purchase warehouses [citation:1]
    for (const city of CITIES) {
        corp.expandCity(DIV.AGRICULTURE, city);
        corp.purchaseWarehouse(DIV.AGRICULTURE, city);
    }
    ns.tprint(`Expanded to ${CITIES.length} cities with warehouses.`);
    
    // Unlock Smart Supply for automated material purchasing
    corp.unlockUpgrade("Smart Supply");
    
    // Enable Smart Supply for each city
    for (const city of CITIES) {
        corp.setSmartSupply(DIV.AGRICULTURE, city, true);
    }
    
    ns.tprint("Smart Supply enabled in all cities.");
}